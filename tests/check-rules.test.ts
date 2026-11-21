import { describe, expect, it } from "vitest";
import { canVerify, nextProgress, parseTestsJson, requeueDecision } from "@/lib/check-rules";

describe("parseTestsJson", () => {
  it("accepte une liste valide", () => {
    expect(parseTestsJson('[{"input":"1 2","expected":"3","visible":true}]')).toEqual({
      ok: true,
      tests: [{ input: "1 2", expected: "3", visible: true }],
    });
  });

  it("JSON illisible", () => {
    expect(parseTestsJson("[{")).toEqual({ ok: false, error: "JSON invalide." });
  });

  it("au moins un test visible, avec l'endroit de l'erreur", () => {
    const r = parseTestsJson('[{"input":"","expected":"x","visible":false}]');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/visible/);
    const bad = parseTestsJson('[{"input":"","expected":5,"visible":true}]');
    expect(!bad.ok && bad.error).toMatch(/Tests invalides \(0\.expected\)/);
  });

  it("20 tests au plus", () => {
    const many = JSON.stringify(Array.from({ length: 21 }, () => ({ input: "", expected: "", visible: true })));
    expect(parseTestsJson(many).ok).toBe(false);
  });
});

describe("nextProgress", () => {
  it("réussi → maîtrisé ; échec → en cours, sans jamais rétrograder un exercice maîtrisé", () => {
    expect(nextProgress("todo", true)).toBe("mastered");
    expect(nextProgress(undefined, false)).toBe("doing");
    expect(nextProgress("mastered", false)).toBe(null);
  });
});

describe("canVerify", () => {
  it("seulement une vérification prête, avec langage et tests", () => {
    expect(canVerify({ status: "ready", language: "c", tests: [{ input: "", expected: "", visible: true }] })).toBe(true);
    expect(canVerify({ status: "no_code", language: "c", tests: [{ input: "", expected: "", visible: true }] })).toBe(false);
    expect(canVerify({ status: "ready", language: null, tests: [] })).toBe(false);
  });
});

describe("requeueDecision", () => {
  it("validée : confirmation exigée ; en cours de calcul : refus ; sinon ok", () => {
    expect(requeueDecision({ status: "ready", verified: true }, false)).toBe("verified");
    expect(requeueDecision({ status: "ready", verified: true }, true)).toBe("ok");
    expect(requeueDecision({ status: "running", verified: false }, true)).toBe("busy");
    expect(requeueDecision({ status: "failed", verified: false }, false)).toBe("ok");
  });
});
