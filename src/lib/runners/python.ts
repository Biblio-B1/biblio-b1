// Python : Pyodide (CPython en WebAssembly), bibliothèque standard seulement.
// Une instance Pyodide est réutilisée ; chaque exécution a ses propres globales et builtins,
// sys.stdin (StringIO sur l'entrée fournie) et sys.stdout/sys.stderr capturés ; ensuite
// l'état de l'interpréteur est restauré (sys.modules, attributs des modules, sys.path,
// limite de récursion) pour qu'une exécution ne puisse pas influencer la suivante.
import { MAX_OUTPUT_CHARS, type PhaseListener, type PyodideLike, type RunResult } from "./types.ts";
import { TRUNCATED_NOTE } from "./output.ts";

// Définit la fonction d'exécution dans un espace de noms privé et la renvoie.
const HELPER = `
def __biblio_make_runner():
    import builtins, io, sys, traceback

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

    # Références capturées : le code utilisateur peut modifier les vrais modules pendant l'exécution.
    _StringIO = io.StringIO
    _print = builtins.print
    _print_exc = traceback.print_exc
    _print_exception = traceback.print_exception
    _compile, _exec, _dict = compile, exec, dict
    _builtins_dict = builtins.__dict__
    # Instantané de l'état de l'interpréteur après initialisation : restauré après chaque
    # exécution (modules ajoutés retirés, attributs des modules déjà chargés remis en place).
    _modules = sys.modules
    _snapshot = {name: (mod, dict(getattr(mod, "__dict__", {}))) for name, mod in list(_modules.items())}
    _path = list(sys.path)
    _limit = sys.getrecursionlimit()
    _std = (sys.stdin, sys.stdout, sys.stderr)

    def _restore():
        for name in list(_modules.keys()):
            if name not in _snapshot:
                del _modules[name]
        for name, (mod, saved) in _snapshot.items():
            if _modules.get(name) is not mod:
                _modules[name] = mod
            d = getattr(mod, "__dict__", None)
            if d is None:
                continue
            for k in [k for k in d if k not in saved]:
                del d[k]
            for k, v in saved.items():
                if d.get(k, _restore) is not v:
                    d[k] = v
        sys.path[:] = _path
        sys.setrecursionlimit(_limit)
        sys.stdin, sys.stdout, sys.stderr = _std

    def run(src, stdin_text, limit):
        out, err = _Capped(limit), _Capped(limit)
        sys.stdin, sys.stdout, sys.stderr = _StringIO(stdin_text), out, err
        phase, code = "run", 0
        try:
            try:
                compiled = _compile(src, "main.py", "exec")
            except SyntaxError:
                phase, code = "compile", 1
                _print_exc(limit=0, file=err)
            else:
                # builtins neufs : builtins.input = ... ne touche que cette copie.
                g = {"__name__": "__main__", "__builtins__": _dict(_builtins_dict)}
                try:
                    _exec(compiled, g)
                except SystemExit as e:
                    if e.code is None:
                        code = 0
                    elif isinstance(e.code, int):
                        code = e.code
                    else:
                        _print(e.code, file=err)
                        code = 1
                except BaseException as e:
                    code = 1
                    # Saute le cadre de cette fonction d'enrobage.
                    _print_exception(type(e), e, e.__traceback__.tb_next, file=err)
        finally:
            _restore()
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
