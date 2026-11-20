import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "@/server/db/client";
import { codeAttempts, documents, exerciseChecks, exercises, users } from "@/server/db/schema";
import { createExercises } from "@/server/exercises";
import {
  claimNextPending,
  enqueueAllMissing,
  enqueueCheck,
  getAttempt,
  getCheck,
  releaseStale,
  reportCheck,
  saveAttempt,
  saveCheckResult,
  updateTests,
  verifyCheck,
} from "@/server/checks";
import { getProgress, setStatus } from "@/server/progress";

let db: Db;
let admin: string;
let member: string;
let docId: string;

const mkUser = (name: string, role: "admin" | "member") =>
  db.insert(users).values({ name, email: `${name}@x.io`, passwordHash: "x", role }).returning().get().id;
const mkEx = (n: number) =>
  db
    .insert(exercises)
    .values({ documentId: docId, number: n, title: `t${n}`, statement: "s", groupKey: `g${n}` })
    .returning()
    .get().id;

beforeEach(() => {
  db = createTestDb();
  admin = mkUser("adm", "admin");
  member = mkUser("mem", "member");
  docId = db
    .insert(documents)
    .values({
      title: "d",
      type: "exercise",
      filePath: "f",
      mime: "application/pdf",
      sha256: "abc",
      source: "upload",
      text: "Exercice 1\nÉcrire un programme qui affiche la somme.\n\nExercice 2\nÉcrire un programme qui affiche le produit.\n",
    })
    .returning()
    .get().id;
});

const tests = [
  { input: "1 2", expected: "3", visible: true },
  { input: "2 2", expected: "4", visible: false },
];

describe("mise en file", () => {
  it("createExercises crée une ligne pending par exercice", () => {
    const doc = db.select().from(documents).where(eq(documents.id, docId)).get()!;
    const n = createExercises(db, doc, "Maths/exo.pdf");
    expect(n).toBeGreaterThan(0);
    const rows = db.select().from(exerciseChecks).all();
    expect(rows).toHaveLength(n);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
  });

  it("enqueueCheck est idempotent", () => {
    const e = mkEx(1);
    enqueueCheck(db, e);
    enqueueCheck(db, e);
    expect(db.select().from(exerciseChecks).all()).toHaveLength(1);
  });

  it("enqueueAllMissing ne met en file que les manquants", () => {
    const a = mkEx(1);
    mkEx(2);
    enqueueCheck(db, a);
    expect(enqueueAllMissing(db)).toBe(1);
    expect(enqueueAllMissing(db)).toBe(0);
    expect(db.select().from(exerciseChecks).all()).toHaveLength(2);
  });

  it("la suppression d'un exercice supprime sa ligne (cascade)", () => {
    const e = mkEx(1);
    enqueueCheck(db, e);
    db.delete(exercises).where(eq(exercises.id, e)).run();
    expect(db.select().from(exerciseChecks).all()).toHaveLength(0);
  });
});

describe("file d'attente", () => {
  it("claimNextPending prend le plus ancien puis les suivants, puis null", () => {
    const a = mkEx(1);
    const b = mkEx(2);
    enqueueCheck(db, a);
    enqueueCheck(db, b);
    const c1 = claimNextPending(db)!;
    expect(c1.exerciseId).toBe(a);
    expect(c1.status).toBe("running");
    expect(claimNextPending(db)!.exerciseId).toBe(b);
    expect(claimNextPending(db)).toBeNull();
  });

  it("releaseStale remet les running anciens en pending", () => {
    const a = mkEx(1);
    const b = mkEx(2);
    enqueueCheck(db, a);
    enqueueCheck(db, b);
    claimNextPending(db);
    claimNextPending(db);
    db.update(exerciseChecks).set({ updatedAt: new Date(Date.now() - 60_000) }).where(eq(exerciseChecks.exerciseId, a)).run();
    expect(releaseStale(db, 30_000)).toBe(1);
    expect(getCheck(db, a)!.status).toBe("pending");
    expect(getCheck(db, b)!.status).toBe("running");
  });

  it("saveCheckResult enregistre les tests", () => {
    const a = mkEx(1);
    enqueueCheck(db, a);
    claimNextPending(db);
    saveCheckResult(db, a, { status: "ready", language: "python", referenceCode: "print(1)", referenceSource: "ai", tests, model: "m" });
    const c = getCheck(db, a)!;
    expect(c.status).toBe("ready");
    expect(c.tests).toEqual(tests);
    expect(c.verified).toBe(false);
    saveCheckResult(db, "inconnu", { status: "failed" }); // exercice supprimé : sans erreur
  });

  it("un résultat tardif n'écrase pas des tests vérifiés", () => {
    const a = mkEx(1);
    enqueueCheck(db, a);
    claimNextPending(db);
    updateTests(db, a, tests, { id: admin, role: "admin" });
    saveCheckResult(db, a, { status: "ready", tests: [{ input: "9", expected: "9", visible: true }] });
    const c = getCheck(db, a)!;
    expect(c.tests).toEqual(tests);
    expect(c.verified).toBe(true);
  });

  it("un résultat sur une ligne non running est ignoré", () => {
    const a = mkEx(1);
    enqueueCheck(db, a); // pending, jamais pris
    saveCheckResult(db, a, { status: "ready", tests });
    expect(getCheck(db, a)!.status).toBe("pending");
    expect(getCheck(db, a)!.tests).toEqual([]);
  });
});

