import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "@/server/db/client";
import { documents, exerciseChecks, exercises, subjects } from "@/server/db/schema";
import { claimCheck, enqueueCheck, getCheck, releaseCheck, releaseStale, requeueCheck } from "@/server/checks";
import { askModel, OllamaCallError, OllamaUnavailableError } from "@/server/solver/ollama";
import { buildSolvePrompt, preferredLanguage, SOLVE_JSON_SCHEMA } from "@/server/solver/prompt";
import {
  extractProfCode,
  processNext,
  profRejection,
  solveExercise,
  solveExerciseDetailed,
  type SolveDeps,
} from "@/server/solver/solve";
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
    return ndjsonResponse(response);
  }) as typeof fetch;
  return { impl, calls };
}

/**
 * Réponse en flux comme Ollama (`stream: true`) : le texte découpé en morceaux de 7 caractères,
 * une ligne NDJSON par morceau, puis `done: true` ; les octets sont envoyés par paquets de
 * `byteChunk` (coupés au milieu des lignes, et des caractères UTF-8 multi-octets).
 */
function ndjsonResponse(text: string, opts: { done?: boolean; byteChunk?: number } = {}): Response {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += 7) parts.push(text.slice(i, i + 7));
  let ndjson = parts.map((p) => `${JSON.stringify({ model: "m", response: p, done: false })}\n`).join("");
  if (opts.done !== false) ndjson += `${JSON.stringify({ model: "m", response: "", done: true, eval_count: 3 })}\n`;
  const bytes = new TextEncoder().encode(ndjson);
  const size = opts.byteChunk ?? 13;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson" } });
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
  it("POST /api/generate avec stream:true, think:false, format = schéma JSON", async () => {
    let seenUrl = "";
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seenUrl = String(url);
      body = JSON.parse(String(init.body));
      return ndjsonResponse('{"ok":true}');
    }) as unknown as typeof fetch;
    const schema = { type: "object", properties: { ok: { type: "boolean" } } };
    const out = await askModel("bonjour", schema, { url: "http://h:1/", model: "m", fetchImpl });
    expect(out).toEqual({ ok: true });
    expect(seenUrl).toBe("http://h:1/api/generate");
    expect(body).toMatchObject({ model: "m", prompt: "bonjour", stream: true, think: false, format: schema });
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
      const id = mkEx({ statement: "Afficher les carrés des entiers de 1 à 3.", solution: prof });
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

// --- Fix round 1 : classes d'erreurs Ollama, signe de vie, file, correction du prof ---------

const httpFetch = (status: number, body: string) =>
  (async () => new Response(body, { status })) as unknown as typeof fetch;

/** fetch qui ne répond jamais avant l'abandon par le signal (délai HTTP). */
const hangingFetch = (async (_u: string, init: RequestInit) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  })) as unknown as typeof fetch;

describe("askModel — classes d'erreurs", () => {
  const call = (fetchImpl: typeof fetch, timeoutMs?: number) =>
    askModel("x", {}, { url: "http://h:1", model: "absent:1b", fetchImpl, timeoutMs });

  it("envoie num_predict 3000", async () => {
    const f = fakeFetch([{ ok: true }]);
    await call(f.impl);
    expect(f.calls[0].options).toMatchObject({ num_predict: 3000 });
  });

  it("HTTP 404 → OllamaCallError config (statut et corps conservés)", async () => {
    const e = (await call(httpFetch(404, '{"error":"model \'absent:1b\' not found"}')).catch((x: unknown) => x)) as OllamaCallError;
    expect(e).toBeInstanceOf(OllamaCallError);
    expect(e).toMatchObject({ kind: "config", httpStatus: 404 });
    expect(e.body).toContain("not found");
  });

  it("HTTP 400 mentionnant le modèle → config ; autre 400 → server", async () => {
    expect(await call(httpFetch(400, '{"error":"invalid model name"}')).catch((x) => x)).toMatchObject({ kind: "config" });
    expect(await call(httpFetch(400, '{"error":"bad format"}')).catch((x) => x)).toMatchObject({ kind: "server" });
  });

  it("HTTP 500 → server ; enveloppe illisible → server", async () => {
    expect(await call(httpFetch(500, "out of memory")).catch((x) => x)).toMatchObject({ kind: "server", httpStatus: 500 });
    expect(await call(httpFetch(200, "<html>")).catch((x) => x)).toMatchObject({ kind: "server" });
  });

  it("délai HTTP dépassé → timeout", async () => {
    const e = (await call(hangingFetch, 50).catch((x: unknown) => x)) as OllamaCallError;
    expect(e).toBeInstanceOf(OllamaCallError);
    expect(e.kind).toBe("timeout");
    expect(e.message).toMatch(/délai du modèle dépassé/);
  });

  it("connexion refusée → OllamaUnavailableError", async () => {
    const f = (async () => {
      throw econnrefused();
    }) as unknown as typeof fetch;
    expect(await call(f).catch((x) => x)).toBeInstanceOf(OllamaUnavailableError);
  });
});

