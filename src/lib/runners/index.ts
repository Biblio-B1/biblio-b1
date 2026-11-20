// Point d'entrée Node (vitest, solveur `tsx scripts/solver.ts`) : chaque langage a son
// processus enfant persistant (moteur chargé une seule fois) ; à l'échéance du délai, le
// processus est tué (le code bouclant est réellement arrêté) puis recréé à la demande suivante.
// Le navigateur utilise `browser.ts` (aucune dépendance Node).
//
// SÉCURITÉ : le code exécuté ici (solutions de référence écrites par le modèle) n'est pas
// digne de confiance (injection d'invite via un document importé). Chaque processus enfant
// est lancé avec le modèle de permissions de Node (voir `sandboxArgs`) : lecture limitée au
// code des moteurs, aucune écriture, aucun processus enfant, aucun worker, aucun addon natif,
// environnement vide. Il ne peut donc lire ni storage/ (base, fichiers) ni .env.
//
// RÉSERVÉ à tsx (solveur) et vitest : ne jamais importer ce fichier depuis du code serveur
// Next (webpack ne sait pas lancer node-worker.ts). L'enfant est chargé par Node lui-même
// grâce au « type stripping » natif (Node >= 22.18), sans le chargeur de tsx.
import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timeoutMessage, type WorkerRequest, type WorkerResponse } from "./protocol.ts";
import { DEFAULT_TIMEOUT_MS, type Language, type RunOptions, type RunResult } from "./types.ts";

export { outputsMatch, normalizeOutput } from "./compare.ts";
export { DEFAULT_TIMEOUT_MS, LANGUAGES } from "./types.ts";
export type { Language, RunOptions, RunResult } from "./types.ts";

/** Délai maximal de chargement d'un moteur (clang ~100 Mo à compiler au premier appel). */
const LOAD_TIMEOUT_MS = 120_000;

/**
 * Un processus déjà chaud répond en quelques ms par un message `phase`. Sans réponse dans ce
 * délai, il est considéré bloqué (code d'une exécution précédente encore actif, p. ex. une
 * minuterie posée via globalThis) : il est tué et la requête relancée sur un processus neuf.
 */
const STALL_MS = 2_000;

const STALLED = Symbol("stalled");

const RUNNERS_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(RUNNERS_DIR, "node-worker.ts");

/** Racine d'un paquet de node_modules (dossier contenant son package.json). */
function packageRoot(require: NodeJS.Require, name: string): string {
  let dir = path.dirname(require.resolve(name));
  while (!fs.existsSync(path.join(dir, "package.json"))) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error(`package.json introuvable pour ${name}`);
    dir = up;
  }
  return dir;
}

let readPaths: string[] | null = null;

/**
 * Chemins lisibles par le bac à sable : le code des moteurs (ce dossier) et les trois paquets
 * de moteurs (clang, Pyodide, shim WASI). Rien d'autre :
 * ni storage/, ni .env, ni le reste du dépôt.
 */
export function sandboxReadPaths(): string[] {
  if (!readPaths) {
    const require = createRequire(import.meta.url);
    const pkgs = ["@yowasp/clang", "pyodide", "@bjorn3/browser_wasi_shim"].map((n) => packageRoot(require, n));
    readPaths = [RUNNERS_DIR, ...pkgs];
  }
  return readPaths;
}

/**
 * Options Node du processus enfant : modèle de permissions avec lecture restreinte.
 * Volontairement absents : --allow-fs-write, --allow-child-process, --allow-worker,
 * --allow-addons, --allow-wasi, --allow-inspector.
 */
export function sandboxArgs(): string[] {
  return ["--permission", ...sandboxReadPaths().map((p) => `--allow-fs-read=${p}`)];
}

const stderrTails = new WeakMap<ChildProcess, () => string>();

/** ref/unref du processus ET de son canal IPC (sinon le canal garde le parent en vie). */
function setRef(child: ChildProcess, on: boolean): void {
  const channel = (child as ChildProcess & { channel?: { ref(): void; unref(): void } | null }).channel;
  if (on) {
    child.ref();
    channel?.ref();
  } else {
    child.unref();
    channel?.unref();
  }
}

/** Tue le processus enfant et attend sa fin. */
function killChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGKILL");
  });
}

