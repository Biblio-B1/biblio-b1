import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "@/server/db/client";
import { codeAttempts, documents, exerciseChecks, exercises, users } from "@/server/db/schema";
import { createExercises } from "@/server/exercises";
import {
  claimCheck,
  claimNextPending,
  countChecksByStatus,
  enqueueAllMissing,
  enqueueCheck,
  getAttempt,
  getCheck,
  listOpenReports,
  releaseStale,
  reportCheck,
  requeueCheck,
  resolveReport,
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
    updateTests(db, a, tests, { id: admin, role: "admin" }, "c");
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
    updateTests(db, a, tests, { id: admin, role: "admin" }, "c");
    const c = getCheck(db, a)!;
    expect(c.verified).toBe(true);
    expect(c.verifiedBy).toBe(admin);
    expect(c.tests).toEqual(tests);
  });

  it("updateTests sur une ligne non prête : langage requis, puis ready + validé", () => {
    const a = mkEx(1);
    enqueueCheck(db, a); // pending, sans langage
    const adm = { id: admin, role: "admin" as const };
    expect(() => updateTests(db, a, tests, adm)).toThrow("invalid");
    expect(() => updateTests(db, a, tests, adm, "cobol" as never)).toThrow("invalid");
    expect(getCheck(db, a)!.verified).toBe(false);
    updateTests(db, a, tests, adm, "python");
    expect(getCheck(db, a)).toMatchObject({ status: "ready", language: "python", verified: true, verifiedBy: admin, error: null });
    // ligne déjà dotée d'un langage : il est conservé si on n'en donne pas
    const b = mkEx(2);
    enqueueCheck(db, b);
    expect(claimNextPending(db)?.exerciseId).toBe(b);
    saveCheckResult(db, b, { status: "failed", language: "c", error: "boum" });
    updateTests(db, b, tests, adm);
    expect(getCheck(db, b)).toMatchObject({ status: "ready", language: "c", verified: true, error: null });
  });

  it("verifyCheck n'est permis que sur une ligne ready avec des tests", () => {
    const a = mkEx(1);
    enqueueCheck(db, a);
    const adm = { id: admin, role: "admin" as const };
    expect(() => verifyCheck(db, a, adm)).toThrow("invalid"); // pending
    expect(getCheck(db, a)!.verified).toBe(false);
    claimNextPending(db);
    saveCheckResult(db, a, { status: "no_code" });
    expect(() => verifyCheck(db, a, adm)).toThrow("invalid"); // no_code, sans tests
    db.update(exerciseChecks).set({ status: "ready", language: "c", tests: [] }).where(eq(exerciseChecks.exerciseId, a)).run();
    expect(() => verifyCheck(db, a, adm)).toThrow("invalid"); // ready mais sans tests
    db.update(exerciseChecks).set({ tests }).where(eq(exerciseChecks.exerciseId, a)).run();
    verifyCheck(db, a, adm);
    expect(getCheck(db, a)).toMatchObject({ status: "ready", verified: true, verifiedBy: admin });
  });

  it("une ligne validée n'est jamais reprise par le solveur (claim)", () => {
    const a = mkEx(1);
    const b = mkEx(2);
    enqueueCheck(db, a);
    enqueueCheck(db, b);
    // état hérité : pending mais validé (ancien bogue) — ne doit pas être pris
    db.update(exerciseChecks).set({ verified: true }).where(eq(exerciseChecks.exerciseId, a)).run();
    expect(claimCheck(db, a)).toBe(false);
    expect(claimNextPending(db)?.exerciseId).toBe(b);
    expect(claimNextPending(db)).toBeNull();
    expect(getCheck(db, a)!.status).toBe("pending");
  });

  it("requeueCheck sur des tests validés : refusé sans confirmation, sinon validation retirée", () => {
    const a = mkEx(1);
    enqueueCheck(db, a);
    updateTests(db, a, tests, { id: admin, role: "admin" }, "c");
    expect(requeueCheck(db, a)).toBe("verified");
    expect(getCheck(db, a)).toMatchObject({ status: "ready", verified: true });
    expect(requeueCheck(db, a, { unverify: true })).toBe("ok");
    expect(getCheck(db, a)).toMatchObject({ status: "pending", verified: false, verifiedBy: null, attempts: 0 });
    expect(claimNextPending(db)?.exerciseId).toBe(a);
  });

  it("signalements : liste (auteur, date, exercice) et « traité », réservés aux admins", () => {
    const a = mkEx(1);
    const b = mkEx(2);
    reportCheck(db, a, member, "Le test 2 est faux");
    reportCheck(db, b, member, "Sortie attendue erronée");
    const adm = { id: admin, role: "admin" as const };
    const mem = { id: member, role: "member" as const };
    expect(() => listOpenReports(db, mem)).toThrow("forbidden");
    const all = listOpenReports(db, adm);
    expect(all).toHaveLength(2);
    const onA = listOpenReports(db, adm, a);
    expect(onA).toHaveLength(1);
    expect(onA[0]).toMatchObject({ exerciseId: a, exerciseTitle: "t1", message: "Le test 2 est faux", authorName: "mem" });
    expect(onA[0].createdAt).toBeInstanceOf(Date);
    expect(() => resolveReport(db, onA[0].id, mem)).toThrow("forbidden");
    expect(resolveReport(db, onA[0].id, adm)).toBe(a);
    expect(listOpenReports(db, adm, a)).toHaveLength(0);
    expect(listOpenReports(db, adm)).toHaveLength(1);
    expect(() => resolveReport(db, "00000000-0000-4000-8000-000000000000", adm)).toThrow("not_found");
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

describe("countChecksByStatus", () => {
  it("compte par statut et les exercices sans ligne", () => {
    const a = mkEx(901);
    const b = mkEx(902);
    mkEx(903);
    enqueueCheck(db, a);
    enqueueCheck(db, b);
    db.update(exerciseChecks).set({ status: "ready" }).where(eq(exerciseChecks.exerciseId, b)).run();
    const c = countChecksByStatus(db);
    expect(c.pending).toBe(1);
    expect(c.ready).toBe(1);
    expect(c.failed).toBe(0);
    expect(c.missing).toBe(1);
    expect(c.total).toBe(3);
  });
});
