// Messages échangés avec le moteur d'exécution (processus enfant Node via IPC, ou Web Worker).
import type { Language, RunResult } from "./types.ts";

export type WorkerRequest = { id: number; lang: Language; code: string; stdin: string };

export type WorkerResponse =
  | { id: number; type: "phase"; phase: "compile" | "run" }
  | { id: number; type: "result"; result: RunResult }
  | { id: number; type: "error"; message: string };

export function timeoutMessage(timeoutMs: number): string {
  const s = Math.round(timeoutMs / 100) / 10;
  return `Délai dépassé (${String(s).replace(".", ",")} s) : le programme a été arrêté (boucle infinie ou attente d'une entrée ?).`;
}
