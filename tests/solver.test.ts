import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "@/server/db/client";
import { documents, exerciseChecks, exercises, subjects } from "@/server/db/schema";
import { claimCheck, enqueueCheck, getCheck } from "@/server/checks";
import { askModel, OllamaUnavailableError } from "@/server/solver/ollama";
import { buildSolvePrompt, preferredLanguage } from "@/server/solver/prompt";
import { extractProfCode, processNext, solveExercise, type SolveDeps } from "@/server/solver/solve";
import { disposeRunners } from "@/lib/runners";

// Les moteurs réels (clang WASM, Pyodide, Worker JS) servent à calculer les sorties attendues.
afterAll(async () => {
  await disposeRunners();
});

const LONG = 120_000;

let db: Db;
let docId: string;
let cSubject: string;

const C_DOUBLE = `#include <stdio.h>
int main(void) {
    int n;
    if (scanf("%d", &n) != 1) return 1;
    printf("%d\\n", n * 2);
    return 0;
}
`;

const PY_SUM = "a, b = map(int, input().split())\nprint(a + b)\n";

const fourTests = (inputs = ["1 2", "0 0", "-3 3", "100 200"]) =>
  inputs.map((input, i) => ({ input, note: `test ${i}` }));

/** Faux fetch : rend les réponses dans l'ordre, enregistre les corps des requêtes. */
function fakeFetch(responses: (unknown | Error | ((body: Record<string, unknown>) => unknown))[]) {
  const calls: Record<string, unknown>[] = [];
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    let r = responses.shift();
    if (typeof r === "function") r = (r as (b: Record<string, unknown>) => unknown)(body);
    if (r instanceof Error) throw r;
    if (r === undefined) throw new Error("appel inattendu au modèle");
    const response = typeof r === "string" ? r : JSON.stringify(r);
    return new Response(JSON.stringify({ model: "m", response, done: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { impl, calls };
}

const deps = (fetchImpl: typeof fetch): SolveDeps => ({
  url: "http://ollama.test:11434",
  model: "qwen-test",
  fetchImpl,
  runTimeoutMs: 5000,
});

function mkEx(opts: { statement?: string; solution?: string | null; subjectId?: string | null } = {}) {
  const id = db
    .insert(exercises)
    .values({
      documentId: docId,
      number: 1,
      title: "Exercice 1",
      statement: opts.statement ?? "Écrire un programme qui lit un entier et affiche son double.",
      solution: opts.solution ?? null,
      groupKey: crypto.randomUUID(),
      subjectId: opts.subjectId === undefined ? cSubject : opts.subjectId,
    })
    .returning()
    .get().id;
  enqueueCheck(db, id);
  expect(claimCheck(db, id)).toBe(true);
  return id;
}

function econnrefused(): Error {
  const e = new TypeError("fetch failed");
  (e as { cause?: unknown }).cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:11434"), {
    code: "ECONNREFUSED",
  });
  return e;
}

beforeEach(() => {
  db = createTestDb();
  cSubject = db
    .insert(subjects)
    .values({ name: "Algorithmique et Prog C", slug: "algo-c" })
    .returning()
    .get().id;
  docId = db
    .insert(documents)
    .values({ title: "TD", type: "exercise", filePath: "f", mime: "application/pdf", sha256: crypto.randomUUID(), source: "upload" })
    .returning()
    .get().id;
});

describe("askModel", () => {
  it("POST /api/generate avec stream:false, think:false, format = schéma JSON", async () => {
    let seenUrl = "";
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seenUrl = String(url);
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ response: '{"ok":true}' }));
    }) as unknown as typeof fetch;
    const schema = { type: "object", properties: { ok: { type: "boolean" } } };
    const out = await askModel("bonjour", schema, { url: "http://h:1/", model: "m", fetchImpl });
    expect(out).toEqual({ ok: true });
    expect(seenUrl).toBe("http://h:1/api/generate");
    expect(body).toMatchObject({ model: "m", prompt: "bonjour", stream: false, think: false, format: schema });
    expect(body.options).toMatchObject({ temperature: 0.2, num_ctx: 8192 });
  });

  it("fetch qui rejette → OllamaUnavailableError", async () => {
    const fetchImpl = (async () => {
      throw econnrefused();
    }) as unknown as typeof fetch;
    await expect(askModel("x", {}, { url: "http://h:1", model: "m", fetchImpl })).rejects.toBeInstanceOf(
      OllamaUnavailableError,
    );
  });
});

