// JavaScript : le code est exécuté dans le Worker courant avec l'API décrite par
// `JavaScriptStudentApi` (types.ts) : input()/readline() pour l'entrée, console pour les sorties.
// Le délai est assuré par l'appelant (Worker terminé à l'échéance).
import { OutputBuffer, truncationNote } from "./output.ts";
import type { JavaScriptStudentApi, PhaseListener, RunResult } from "./types.ts";

/** Formatage déterministe (identique Node / navigateur) d'une valeur affichée par console.log. */
export function formatValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === undefined || typeof v === "function" || typeof v === "symbol" || typeof v === "bigint") return String(v);
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === "object" && v !== null) {
    try {
      const json = JSON.stringify(v);
      if (json !== undefined) return json;
    } catch {
      // référence circulaire : repli sur String()
    }
  }
  return String(v);
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

export async function runJavaScript(code: string, stdin: string, onPhase: PhaseListener = () => {}): Promise<RunResult> {
  const t0 = performance.now();
  const out = new OutputBuffer();
  const err = new OutputBuffer();
  const lines = stdin.length === 0 ? [] : stdin.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  let next = 0;
  const input = () => (next < lines.length ? lines[next++] : null);
  const line = (args: unknown[]) => args.map(formatValue).join(" ") + "\n";
  const api: JavaScriptStudentApi = {
    input,
    readline: input,
    console: {
      log: (...a: unknown[]) => out.write(line(a)),
      info: (...a: unknown[]) => out.write(line(a)),
      debug: (...a: unknown[]) => out.write(line(a)),
      error: (...a: unknown[]) => err.write(line(a)),
      warn: (...a: unknown[]) => err.write(line(a)),
    },
  };
  const done = (phase: "compile" | "run", exitCode: number | null): RunResult => ({
    ok: phase === "run" && exitCode === 0,
    stdout: out.text,
    stderr: err.text + truncationNote(out, err),
    phase,
    timedOut: false,
    exitCode,
    durationMs: Math.round(performance.now() - t0),
  });

  let fn: (...args: unknown[]) => Promise<unknown>;
  try {
    fn = new AsyncFunction("input", "readline", "console", code);
  } catch (e) {
    err.write(formatValue(e) + "\n");
    return done("compile", null);
  }
  onPhase("run");
  try {
    await fn(api.input, api.readline, api.console);
    return done("run", 0);
  } catch (e) {
    err.write(formatValue(e) + "\n");
    return done("run", 1);
  }
}

