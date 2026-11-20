// Processus enfant bac à sable (solveur, tests) : charge les moteurs depuis node_modules et
// exécute les requêtes reçues par le canal IPC. Lancé par index.ts avec le modèle de
// permissions de Node (`--permission`, lecture limitée au code des moteurs, ni écriture,
// ni processus enfant, ni worker, ni addon natif). Chargé par Node directement
// (« type stripping »), d'où les imports `.ts`.
import { constants } from "node:fs";
import os from "node:os";
import { prepareClang } from "./c.ts";
import { createEngine } from "./engine.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";
import type { ClangModule, PyodideLike } from "./types.ts";

if (typeof process.send !== "function") throw new Error("node-worker.ts doit être lancé par child_process.fork");

// Sous `--permission`, process.binding() est refusé ; or Pyodide (NODEFS.staticInit) lit
// process.binding("constants").fs au chargement. On fournit ces seules constantes publiques
// (aucune capacité supplémentaire) ; tout autre binding reste refusé.
{
  const proc = process as unknown as { binding: (name: string) => unknown };
  const denied = proc.binding.bind(process);
  proc.binding = (name: string) => (name === "constants" ? { fs: constants, os: os.constants } : denied(name));
}

const engine = createEngine({
  async clang() {
    return prepareClang((await import("@yowasp/clang")) as unknown as ClangModule);
  },
  async pyodide() {
    const { loadPyodide } = await import("pyodide");
    return (await loadPyodide()) as unknown as PyodideLike;
  },
});

const send = (m: WorkerResponse) => {
  process.send?.(m);
};

// Le parent a disparu (arrêt, plantage) : ne pas survivre seul.
process.on("disconnect", () => process.exit(0));

process.on("message", async (req: WorkerRequest) => {
  try {
    const result = await engine.execute(req.lang, req.code, req.stdin, (phase) => send({ id: req.id, type: "phase", phase }));
    send({ id: req.id, type: "result", result });
  } catch (e) {
    send({ id: req.id, type: "error", message: e instanceof Error ? e.message : String(e) });
  }
});
