// Point d'entrée Node (vitest, solveur `tsx scripts/solver.ts`) : chaque langage a son
// worker_thread persistant (moteur chargé une seule fois) ; à l'échéance du délai, le worker
// est terminé (le code bouclant est réellement arrêté) puis recréé à la demande suivante.
// Le navigateur utilise `browser.ts` (aucune dépendance Node).
import { Worker } from "node:worker_threads";
import { timeoutMessage, type WorkerRequest, type WorkerResponse } from "./protocol.ts";
import { DEFAULT_TIMEOUT_MS, type Language, type RunOptions, type RunResult } from "./types.ts";

export { outputsMatch, normalizeOutput } from "./compare.ts";
export { DEFAULT_TIMEOUT_MS, LANGUAGES } from "./types.ts";
export type { Language, RunOptions, RunResult } from "./types.ts";

/** Délai maximal de chargement d'un moteur (clang ~100 Mo à compiler au premier appel). */
const LOAD_TIMEOUT_MS = 120_000;

const WORKER_URL = new URL("./node-worker.ts", import.meta.url);

class Lane {
  private worker: Worker | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private nextId = 1;
  private readonly lang: Language;

  constructor(lang: Language) {
    this.lang = lang;
  }

  run(code: string, stdin: string, timeoutMs: number): Promise<RunResult> {
    const p = this.queue.then(() => this.exec(code, stdin, timeoutMs));
    this.queue = p.catch(() => {});
    return p;
  }

  async dispose(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    if (w) await w.terminate();
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(WORKER_URL);
      this.worker.unref();
    }
    return this.worker;
  }

  private exec(code: string, stdin: string, timeoutMs: number): Promise<RunResult> {
    return new Promise<RunResult>((resolve) => {
      const worker = this.ensureWorker();
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

      const finish = (r: RunResult, kill: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(loadTimer);
        clearTimeout(runTimer);
        worker.off("message", onMessage);
        worker.off("error", onError);
        worker.off("exit", onExit);
        if (kill) {
          if (this.worker === worker) this.worker = null;
          void worker.terminate();
        } else {
          worker.unref();
        }
        resolve(r);
      };

      const onMessage = (m: WorkerResponse) => {
        if (m.id !== id) return;
        if (m.type === "phase") {
          phase = m.phase;
          if (!runTimer) {
            clearTimeout(loadTimer);
            startedAt = performance.now();
            runTimer = setTimeout(() => finish(fail(timeoutMessage(timeoutMs), true), true), timeoutMs);
          }
        } else if (m.type === "result") {
          finish(m.result, false);
        } else {
          finish(fail(m.message, false), false);
        }
      };
      const onError = (e: Error) => finish(fail(`Erreur du moteur d'exécution : ${e.message}`, false), true);
      const onExit = (code: number) => finish(fail(`Le moteur d'exécution s'est arrêté (code ${code}).`, false), true);

      const loadTimer = setTimeout(
        () => finish(fail("Le moteur d'exécution n'a pas pu être chargé à temps.", false), true),
        LOAD_TIMEOUT_MS,
      );

      worker.on("message", onMessage);
      worker.on("error", onError);
      worker.on("exit", onExit);
      worker.ref(); // garde le processus en vie tant qu'une exécution est en cours
      const req: WorkerRequest = { id, lang: this.lang, code, stdin };
      worker.postMessage(req);
    });
  }
}

const lanes = new Map<Language, Lane>();

function lane(lang: Language): Lane {
  let l = lanes.get(lang);
  if (!l) {
    l = new Lane(lang);
    lanes.set(lang, l);
  }
  return l;
}

/**
 * Compile (C) et exécute `code` avec `stdin` comme entrée standard.
 * Le délai (`timeoutMs`, défaut 5 s) couvre compilation + exécution, pas le chargement du moteur.
 * Les exécutions d'un même langage sont traitées l'une après l'autre.
 */
export function runCode(lang: Language, code: string, stdin: string, opts: RunOptions = {}): Promise<RunResult> {
  if (lang !== "c" && lang !== "python" && lang !== "javascript") {
    return Promise.reject(new Error(`Langage non pris en charge : ${String(lang)}`));
  }
  return lane(lang).run(code, stdin, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
}

/** Termine tous les workers (fin des tests, arrêt du solveur). */
export async function disposeRunners(): Promise<void> {
  const all = [...lanes.values()];
  lanes.clear();
  await Promise.all(all.map((l) => l.dispose()));
}
