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

// Le modèle de permissions ne couvre pas ces fonctions de `process` : `_debugProcess(pid)` active
// l'inspecteur V8 d'un AUTRE processus (le solveur, non isolé : évasion complète via le réseau
// local), `kill(pid, "SIGUSR1")` fait de même sous Linux et `kill(ppid)` tue le parent.
// Retirées AVANT tout code exécuté, et figées (non modifiables, non supprimables).
export const LOCKED_PROCESS_FUNCTIONS = ["_debugProcess", "_debugEnd", "kill", "_kill", "binding"] as const;
for (const name of LOCKED_PROCESS_FUNCTIONS) {
  const keep = name === "binding" ? (process as unknown as Record<string, unknown>).binding : null;
  Object.defineProperty(process, name, {
    value:
      keep ??
      function locked(): never {
        throw new Error(`process.${name} n'est pas disponible dans le bac à sable`);
      },
    writable: false,
    configurable: false,
    enumerable: false,
  });
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
