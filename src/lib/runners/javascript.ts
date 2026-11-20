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

  // Minuteries fournies au code : suivies pour que l'exécution attende celles en attente
  // (leur sortie est capturée) et qu'aucune ne survive à la fin de l'exécution.
  let failure: unknown = undefined;
  const timers = createTimers((e) => {
    if (failure === undefined) failure = e;
  });

  let fn: (...args: unknown[]) => Promise<unknown>;
  try {
    fn = new AsyncFunction("input", "readline", "console", ...TIMER_NAMES, code);
  } catch (e) {
    err.write(formatValue(e) + "\n");
    return done("compile", null);
  }
  onPhase("run");
  try {
    await fn(api.input, api.readline, api.console, ...timers.api);
    await timers.idle(() => failure !== undefined);
  } catch (e) {
    if (failure === undefined) failure = e;
  } finally {
    timers.clearAll();
  }
  if (failure !== undefined) {
    err.write(formatValue(failure) + "\n");
    return done("run", 1);
  }
  return done("run", 0);
}

const TIMER_NAMES = ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] as const;

type Callback = (...args: unknown[]) => unknown;

function createTimers(onError: (e: unknown) => void) {
  const pending = new Map<number, { kind: "timeout" | "interval"; handle: ReturnType<typeof setTimeout> }>();
  let nextId = 1;
  let wake: (() => void) | null = null;
  let stopped = false;
  const notify = () => wake?.();

  const invoke = (cb: unknown, args: unknown[]) => {
    if (stopped) return;
    try {
      const r = typeof cb === "function" ? (cb as Callback)(...args) : undefined;
      if (r && typeof (r as Promise<unknown>).then === "function") (r as Promise<unknown>).then(undefined, (e) => {
          onError(e);
          notify();
        });
    } catch (e) {
      onError(e);
    }
    notify();
  };

  const setT = (cb: unknown, ms?: number, ...args: unknown[]): number => {
    const id = nextId++;
    const handle = setTimeout(() => {
      pending.delete(id);
      invoke(cb, args);
    }, Number(ms) || 0);
    pending.set(id, { kind: "timeout", handle });
    return id;
  };
  const setI = (cb: unknown, ms?: number, ...args: unknown[]): number => {
    const id = nextId++;
    const handle = setInterval(() => invoke(cb, args), Number(ms) || 0);
    pending.set(id, { kind: "interval", handle });
    return id;
  };
  const clear = (id: unknown) => {
    const t = pending.get(id as number);
    if (!t) return;
    if (t.kind === "timeout") clearTimeout(t.handle);
    else clearInterval(t.handle);
    pending.delete(id as number);
    notify();
  };

  return {
    api: [setT, setI, clear, clear] as unknown[],
    /** Résout quand plus aucune minuterie n'est en attente (ou si `stop()` devient vrai). */
    idle(stop: () => boolean): Promise<void> {
      return new Promise<void>((resolve) => {
        const check = () => {
          if (pending.size === 0 || stop()) {
            wake = null;
            resolve();
          }
        };
        wake = () => queueMicrotask(check);
        check();
      });
    },
    clearAll() {
      stopped = true;
      for (const id of [...pending.keys()]) clear(id);
    },
  };
}