describe("prompt", () => {
  it("préfère le C pour le cours de C, sauf énoncé en Python", () => {
    expect(preferredLanguage("Algorithmique et Prog C", "Écrire un programme…")).toBe("c");
    expect(preferredLanguage("Algorithmique et Prog C", "Écrire un script Python qui…")).toBe("python");
    expect(preferredLanguage("Mathématiques pour Info", "Calculer…")).toBeNull();
  });

  it("contient les contraintes en français", () => {
    const p = buildSolvePrompt({ title: "Ex", statement: "Énoncé X", subject: "Algorithmique et Prog C", lang: "fr" });
    expect(p).toContain("Énoncé X");
    expect(p).toMatch(/programme complet/i);
    expect(p).toMatch(/entrée standard/);
    expect(p).toMatch(/Entrez un nombre/);
    expect(p).toMatch(/aléatoire/);
    expect(p).toMatch(/4 à 6 tests/);
    expect(p).toMatch(/cas limite/);
  });
});

describe("solveExercise", () => {
  it(
    "réponse C valide → ready, sorties calculées, premier test visible",
    async () => {
      const id = mkEx();
      const f = fakeFetch([{ needsCode: true, language: "c", solution: C_DOUBLE, tests: fourTests(["3", "0", "-5", "1000"]) }]);
      expect(await solveExercise(db, id, deps(f.impl))).toBe("ready");
      const c = getCheck(db, id)!;
      expect(c).toMatchObject({ status: "ready", language: "c", referenceSource: "ai", model: "qwen-test", referenceCode: C_DOUBLE, verified: false, error: null });
      expect(c.tests).toEqual([
        { input: "3", expected: "6", visible: true },
        { input: "0", expected: "0", visible: false },
        { input: "-5", expected: "-10", visible: false },
        { input: "1000", expected: "2000", visible: false },
      ]);
      expect(f.calls).toHaveLength(1);
      expect(String(f.calls[0].prompt)).toContain("affiche son double");
    },
    LONG,
  );

  it("needsCode:false → no_code", async () => {
    const id = mkEx({ statement: "Dessiner le logigramme." });
    const f = fakeFetch([{ needsCode: false, language: null, solution: "", tests: [] }]);
    expect(await solveExercise(db, id, deps(f.impl))).toBe("no_code");
    expect(getCheck(db, id)).toMatchObject({ status: "no_code", language: null, tests: [] });
  });

  it("langage hors liste → unsupported", async () => {
    const id = mkEx({ statement: "Écrire en Java…" });
    const f = fakeFetch([{ needsCode: true, language: "other", solution: "class A {}", tests: fourTests() }]);
    expect(await solveExercise(db, id, deps(f.impl))).toBe("unsupported");
    expect(getCheck(db, id)).toMatchObject({ status: "unsupported", language: null });
  });

  it(
    "code qui ne compile pas puis corrigé à la 2e tentative → ready (1 prise, 2 appels au modèle)",
    async () => {
      const id = mkEx();
      const f = fakeFetch([
        { needsCode: true, language: "c", solution: "int main(void) { return x; }", tests: fourTests(["1", "2", "3", "4"]) },
        { needsCode: true, language: "c", solution: C_DOUBLE, tests: fourTests(["1", "2", "3", "4"]) },
      ]);
      expect(await solveExercise(db, id, deps(f.impl))).toBe("ready");
      expect(f.calls).toHaveLength(2);
      // L'erreur du compilateur est renvoyée au modèle.
      expect(String(f.calls[1].prompt)).toMatch(/compilation/i);
      expect(String(f.calls[1].prompt)).toContain("return x;");
      // `attempts` compte les prises de la file (une seule ici), pas les appels au modèle.
      expect(getCheck(db, id)).toMatchObject({ status: "ready", attempts: 1 });
    },
    LONG,
  );

  it(
    "3 échecs → failed avec l'erreur",
    async () => {
      const id = mkEx({ subjectId: null });
      const bad = { needsCode: true, language: "python", solution: "print(1/0)", tests: fourTests() };
      const f = fakeFetch([bad, bad, bad]);
      expect(await solveExercise(db, id, deps(f.impl))).toBe("failed");
      expect(f.calls).toHaveLength(3);
      const c = getCheck(db, id)!;
      expect(c.status).toBe("failed");
      expect(c.error).toMatch(/ZeroDivisionError/);
    },
    LONG,
  );

  it(
    "JSON invalide → nouvelle tentative",
    async () => {
      const id = mkEx({ subjectId: null });
      const f = fakeFetch([
        "{ pas du json",
        { needsCode: true, language: "python" }, // champs manquants
        { needsCode: true, language: "python", solution: PY_SUM, tests: fourTests() },
      ]);
      expect(await solveExercise(db, id, deps(f.impl))).toBe("ready");
      expect(f.calls).toHaveLength(3);
      expect(getCheck(db, id)!.tests.map((t) => t.expected)).toEqual(["3", "0", "0", "300"]);
    },
    LONG,
  );

  it("Ollama injoignable → reste pending (prise non comptée), « indisponible » sans exception", async () => {
    const id = mkEx();
    const f = fakeFetch([econnrefused()]);
    expect(await solveExercise(db, id, deps(f.impl))).toBe("unavailable");
    expect(getCheck(db, id)).toMatchObject({ status: "pending", attempts: 0, error: null });
  });

  it(
    "solution non déterministe → failed",
    async () => {
      const id = mkEx({ subjectId: null });
      const js = "globalThis.__n = (globalThis.__n ?? 0) + 1; console.log(String(Math.random()));";
      const f = fakeFetch([{ needsCode: true, language: "javascript", solution: js, tests: fourTests() }]);
      expect(await solveExercise(db, id, deps(f.impl))).toBe("failed");
      expect(getCheck(db, id)).toMatchObject({ status: "failed", error: expect.stringMatching(/non déterministe/) });
    },
    LONG,
  );

  it(
    "correction du prof avec du code C valide sans lecture → utilisée (prof) sans appel au modèle",
    async () => {
      const prof = `Correction\n\n#include <stdio.h>\n\nint main(void)\n\n{\n\nfor (int i = 1; i <= 3; i++) printf("%d\\n", i * i);\n\nreturn 0;\n\n}\n`;
      const id = mkEx({ solution: prof });
      const f = fakeFetch([]);
      expect(await solveExercise(db, id, deps(f.impl))).toBe("ready");
      expect(f.calls).toHaveLength(0);
      expect(getCheck(db, id)).toMatchObject({
        status: "ready",
        language: "c",
        referenceSource: "prof",
        model: null,
        tests: [{ input: "", expected: "1\n4\n9", visible: true }],
      });
    },
    LONG,
  );

  it(
    "correction du prof qui lit l'entrée → seules les entrées sont demandées au modèle",
    async () => {
      const id = mkEx({ solution: `Voici la correction :\n${C_DOUBLE}` });
      const f = fakeFetch([{ tests: fourTests(["2", "0", "-1", "7"]) }]);
      expect(await solveExercise(db, id, deps(f.impl))).toBe("ready");
      expect(f.calls).toHaveLength(1);
      const format = f.calls[0].format as { properties: Record<string, unknown> };
      expect(Object.keys(format.properties)).toEqual(["tests"]);
      expect(getCheck(db, id)).toMatchObject({ referenceSource: "prof", model: "qwen-test", referenceCode: C_DOUBLE });
      expect(getCheck(db, id)!.tests.map((t) => t.expected)).toEqual(["4", "0", "-2", "14"]);
    },
    LONG,
  );

  it(
    "correction du prof qui ne compile pas (texte PDF) → repli sur le modèle",
    async () => {
      const id = mkEx({ solution: "#include <stdio.h>\nint main() { printf(\"a\") 2 Algorithmique – TD1 }" });
      const f = fakeFetch([{ needsCode: true, language: "c", solution: C_DOUBLE, tests: fourTests(["1", "2", "3", "4"]) }]);
      expect(await solveExercise(db, id, deps(f.impl))).toBe("ready");
      expect(getCheck(db, id)).toMatchObject({ referenceSource: "ai" });
    },
    LONG,
  );

  it("exercice supprimé pendant le traitement → aucune erreur, ligne disparue", async () => {
    const id = mkEx();
    const f = fakeFetch([
      () => {
        db.delete(exercises).where(eq(exercises.id, id)).run();
        return { needsCode: false, language: null, solution: "", tests: [] };
      },
    ]);
    expect(await solveExercise(db, id, deps(f.impl))).toBe("gone");
    expect(getCheck(db, id)).toBeNull();
  });

  it("trop de prises (plantages répétés) → failed sans appel au modèle", async () => {
    const id = mkEx();
    db.update(exerciseChecks).set({ attempts: 4 }).where(eq(exerciseChecks.exerciseId, id)).run();
    const f = fakeFetch([]);
    expect(await solveExercise(db, id, deps(f.impl))).toBe("failed");
    expect(getCheck(db, id)).toMatchObject({ status: "failed", error: expect.stringMatching(/trop de tentatives/) });
  });
});

describe("processNext", () => {
  it("ligne corrompue → failed, la boucle continue", async () => {
    const ex = db
      .insert(exercises)
      .values({ documentId: docId, number: 1, title: "t", statement: "s", groupKey: "g" })
      .returning()
      .get().id;
    enqueueCheck(db, ex);
    db.$client.prepare("UPDATE exercise_checks SET tests = '{corrompu' WHERE exercise_id = ?").run(ex);
    const r = await processNext(db, deps(fakeFetch([]).impl));
    expect(r).toMatchObject({ id: ex, outcome: "failed" });
    expect(getCheck(db, ex)).toMatchObject({ status: "failed", tests: [] });
    expect(await processNext(db, deps(fakeFetch([]).impl))).toBeNull();
  });
});

describe("extractProfCode", () => {
  it("ne retient que du C plausible", () => {
    expect(extractProfCode(null)).toBeNull();
    expect(extractProfCode("Donnez un algorithme et son logigramme")).toBeNull();
    expect(extractProfCode(`Corrigé\n${C_DOUBLE}\n3 Algorithmique – TD1`)).toBe(C_DOUBLE.trimEnd());
  });
});