describe("solveExercise — erreurs d'appel au modèle", () => {
  it("modèle introuvable (404) → config_error, ligne rendue sans compter la prise", async () => {
    const id = mkEx();
    const r = await solveExerciseDetailed(db, id, deps(httpFetch(404, '{"error":"model not found"}')));
    expect(r.outcome).toBe("config_error");
    expect(r.message).toMatch(/not found/);
    expect(getCheck(db, id)).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("délai dépassé → retry_later, prise comptée ; au-delà du plafond → failed « délai du modèle dépassé »", async () => {
    const id = mkEx();
    const r = await solveExerciseDetailed(db, id, { ...deps(hangingFetch), httpTimeoutMs: 50 });
    expect(r.outcome).toBe("retry_later");
    expect(getCheck(db, id)).toMatchObject({ status: "pending", attempts: 1, error: expect.stringMatching(/délai du modèle dépassé/) });
    // Deux autres prises avec le même résultat, puis la 4e prise passe `failed`.
    for (let i = 0; i < 2; i++) {
      expect(claimCheck(db, id)).toBe(true);
      expect(await solveExercise(db, id, { ...deps(hangingFetch), httpTimeoutMs: 50 })).toBe("retry_later");
    }
    expect(getCheck(db, id)!.attempts).toBe(3);
    expect(claimCheck(db, id)).toBe(true);
    expect(await solveExercise(db, id, deps(fakeFetch([]).impl))).toBe("failed");
    expect(getCheck(db, id)).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/délai du modèle dépassé.*trop de tentatives/),
    });
  });

  it("HTTP 500 → retry_later avec « erreur du modèle »", async () => {
    const id = mkEx();
    const r = await solveExerciseDetailed(db, id, deps(httpFetch(500, "boom")));
    expect(r).toMatchObject({ outcome: "retry_later", message: expect.stringMatching(/erreur du modèle/) });
    expect(getCheck(db, id)).toMatchObject({ status: "pending", attempts: 1, error: expect.stringMatching(/HTTP 500/) });
  });

  it("injoignable → message transmis dans le résultat", async () => {
    const id = mkEx();
    const f = fakeFetch([econnrefused()]);
    const r = await solveExerciseDetailed(db, id, deps(f.impl));
    expect(r).toMatchObject({ outcome: "unavailable", message: expect.stringMatching(/ECONNREFUSED/) });
  });

  it("écriture refusée (tests validés par un admin entre-temps) → skipped, pas « ready »", async () => {
    const id = mkEx();
    const f = fakeFetch([
      () => {
        db.update(exerciseChecks).set({ verified: true }).where(eq(exerciseChecks.exerciseId, id)).run();
        return { needsCode: false, language: null, solution: "", tests: [] };
      },
    ]);
    expect(await solveExercise(db, id, deps(f.impl))).toBe("skipped");
    // Les tests de l'admin sont gardés et la ligne sort de `running`.
    expect(getCheck(db, id)).toMatchObject({ status: "ready", verified: true });
  });
});

