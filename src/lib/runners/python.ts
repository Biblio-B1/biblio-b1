// Python : Pyodide (CPython en WebAssembly), bibliothèque standard seulement.
// Une instance Pyodide est réutilisée ; chaque exécution a ses propres globales,
// sys.stdin (StringIO sur l'entrée fournie) et sys.stdout/sys.stderr capturés.
import { MAX_OUTPUT_CHARS, type PhaseListener, type PyodideLike, type RunResult } from "./types.ts";
import { TRUNCATED_NOTE } from "./output.ts";

// Définit la fonction d'exécution dans un espace de noms privé et la renvoie.
const HELPER = `
def __biblio_make_runner():
    import io, sys, traceback

    class _Capped(io.TextIOBase):
        def __init__(self, limit):
            self.parts = []
            self.size = 0
            self.limit = limit
            self.truncated = False
        def writable(self):
            return True
        def write(self, s):
            s = str(s)
            if self.truncated:
                return len(s)
            room = self.limit - self.size
            if len(s) > room:
                s = s[:room]
                self.truncated = True
            self.parts.append(s)
            self.size += len(s)
            return len(s)
        def getvalue(self):
            return "".join(self.parts)

    def run(src, stdin_text, limit):
        out, err = _Capped(limit), _Capped(limit)
        saved = (sys.stdin, sys.stdout, sys.stderr)
        sys.stdin, sys.stdout, sys.stderr = io.StringIO(stdin_text), out, err
        phase, code = "run", 0
        try:
            try:
                compiled = compile(src, "main.py", "exec")
            except SyntaxError:
                phase, code = "compile", 1
                traceback.print_exc(limit=0)
            else:
                g = {"__name__": "__main__", "__builtins__": __builtins__}
                try:
                    exec(compiled, g)
                except SystemExit as e:
                    if e.code is None:
                        code = 0
                    elif isinstance(e.code, int):
                        code = e.code
                    else:
                        print(e.code, file=err)
                        code = 1
                except BaseException as e:
                    code = 1
                    # Saute le cadre de cette fonction d'enrobage.
                    traceback.print_exception(type(e), e, e.__traceback__.tb_next)
        finally:
            sys.stdin, sys.stdout, sys.stderr = saved
        return [phase, code, out.getvalue(), err.getvalue(), out.truncated or err.truncated]

    return run

__biblio_make_runner()
`;

type PyProxyFn = ((...args: unknown[]) => { toJs(): unknown[]; destroy(): void }) & { destroy?: () => void };

const runners = new WeakMap<PyodideLike, PyProxyFn>();

function getRunner(py: PyodideLike): PyProxyFn {
  let fn = runners.get(py);
  if (!fn) {
    fn = py.runPython(HELPER) as PyProxyFn;
    runners.set(py, fn);
  }
  return fn;
}

export async function runPython(
  py: PyodideLike,
  code: string,
  stdin: string,
  onPhase: PhaseListener = () => {},
): Promise<RunResult> {
  const run = getRunner(py);
  const t0 = performance.now();
  onPhase("run");
  const proxy = run(code, stdin, MAX_OUTPUT_CHARS);
  const [phase, exitCode, stdout, stderr, truncated] = proxy.toJs() as ["compile" | "run", number, string, string, boolean];
  proxy.destroy();
  return {
    ok: phase === "run" && exitCode === 0,
    stdout,
    stderr: stderr + (truncated ? TRUNCATED_NOTE : ""),
    phase,
    timedOut: false,
    exitCode: phase === "compile" ? null : exitCode,
    durationMs: Math.round(performance.now() - t0),
  };
}
