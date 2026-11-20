import { describe, expect, it } from "vitest";
import {
  checkMode,
  computeVerdict,
  diffLines,
  initialCode,
  STARTER_TEMPLATES,
  type TestOutcome,
} from "@/lib/code-check";
import type { RunResult } from "@/lib/runners/types";

const res = (o: Partial<RunResult>): RunResult => ({
  ok: true,
  stdout: "",
  stderr: "",
  phase: "run",
  timedOut: false,
  exitCode: 0,
  durationMs: 1,
  ...o,
});

const tests = [
  { input: "1 2\n", expected: "3\n", visible: true },
  { input: "5 5\n", expected: "10\n", visible: false },
  { input: "-1 1\n", expected: "0\n", visible: false },
];

describe("gabarits", () => {
  it("un gabarit par langage", () => {
    expect(STARTER_TEMPLATES.c).toBe("#include <stdio.h>\n\nint main(void) {\n    \n    return 0;\n}");
    expect(STARTER_TEMPLATES.python).toBe("# Lisez l'entrée avec input()\n");
    expect(STARTER_TEMPLATES.javascript).toBe("// input() renvoie la ligne suivante de l'entrée (ou null)\n");
  });
  it("code initial = dernier essai du même langage, sinon gabarit", () => {
    expect(initialCode("c", { language: "c", code: "int main(){}" })).toBe("int main(){}");
    expect(initialCode("c", { language: "python", code: "print(1)" })).toBe(STARTER_TEMPLATES.c);
    expect(initialCode("python", null)).toBe(STARTER_TEMPLATES.python);
    expect(initialCode("c", { language: "c", code: "" })).toBe(STARTER_TEMPLATES.c);
  });
});

describe("checkMode", () => {
  it("ready avec langage et tests → vérification", () => {
    expect(checkMode({ status: "ready", language: "c", tests })).toEqual({ kind: "ready", language: "c" });
  });
  it("pending/running → préparation, éditeur si langage connu", () => {
    expect(checkMode({ status: "pending", language: null, tests: [] })).toEqual({ kind: "preparing", language: null });
    expect(checkMode({ status: "running", language: "python", tests: [] })).toEqual({ kind: "preparing", language: "python" });
  });
  it("no_code / absence de ligne → rien", () => {
    expect(checkMode({ status: "no_code", language: null, tests: [] })).toEqual({ kind: "none", language: null });
    expect(checkMode(null)).toEqual({ kind: "none", language: null });
  });
  it("unsupported/failed → pas de vérif, éditeur seulement si langage connu", () => {
    expect(checkMode({ status: "failed", language: "c", tests: [] })).toEqual({ kind: "none", language: "c" });
    expect(checkMode({ status: "unsupported", language: null, tests: [] })).toEqual({ kind: "none", language: null });
  });
  it("ready sans tests ou sans langage → rien de vérifiable", () => {
    expect(checkMode({ status: "ready", language: "c", tests: [] })).toEqual({ kind: "none", language: "c" });
    expect(checkMode({ status: "ready", language: null, tests })).toEqual({ kind: "none", language: null });
  });
  it("no_code masque l'éditeur même avec un langage", () => {
    expect(checkMode({ status: "no_code", language: "c", tests: [] })).toEqual({ kind: "none", language: null });
  });
});

describe("computeVerdict", () => {
  it("tout juste → passed", () => {
    const v = computeVerdict(tests, [res({ stdout: "3\n" }), res({ stdout: "10" }), res({ stdout: "0  \n\n" })]);
    expect(v.passed).toBe(true);
    expect(v.compileError).toBeNull();
    expect(v.outcomes.map((o) => o.status)).toEqual(["ok", "ok", "ok"]);
  });

  it("sortie fausse → wrong, détails seulement pour le test visible", () => {
    const v = computeVerdict(tests, [res({ stdout: "4\n" }), res({ stdout: "11\n" }), res({ stdout: "0\n" })]);
    expect(v.passed).toBe(false);
    expect(v.outcomes[0]).toMatchObject({ status: "wrong", visible: true, input: "1 2\n", expected: "3\n", actual: "4\n" });
    const hidden = v.outcomes[1] as TestOutcome;
    expect(hidden.status).toBe("wrong");
    expect(hidden.input).toBeUndefined();
    expect(hidden.expected).toBeUndefined();
    expect(hidden.actual).toBeUndefined();
    expect(v.outcomes[2].status).toBe("ok");
  });

  it("délai dépassé et erreur d'exécution", () => {
    const v = computeVerdict(tests, [
      res({ stdout: "3\n" }),
      res({ ok: false, timedOut: true, exitCode: null, stderr: "Délai" }),
      res({ ok: false, exitCode: 1, stdout: "0\n", stderr: "Erreur d'exécution : unreachable" }),
    ]);
    expect(v.outcomes.map((o) => o.status)).toEqual(["ok", "timeout", "runtime"]);
    expect(v.passed).toBe(false);
  });

  it("erreur de compilation → compileError, tests non exécutés", () => {
    const v = computeVerdict(tests, [res({ ok: false, phase: "compile", exitCode: null, stderr: "main.c:1: error" })]);
    expect(v.compileError).toBe("main.c:1: error");
    expect(v.passed).toBe(false);
    expect(v.outcomes.map((o) => o.status)).toEqual(["compile", "skipped", "skipped"]);
  });

  it("résultats manquants (arrêt après délai) → skipped", () => {
    const v = computeVerdict(tests, [res({ ok: false, timedOut: true, exitCode: null })]);
    expect(v.outcomes.map((o) => o.status)).toEqual(["timeout", "skipped", "skipped"]);
    expect(v.passed).toBe(false);
  });

  it("le test visible garde stderr pour l'affichage", () => {
    const v = computeVerdict(tests.slice(0, 1), [res({ ok: false, exitCode: 2, stderr: "boom" })]);
    expect(v.outcomes[0]).toMatchObject({ status: "runtime", stderr: "boom" });
  });

  it("aucun test → jamais réussi", () => {
    expect(computeVerdict([], []).passed).toBe(false);
  });
});

describe("diffLines", () => {
  it("marque les lignes différentes (comparaison normalisée)", () => {
    expect(diffLines("a\nb\nc\n", "a  \nx\n")).toEqual([
      { expected: "a", actual: "a", same: true },
      { expected: "b", actual: "x", same: false },
      { expected: "c", actual: null, same: false },
    ]);
  });
  it("sortie plus longue que l'attendue", () => {
    expect(diffLines("1", "1\n2")).toEqual([
      { expected: "1", actual: "1", same: true },
      { expected: null, actual: "2", same: false },
    ]);
  });
  it("sorties vides", () => {
    expect(diffLines("", "")).toEqual([]);
  });
});
