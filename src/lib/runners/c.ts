// C : compilation par clang/LLD en WebAssembly (@yowasp/clang, cible wasm32-wasi),
// puis exécution du binaire WASI avec @bjorn3/browser_wasi_shim (JS pur : même
// comportement dans Node et dans le navigateur). Aucun import `node:` ici.
import { ConsoleStdout, File, OpenFile, WASI } from "@bjorn3/browser_wasi_shim";
import { OutputBuffer, truncationNote } from "./output.ts";
import type { ClangModule, PhaseListener, RunClang, RunResult } from "./types.ts";

/** Options clang : C (gnu17 par défaut, accepte le C99), libm, pile de 8 Mo (récursion, tableaux locaux). */
export const CLANG_ARGS = ["clang", "-O2", "-lm", "-Wl,-z,stack-size=8388608", "main.c", "-o", "main.wasm"];

/**
 * Télécharge et compile les ressources de clang (~100 Mo) avant la première compilation,
 * pour que ce chargement ne compte pas dans le délai d'exécution.
 */
export async function prepareClang(mod: ClangModule): Promise<RunClang> {
  await mod.runLLVM(null, {}, { fetchProgress: () => {} });
  return mod.runClang;
}

export type CompileResult = { ok: true; wasm: Uint8Array; stderr: string } | { ok: false; stderr: string };

export async function compileC(runClang: RunClang, code: string): Promise<CompileResult> {
  const decoder = new TextDecoder();
  let stderr = "";
  const collect = (b: Uint8Array | null) => {
    if (b) stderr += decoder.decode(b, { stream: true });
  };
  try {
    const out = await runClang(CLANG_ARGS, { "main.c": code }, { stdout: collect, stderr: collect });
    const wasm = out?.["main.wasm"];
    if (!(wasm instanceof Uint8Array)) return { ok: false, stderr: stderr || "Compilation échouée." };
    return { ok: true, wasm, stderr };
  } catch (e) {
    // @yowasp lève `Exit` (code ≠ 0) quand clang échoue ; le diagnostic est déjà sur stderr.
    const isExit = typeof e === "object" && e !== null && "code" in e;
    return { ok: false, stderr: stderr || (isExit ? "Compilation échouée." : String(e)) };
  }
}

export type WasiRun = { exitCode: number | null; stdout: string; stderr: string };

/** Exécute un binaire WASI ; l'entrée standard est fournie en entier (EOF ensuite). */
export async function runWasi(wasm: Uint8Array, stdin: string): Promise<WasiRun> {
  const out = new OutputBuffer();
  const err = new OutputBuffer();
  const outDec = new TextDecoder();
  const errDec = new TextDecoder();
  const fds = [
    new OpenFile(new File(new TextEncoder().encode(stdin))),
    new ConsoleStdout((b: Uint8Array) => out.write(outDec.decode(b, { stream: true }))),
    new ConsoleStdout((b: Uint8Array) => err.write(errDec.decode(b, { stream: true }))),
  ];
  const wasi = new WASI(["main"], [], fds);
  let exitCode: number | null;
  try {
    const module = await WebAssembly.compile(wasm as BufferSource);
    const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });
    exitCode = wasi.start(instance as unknown as { exports: { memory: WebAssembly.Memory; _start: () => unknown } });
  } catch (e) {
    // Piège WebAssembly : accès mémoire hors limites, abort(), division par zéro…
    exitCode = null;
    err.write(`${err.text && !err.text.endsWith("\n") ? "\n" : ""}Erreur d'exécution : ${e instanceof Error ? e.message : String(e)}\n`);
  }
  return { exitCode, stdout: out.text, stderr: err.text + truncationNote(out, err) };
}

export async function runC(
  runClang: RunClang,
  code: string,
  stdin: string,
  onPhase: PhaseListener = () => {},
): Promise<RunResult> {
  const t0 = performance.now();
  onPhase("compile");
  const compiled = await compileC(runClang, code);
  if (!compiled.ok) {
    return { ok: false, stdout: "", stderr: compiled.stderr, phase: "compile", timedOut: false, exitCode: null, durationMs: Math.round(performance.now() - t0) };
  }
  onPhase("run");
  const r = await runWasi(compiled.wasm, stdin);
  return {
    ok: r.exitCode === 0,
    stdout: r.stdout,
    stderr: r.stderr,
    phase: "run",
    timedOut: false,
    exitCode: r.exitCode,
    durationMs: Math.round(performance.now() - t0),
  };
}