function spawnSandbox(): ChildProcess {
  const child = fork(WORKER_PATH, [], {
    execPath: process.execPath,
    execArgv: sandboxArgs(),
    env: {} as NodeJS.ProcessEnv, // aucun secret hérité (le solveur a chargé .env dans process.env)
    cwd: RUNNERS_DIR,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    serialization: "json",
  });
  // Diagnostic en cas de plantage : on garde la fin de stderr (bornée).
  let tail = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (d: string) => {
    tail = (tail + d).slice(-2000);
  });
  (child.stderr as (NodeJS.ReadableStream & { unref?: () => void }) | null)?.unref?.();
  stderrTails.set(child, () => tail);
  return child;
}

class Lane {
  private worker: ChildProcess | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private nextId = 1;
  private readonly lang: Language;
  /** Processus ayant déjà rendu un résultat (moteur chargé). */
  private readonly warm = new WeakSet<ChildProcess>();

  constructor(lang: Language) {
    this.lang = lang;
  }

  run(code: string, stdin: string, timeoutMs: number): Promise<RunResult> {
    const p = this.queue.then(async () => {
      const r = await this.exec(code, stdin, timeoutMs);
      return r === STALLED ? ((await this.exec(code, stdin, timeoutMs)) as RunResult) : r;
    });
    this.queue = p.catch(() => {});
    return p;
  }

  async dispose(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    if (w) await killChild(w);
  }

  private ensureWorker(): ChildProcess {
    if (!this.worker) {
      this.worker = spawnSandbox();
      setRef(this.worker, false);
    }
    return this.worker;
  }

  private exec(code: string, stdin: string, timeoutMs: number): Promise<RunResult | typeof STALLED> {
    return new Promise<RunResult | typeof STALLED>((resolve) => {
      const worker = this.ensureWorker();
      const warm = this.warm.has(worker);
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

      const finish = (r: RunResult | typeof STALLED, kill: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(loadTimer);
        clearTimeout(runTimer);
        worker.off("message", onMessage);
        worker.off("error", onError);
        worker.off("exit", onExit);
        if (kill) {
          if (this.worker === worker) this.worker = null;
          void killChild(worker);
        } else {
          setRef(worker, false);
        }
        resolve(r);
      };

      const onMessage = (m: WorkerResponse) => {
        if (!m || m.id !== id) return;
        if (m.type === "phase") {
          phase = m.phase;
          if (!runTimer) {
            clearTimeout(loadTimer);
            startedAt = performance.now();
            runTimer = setTimeout(() => finish(fail(timeoutMessage(timeoutMs), true), true), timeoutMs);
          }
        } else if (m.type === "result") {
          this.warm.add(worker);
          finish(m.result, false);
        } else {
          finish(fail(m.message, false), false);
        }
      };
      const onError = (e: Error) => finish(fail(`Erreur du moteur d'exécution : ${e.message}`, false), true);
      const onExit = (code: number | null, signal: string | null) => {
        const tail = stderrTails.get(worker)?.().trim();
        finish(fail(`Le moteur d'exécution s'est arrêté (code ${code ?? signal}).${tail ? `\n${tail}` : ""}`, false), true);
      };

      const loadTimer = setTimeout(
        () => finish(warm ? STALLED : fail("Le moteur d'exécution n'a pas pu être chargé à temps.", false), true),
        warm ? STALL_MS : LOAD_TIMEOUT_MS,
      );

      worker.on("message", onMessage);
      worker.on("error", onError);
      worker.on("exit", onExit);
      setRef(worker, true); // garde le parent en vie tant qu'une exécution est en cours
      const req: WorkerRequest = { id, lang: this.lang, code, stdin };
      worker.send(req, (e) => {
        if (e) finish(fail(`Erreur du moteur d'exécution : ${e.message}`, false), true);
      });
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
 * Compile (C) et exécute `code` avec `stdin` comme entrée standard, dans le bac à sable.
 * Le délai (`timeoutMs`, défaut 5 s) couvre compilation + exécution, pas le chargement du moteur.
 * Les exécutions d'un même langage sont traitées l'une après l'autre.
 */
export function runCode(lang: Language, code: string, stdin: string, opts: RunOptions = {}): Promise<RunResult> {
  if (lang !== "c" && lang !== "python" && lang !== "javascript") {
    return Promise.reject(new Error(`Langage non pris en charge : ${String(lang)}`));
  }
  return lane(lang).run(code, stdin, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
}

/** Termine tous les processus enfants (fin des tests, arrêt du solveur). */
export async function disposeRunners(): Promise<void> {
  const all = [...lanes.values()];
  lanes.clear();
  await Promise.all(all.map((l) => l.dispose()));
}