describe("signe de vie et file", () => {
  it("updated_at est rafraîchi avant chaque appel au modèle : releaseStale ne reprend pas la ligne", async () => {
    const id = mkEx();
    db.$client.prepare("UPDATE exercise_checks SET updated_at = 0 WHERE exercise_id = ?").run(id);
    let released = -1;
    const f = fakeFetch([
      () => {
        released = releaseStale(db, 60_000);
        return { needsCode: false, language: null, solution: "", tests: [] };
      },
    ]);
    expect(await solveExercise(db, id, deps(f.impl))).toBe("no_code");
    expect(released).toBe(0);
  });

  it("requeueCheck : busy si running, verified si validé, ok sinon", () => {
    const id = mkEx(); // running
    expect(requeueCheck(db, id)).toBe("busy");
    expect(getCheck(db, id)!.status).toBe("running");
    releaseCheck(db, id);
    expect(requeueCheck(db, id)).toBe("ok");
    db.update(exerciseChecks).set({ verified: true, status: "ready" }).where(eq(exerciseChecks.exerciseId, id)).run();
    expect(requeueCheck(db, id)).toBe("verified");
  });

  it("releaseCheck : prise non comptée par défaut, comptée avec `counted`", () => {
    const id = mkEx();
    releaseCheck(db, id);
    expect(getCheck(db, id)).toMatchObject({ status: "pending", attempts: 0 });
    claimCheck(db, id);
    releaseCheck(db, id, { counted: true, error: "délai" });
    expect(getCheck(db, id)).toMatchObject({ status: "pending", attempts: 1, error: "délai" });
  });
});

describe("correction du prof écartée", () => {
  it("profRejection : messages d'invite et lecture manquante", () => {
    const withPrompt = `#include <stdio.h>\nint main(void){int n; printf("Entrez un nombre : "); scanf("%d",&n); printf("%d\\n",n); return 0;}`;
    expect(profRejection(withPrompt, "Lire un entier")).toMatch(/invite/);
    const question = `#include <stdio.h>\nint main(void){int n; scanf("%d",&n); printf("Encore ?"); return 0;}`;
    expect(profRejection(question, "")).toMatch(/invite/);
    const noFormatBefore = `#include <stdio.h>\nint main(void){int n; puts("Bonjour"); scanf("%d",&n); printf("%d\\n",n); return 0;}`;
    expect(profRejection(noFormatBefore, "")).toMatch(/avant la lecture/);
    expect(profRejection(C_DOUBLE, "Lire un entier")).toBeNull();
    const noRead = `#include <stdio.h>\nint main(void){ printf("1\\n"); return 0; }`;
    expect(profRejection(noRead, "Saisir deux entiers au clavier")).toMatch(/ne lit rien/);
    expect(profRejection(noRead, "Afficher les carrés de 1 à 3")).toBeNull();
  });

  it(
    "correction du prof avec invite → repli sur le modèle, note journalisée",
    async () => {
      const prof = `#include <stdio.h>\nint main(void){int n; printf("Entrez un nombre : "); scanf("%d",&n); printf("%d\\n",n*2); return 0;}`;
      const id = mkEx({ solution: prof });
      const f = fakeFetch([{ needsCode: true, language: "c", solution: C_DOUBLE, tests: fourTests(["1", "2", "3", "4"]) }]);
      const r = await solveExerciseDetailed(db, id, deps(f.impl));
      expect(r.outcome).toBe("ready");
      expect(r.notes.join(" ")).toMatch(/correction du prof écartée/);
      expect(getCheck(db, id)).toMatchObject({ referenceSource: "ai" });
      expect(Object.keys((f.calls[0].format as { properties: object }).properties)).toContain("needsCode");
    },
    LONG,
  );
});

describe("prompt — budgets", () => {
  it("énoncé tronqué, ancien code omis quand l'énoncé est long, schéma language typé", () => {
    const long = "x".repeat(10_000);
    const p = buildSolvePrompt({ title: "t", statement: long, subject: null, lang: "fr" }, { reason: "err", code: "CODE_PRECEDENT" });
    expect(p).toContain("[…tronqué]");
    expect(p).not.toContain("x".repeat(6_001));
    expect(p).not.toContain("CODE_PRECEDENT");
    const short = buildSolvePrompt({ title: "t", statement: "court", subject: null, lang: "fr" }, { reason: "err", code: "CODE_PRECEDENT" });
    expect(short).toContain("CODE_PRECEDENT");
    expect(SOLVE_JSON_SCHEMA.properties.language).toMatchObject({ type: ["string", "null"] });
  });
});

