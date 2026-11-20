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
import type { ClangModule, PyodideLike } from "./types.ts";

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
      const mod = (await importUrl(`${base}/pyodide/pyodide.mjs`)) as {
        loadPyodide(o: { indexURL: string }): Promise<PyodideLike>;
      };
      return mod.loadPyodide({ indexURL: `${base}/pyodide/` });
    },
  });
}

type WorkerScope = {
  postMessage(m: WorkerResponse): void;
  addEventListener(type: "message", fn: (e: { data: WorkerRequest }) => void): void;
};

/** Branche le protocole de protocol.ts sur un Web Worker. */
export function attachWorkerProtocol(scope: WorkerScope, engine: Engine): void {
  let queue: Promise<void> = Promise.resolve();
  scope.addEventListener("message", (e) => {
    const req = e.data;
    queue = queue.then(() => handle(req));
  });

  async function handle(req: WorkerRequest): Promise<void> {
    try {
      const result = await engine.execute(req.lang, req.code, req.stdin, (phase) =>
        scope.postMessage({ id: req.id, type: "phase", phase }),
      );
      scope.postMessage({ id: req.id, type: "result", result });
    } catch (err) {
      scope.postMessage({ id: req.id, type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }
}
