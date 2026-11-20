// Point d'entrée navigateur (aucun import `node:`) — à importer depuis un Web Worker (Task 4).
// Les runtimes sont servis par Next depuis public/runtimes/ (copiés par scripts/copy-runtimes.mjs) :
//   /runtimes/clang/bundle.js   (+ llvm*.wasm, llvm-resources.tar, chargés relativement au bundle)
//   /runtimes/pyodide/pyodide.mjs (+ pyodide.asm.wasm, python_stdlib.zip, pyodide-lock.json)
//
// Exemple de worker :
//   import { attachWorkerProtocol, createBrowserEngine } from "@/lib/runners/browser.ts";
//   attachWorkerProtocol(self, createBrowserEngine());
// Côté page : `postMessage({ id, lang, code, stdin })`, messages `phase` puis `result` / `error`
// (voir protocol.ts). Le délai s'applique côté page : `worker.terminate()` au premier message
// `phase` + timeoutMs, puis nouveau Worker (le moteur sera rechargé, depuis le cache HTTP).
// Les requêtes sont traitées une à une (file FIFO). Un worker déjà chaud qui n'envoie pas
// `phase` en ~2 s est bloqué (code d'une exécution précédente) : le terminer et relancer
// la requête sur un worker neuf (même règle que index.ts côté Node).
import { prepareClang } from "./c.ts";
import { createEngine, type Engine } from "./engine.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";
import type { ClangModule, Language, PyodideLike } from "./types.ts";

export { createEngine } from "./engine.ts";
export type { Engine } from "./engine.ts";
export { outputsMatch, normalizeOutput } from "./compare.ts";
export { timeoutMessage } from "./protocol.ts";
export type { WorkerRequest, WorkerResponse } from "./protocol.ts";
export { DEFAULT_TIMEOUT_MS, LANGUAGES } from "./types.ts";
export type { Language, RunResult } from "./types.ts";

// Import d'une URL servie par Next, hors bundle webpack.
const importUrl = (url: string): Promise<unknown> => import(/* webpackIgnore: true */ url);

export function createBrowserEngine(baseUrl = "/runtimes"): Engine {
  const base = baseUrl.replace(/\/$/, "");
  return createEngine({
    async clang() {
      return prepareClang((await importUrl(`${base}/clang/bundle.js`)) as ClangModule);
    },
    async pyodide() {
      // webpack transforme `new Worker(url, { type: "module" })` en worker classique (chunks
      // chargés par importScripts) ; Pyodide refuse alors de démarrer (« Classic web workers
      // are not supported »). Pendant son chargement, importScripts est masqué : Pyodide
      // emprunte le chemin « module worker » (import() natif de pyodide.asm.mjs, qui fonctionne).
      // Vérifié avec pyodide 314.0.8 (version épinglée dans package.json) : son test
      // « isClassicWorker » appelle importScripts("data:…") et ne regarde que si l’appel lève.
      // À revérifier à chaque mise à jour de Pyodide (si le test change, ce masquage peut devenir
      // inutile ou insuffisant : symptôme « Classic web workers are not supported » dans le worker).
      const g = globalThis as { importScripts?: unknown };
      const saved = g.importScripts;
      if (typeof saved === "function") {
        g.importScripts = () => {
          throw new TypeError("importScripts masqué pendant le chargement de Pyodide");
        };
      }
      try {
        const mod = (await importUrl(`${base}/pyodide/pyodide.mjs`)) as {
          loadPyodide(o: { indexURL: string }): Promise<PyodideLike>;
        };
        return await mod.loadPyodide({ indexURL: `${base}/pyodide/` });
      } finally {
        if (typeof saved === "function") g.importScripts = saved;
      }
    },
  });
}

/** Préchauffage (navigateur uniquement) : charge le moteur sans rien exécuter, réponse `ready`. */
export type PrepareRequest = { id: number; type: "prepare"; lang: Language };
export type BrowserWorkerRequest = WorkerRequest | PrepareRequest;
export type BrowserWorkerResponse = WorkerResponse | { id: number; type: "ready" };

type WorkerScope = {
  postMessage(m: BrowserWorkerResponse): void;
  addEventListener(type: "message", fn: (e: { data: BrowserWorkerRequest }) => void): void;
};

/** Branche le protocole de protocol.ts (+ `prepare`) sur un Web Worker. */
export function attachWorkerProtocol(scope: WorkerScope, engine: Engine): void {
  let queue: Promise<void> = Promise.resolve();
  scope.addEventListener("message", (e) => {
    const req = e.data;
    // `.catch` : un postMessage qui lève (résultat non clonable…) ne doit pas bloquer la file.
    queue = queue.then(() => handle(req)).catch(() => {});
  });

  async function handle(req: BrowserWorkerRequest): Promise<void> {
    try {
      if ("type" in req && req.type === "prepare") {
        await engine.prepare(req.lang);
        scope.postMessage({ id: req.id, type: "ready" });
        return;
      }
      const run = req as WorkerRequest;
      const result = await engine.execute(run.lang, run.code, run.stdin, (phase) =>
        scope.postMessage({ id: run.id, type: "phase", phase }),
      );
      scope.postMessage({ id: run.id, type: "result", result });
    } catch (err) {
      scope.postMessage({ id: req.id, type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }
}
