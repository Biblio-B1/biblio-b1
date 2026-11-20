// Worker Node (worker_threads) : charge les moteurs depuis node_modules et exécute les requêtes.
// Lancé par index.ts ; chargé par Node directement (type stripping), d'où les imports `.ts`.
import { parentPort } from "node:worker_threads";
import { prepareClang } from "./c.ts";
import { createEngine } from "./engine.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";
import type { ClangModule, PyodideLike } from "./types.ts";

const engine = createEngine({
  async clang() {
    return prepareClang((await import("@yowasp/clang")) as unknown as ClangModule);
  },
  async pyodide() {
    const { loadPyodide } = await import("pyodide");
    return (await loadPyodide()) as unknown as PyodideLike;
  },
});

const port = parentPort;
if (!port) throw new Error("node-worker.ts doit être lancé dans un worker_thread");

const send = (m: WorkerResponse) => port.postMessage(m);

port.on("message", async (req: WorkerRequest) => {
  try {
    const result = await engine.execute(req.lang, req.code, req.stdin, (phase) => send({ id: req.id, type: "phase", phase }));
    send({ id: req.id, type: "result", result });
  } catch (e) {
    send({ id: req.id, type: "error", message: e instanceof Error ? e.message : String(e) });
  }
});
