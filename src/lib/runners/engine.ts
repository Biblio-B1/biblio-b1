// Cœur commun Node / navigateur : choisit le moteur et charge les runtimes WASM à la demande.
// À exécuter DANS un Worker (le délai est appliqué en terminant ce Worker).
import { runC } from "./c.ts";
import { runJavaScript } from "./javascript.ts";
import { runPython } from "./python.ts";
import type { Language, PhaseListener, PyodideLike, RunClang, RunResult, RuntimeLoaders } from "./types.ts";

export type Engine = {
  /** Charge le moteur d'un langage sans rien exécuter (préchauffage). */
  prepare(lang: Language): Promise<void>;
  execute(lang: Language, code: string, stdin: string, onPhase?: PhaseListener): Promise<RunResult>;
};

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => {
    if (!p) {
      p = load().catch((e) => {
        p = null; // nouvel essai au prochain appel
        throw e;
      });
    }
    return p;
  };
}

export function createEngine(loaders: RuntimeLoaders): Engine {
  const clang = once<RunClang>(() => loaders.clang());
  const pyodide = once<PyodideLike>(() => loaders.pyodide());

  async function prepare(lang: Language): Promise<void> {
    if (lang === "c") await clang();
    else if (lang === "python") await pyodide();
  }

  async function execute(lang: Language, code: string, stdin: string, onPhase?: PhaseListener): Promise<RunResult> {
    switch (lang) {
      case "c":
        return runC(await clang(), code, stdin, onPhase);
      case "python":
        return runPython(await pyodide(), code, stdin, onPhase);
      case "javascript":
        return runJavaScript(code, stdin, onPhase);
      default:
        throw new Error(`Langage non pris en charge : ${String(lang)}`);
    }
  }

  return { prepare, execute };
}
