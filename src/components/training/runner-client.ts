// Côté page : un Web Worker par langage (créé à la demande), une requête à la fois.
// - délai dur : `compile` → COMPILE_BUDGET_MS, puis `run` → timeoutMs ; au-delà, le worker
//   est terminé (le code bouclant est vraiment arrêté, l'onglet reste réactif) puis recréé ;
// - garde « worker bloqué » : un worker chaud qui n'envoie pas `phase` en 2 s est terminé
//   et la requête relancée une fois sur un worker neuf.
import type { BrowserWorkerRequest, BrowserWorkerResponse } from "@/lib/runners/browser";
import { timeoutMessage } from "@/lib/runners/protocol";
import type { Language, RunResult } from "@/lib/runners/types";

const STALL_MS = 2_000;
/** Chargement du moteur (clang ≈ 27 Mo à télécharger puis compiler la première fois). */
const LOAD_TIMEOUT_MS = 180_000;
/** Marge accordée à la compilation C dans le navigateur, avant le délai d'exécution. */
const COMPILE_BUDGET_MS = 30_000;

const STALLED = Symbol("stalled");

/** Panne du moteur (chargement impossible, worker planté) : rien à voir avec le code étudiant. */
export class EngineError extends Error {}

export type EngineState = "idle" | "loading" | "ready" | "error";

function createWorker(): Worker {
  return new Worker(new URL("./runner.worker.ts", import.meta.url), { type: "module" });
}

export class RunnerLane {
  private worker: Worker | null = null;
  private warm = false;
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(s: EngineState) => void>();
  private disposed = false;
  state: EngineState = "idle";
  /** Le moteur a déjà été chargé une fois (un rechargement après délai dépassé est plus rapide). */
  loadedOnce = false;

  constructor(
    readonly lang: Language,
    private readonly timeoutMs: number,
  ) {}

  onState(fn: (s: EngineState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(s: EngineState) {
    this.state = s;
    if (s === "ready") this.loadedOnce = true;
    for (const fn of this.listeners) fn(s);
  }

  /** Charge le moteur en arrière-plan (sans effet s'il est déjà chargé ou en cours). */
  prepare(): Promise<void> {
    if (this.state === "ready" || this.state === "loading") return this.queue.then(() => {});
    return this.enqueue(() => this.doPrepare());
  }

  run(code: string, stdin: string): Promise<RunResult> {
    return this.enqueue(async () => {
      const r = await this.exec(code, stdin);
      return r === STALLED ? ((await this.exec(code, stdin)) as RunResult) : r;
    });
  }

  dispose() {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.warm = false;
    this.listeners.clear();
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const p = this.queue.then(job);
    this.queue = p.catch(() => {});
    return p;
  }

  private ensureWorker(): Worker {
    if (this.disposed) throw new Error("Moteur d'exécution fermé.");
    if (!this.worker) {
      this.worker = createWorker();
      this.warm = false;
    }
    return this.worker;
  }

  private kill(w: Worker) {
    w.terminate();
    if (this.worker === w) {
      this.worker = null;
      this.warm = false;
    }
  }

  private doPrepare(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.warm && this.worker) {
      this.setState("ready");
      return Promise.resolve();
    }
    this.setState("loading");
    return new Promise<void>((resolve) => {
      const w = this.ensureWorker();
      const id = this.nextId++;
      const done = (ok: boolean) => {
        clearTimeout(timer);
        w.removeEventListener("message", onMessage);
        w.removeEventListener("error", onError);
        if (ok) this.warm = true;
        else this.kill(w);
        this.setState(ok ? "ready" : "error");
        resolve();
      };
      const onMessage = (e: MessageEvent<BrowserWorkerResponse>) => {
        if (e.data.id !== id) return;
        done(e.data.type === "ready");
      };
      const onError = () => done(false);
      const timer = setTimeout(() => done(false), LOAD_TIMEOUT_MS);
      w.addEventListener("message", onMessage);
      w.addEventListener("error", onError);
      const req: BrowserWorkerRequest = { id, type: "prepare", lang: this.lang };
      w.postMessage(req);
    });
  }

  /** Rejette avec `EngineError` si le moteur ne peut pas exécuter le code. */
  private exec(code: string, stdin: string): Promise<RunResult | typeof STALLED> {
    return new Promise((resolve, reject) => {
      const w = this.ensureWorker();
      const warm = this.warm;
      if (!warm) this.setState("loading");
      const id = this.nextId++;
      let phase: "compile" | "run" = this.lang === "c" ? "compile" : "run";
      let startedAt = 0;
      let runTimer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;

      const fail = (stderr: string, timedOut: boolean): RunResult => ({
        ok: false,
        stdout: "",
        stderr,
        phase,
        timedOut,
        exitCode: null,
        durationMs: startedAt ? Math.round(performance.now() - startedAt) : 0,
      });

      const finish = (r: RunResult | typeof STALLED | EngineError, kill: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(loadTimer);
        clearTimeout(runTimer);
        w.removeEventListener("message", onMessage);
        w.removeEventListener("error", onError);
        if (r instanceof EngineError) {
          this.kill(w);
          this.setState("error");
          reject(r);
          return;
        }
        if (kill) {
          this.kill(w);
          this.setState("idle");
          // Recharge le moteur en arrière-plan pour que l'exécution suivante soit rapide.
          if (r !== STALLED && !this.disposed) queueMicrotask(() => void this.prepare());
        }
        resolve(r);
      };

      const arm = (ms: number) => {
        clearTimeout(runTimer);
        runTimer = setTimeout(() => finish(fail(timeoutMessage(this.timeoutMs), true), true), ms);
      };

      const onMessage = (e: MessageEvent<BrowserWorkerResponse>) => {
        const m = e.data;
        if (m.id !== id) return;
        if (m.type === "phase") {
          clearTimeout(loadTimer);
          if (!startedAt) {
            startedAt = performance.now();
            this.warm = true;
            this.setState("ready");
          }
          phase = m.phase;
          arm(m.phase === "compile" ? COMPILE_BUDGET_MS : this.timeoutMs);
        } else if (m.type === "result") {
          this.warm = true;
          finish(m.result, false);
        } else if (m.type === "error") {
          finish(new EngineError(m.message), true);
        }
      };
      const onError = (e: ErrorEvent) => {
        e.preventDefault?.();
        finish(new EngineError(e.message || "erreur inconnue"), true);
      };

      const loadTimer = setTimeout(
        () => finish(warm ? STALLED : new EngineError("chargement trop long"), true),
        warm ? STALL_MS : LOAD_TIMEOUT_MS,
      );

      w.addEventListener("message", onMessage);
      w.addEventListener("error", onError);
      const req: BrowserWorkerRequest = { id, lang: this.lang, code, stdin };
      w.postMessage(req);
    });
  }
}