// --- Fix round 2 : flux NDJSON (stream: true) et délais d'undici ---------------------------

describe("askModel — flux NDJSON", () => {
  const call = (fetchImpl: typeof fetch) => askModel("x", {}, { url: "http://h:1", model: "m", fetchImpl });
  const fixed = (res: () => Response) => (async () => res()) as unknown as typeof fetch;

  it("accumule les morceaux coupés au milieu des lignes (et des caractères UTF-8) jusqu'à done", async () => {
    const answer = { solution: 'printf("é à ç\\n");', tests: [{ input: "1 2", note: "cas limite — zéro" }] };
    for (const byteChunk of [1, 5, 64, 100_000]) {
      expect(await call(fixed(() => ndjsonResponse(JSON.stringify(answer), { byteChunk })))).toEqual(answer);
    }
  });

  it("flux terminé sans done:true → erreur server (prise comptée)", async () => {
    const e = (await call(fixed(() => ndjsonResponse('{"ok":true}', { done: false }))).catch((x: unknown) => x)) as OllamaCallError;
    expect(e).toBeInstanceOf(OllamaCallError);
    expect(e.kind).toBe("server");
    expect(e.message).toMatch(/flux interrompu/);
  });

  it("ligne {error} dans le flux → erreur server", async () => {
    const body = `${JSON.stringify({ response: "{", done: false })}\n${JSON.stringify({ error: "llama runner process has terminated" })}\n`;
    const e = (await call(fixed(() => new Response(body))).catch((x: unknown) => x)) as OllamaCallError;
    expect(e).toMatchObject({ kind: "server", message: expect.stringMatching(/runner process/) });
  });

  it("flux coupé en cours de lecture → server ; délai du corps d'undici → timeout", async () => {
    const broken = (code?: string) =>
      fixed(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(new TextEncoder().encode(`${JSON.stringify({ response: "{", done: false })}\n`));
                c.error(Object.assign(new TypeError("terminated"), { cause: Object.assign(new Error("other side closed"), { code }) }));
              },
            }),
          ),
      );
    expect(await call(broken("UND_ERR_SOCKET")).catch((x: unknown) => x)).toMatchObject({ kind: "server" });
    expect(await call(broken("UND_ERR_BODY_TIMEOUT")).catch((x: unknown) => x)).toMatchObject({ kind: "timeout" });
  });

  it("UND_ERR_HEADERS_TIMEOUT (fetch de Node, 300 s) → timeout, pas « injoignable »", async () => {
    const f = (async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("Headers Timeout Error"), { code: "UND_ERR_HEADERS_TIMEOUT" }),
      });
    }) as unknown as typeof fetch;
    const e = (await call(f).catch((x: unknown) => x)) as OllamaCallError;
    expect(e).toBeInstanceOf(OllamaCallError);
    expect(e.kind).toBe("timeout");
    expect(e.message).toMatch(/UND_ERR_HEADERS_TIMEOUT/);
  });

  it("seules les erreurs de connexion (ECONNREFUSED, ENOTFOUND, ECONNRESET…) sont « injoignable »", async () => {
    const withCode = (code?: string) =>
      (async () => {
        throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`x ${code}`), { code }) });
      }) as unknown as typeof fetch;
    for (const code of ["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]) {
      expect(await call(withCode(code)).catch((x: unknown) => x)).toBeInstanceOf(OllamaUnavailableError);
    }
    expect(await call(withCode("EPROTO")).catch((x: unknown) => x)).toMatchObject({ kind: "server" });
    expect(await call(withCode(undefined)).catch((x: unknown) => x)).toMatchObject({ kind: "server" });
  });

  it("solveExercise : délai d'en-têtes d'undici → retry_later (compté), pas unavailable", async () => {
    const id = mkEx();
    const f = (async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("Headers Timeout Error"), { code: "UND_ERR_HEADERS_TIMEOUT" }),
      });
    }) as unknown as typeof fetch;
    const r = await solveExerciseDetailed(db, id, deps(f));
    expect(r.outcome).toBe("retry_later");
    expect(getCheck(db, id)).toMatchObject({ status: "pending", attempts: 1, error: expect.stringMatching(/délai du modèle dépassé/) });
  });
});