describe("administration et signalement", () => {
  it("updateTests / verifyCheck réservés aux admins", () => {
    const a = mkEx(1);
    enqueueCheck(db, a);
    expect(() => updateTests(db, a, tests, { id: member, role: "member" })).toThrow("forbidden");
    expect(() => verifyCheck(db, a, { id: member, role: "member" })).toThrow("forbidden");
    updateTests(db, a, tests, { id: admin, role: "admin" });
    const c = getCheck(db, a)!;
    expect(c.verified).toBe(true);
    expect(c.verifiedBy).toBe(admin);
    expect(c.tests).toEqual(tests);
  });

  it("updateTests valide les tests", () => {
    const a = mkEx(1);
    enqueueCheck(db, a);
    const adm = { id: admin, role: "admin" as const };
    expect(() => updateTests(db, a, [], adm)).toThrow();
    expect(() => updateTests(db, a, [{ input: "", expected: "1", visible: false }], adm)).toThrow();
    expect(() => updateTests(db, a, [{ input: "x".repeat(10_001), expected: "1", visible: true }], adm)).toThrow();
    expect(() => updateTests(db, a, Array(21).fill({ input: "", expected: "1", visible: true }), adm)).toThrow();
  });

  it("reportCheck enregistre un signalement", () => {
    const a = mkEx(1);
    enqueueCheck(db, a);
    reportCheck(db, a, member, "Le test 2 est faux");
    expect(() => reportCheck(db, a, member, "  ")).toThrow("invalid");
    expect(() => reportCheck(db, "inconnu", member, "x")).toThrow("not_found");
  });
});

describe("tentatives", () => {
  it("saveAttempt passe la progression à doing puis mastered", () => {
    const a = mkEx(1);
    saveAttempt(db, member, a, "python", "print(1)", false);
    expect(getProgress(db, member).get(a)).toBe("doing");
    expect(getAttempt(db, member, a)!.passed).toBe(false);
    saveAttempt(db, member, a, "python", "print(2)", true);
    expect(getProgress(db, member).get(a)).toBe("mastered");
    expect(getAttempt(db, member, a)!.code).toBe("print(2)");
    expect(db.select().from(codeAttempts).all()).toHaveLength(1);
  });

  it("un échec ne rétrograde jamais mastered", () => {
    const a = mkEx(1);
    setStatus(db, member, a, "mastered");
    saveAttempt(db, member, a, "c", "int main(){}", false);
    expect(getProgress(db, member).get(a)).toBe("mastered");
  });

  it("saveAttempt valide code, langage et exercice", () => {
    const a = mkEx(1);
    expect(() => saveAttempt(db, member, a, "python", "x".repeat(100_001), false)).toThrow("invalid");
    expect(() => saveAttempt(db, member, a, "ruby" as never, "x", false)).toThrow("invalid");
    expect(() => saveAttempt(db, member, "inconnu", "python", "x", false)).toThrow("not_found");
  });

  it("getAttempt renvoie null sans tentative", () => {
    expect(getAttempt(db, member, mkEx(1))).toBeNull();
  });
});
