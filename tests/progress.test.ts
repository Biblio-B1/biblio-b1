import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "@/server/db/client";
import { documents, exercises, progress, users } from "@/server/db/schema";
import { getProgress, listExercises, progressSummary, setStatus } from "@/server/progress";
import { createSubject } from "@/server/subjects";

let db: Db;
let u1: string;
let u2: string;
let subA: string;
let subB: string;
let ex: string[];

function mkUser(name: string) {
  return db.insert(users).values({ name, email: `${name}@x.io`, passwordHash: "x" }).returning().get().id;
}
function mkDoc(subjectId: string) {
  return db
    .insert(documents)
    .values({ title: "d", type: "exercise", subjectId, filePath: `f/${Math.random()}`, mime: "application/pdf", sha256: String(Math.random()), source: "upload" })
    .returning()
    .get().id;
}
function mkEx(documentId: string, subjectId: string, number: number, title: string, lang: "fr" | "en" = "fr", statement = "énoncé") {
  return db
    .insert(exercises)
    .values({ documentId, number, title, statement, lang, groupKey: `g${number}-${documentId}`, subjectId })
    .returning()
    .get().id;
}

beforeEach(() => {
  db = createTestDb();
  u1 = mkUser("a");
  u2 = mkUser("b");
  subA = createSubject(db, { name: "Mat A", color: "#112233", pathPatterns: [], keywords: {} }).id;
  subB = createSubject(db, { name: "Mat B", color: "#112244", pathPatterns: [], keywords: {} }).id;
  const dA = mkDoc(subA);
  const dB = mkDoc(subB);
  ex = [mkEx(dA, subA, 1, "Pointeurs"), mkEx(dA, subA, 2, "Listes", "en"), mkEx(dB, subB, 1, "Matrices", "fr", "calcul de 100% du %_")];
});

describe("progress", () => {
  it("statut par défaut todo", () => {
    expect(getProgress(db, u1).size).toBe(0);
    const list = listExercises(db, { userId: u1 });
    expect(list).toHaveLength(3);
    expect(list.every((e) => e.status === "todo")).toBe(true);
  });

  it("upsert doing puis mastered : une seule ligne", () => {
    setStatus(db, u1, ex[0], "doing");
    setStatus(db, u1, ex[0], "mastered");
    expect(db.select().from(progress).where(eq(progress.userId, u1)).all()).toHaveLength(1);
    expect(getProgress(db, u1).get(ex[0])).toBe("mastered");
  });

  it("utilisateurs indépendants", () => {
    setStatus(db, u1, ex[0], "mastered");
    expect(getProgress(db, u2).get(ex[0])).toBeUndefined();
    expect(listExercises(db, { userId: u2 }).find((e) => e.id === ex[0])!.status).toBe("todo");
  });

  it("refuse un statut ou un exercice invalide", () => {
    expect(() => setStatus(db, u1, ex[0], "nope" as never)).toThrow();
    expect(() => setStatus(db, u1, "inconnu", "doing")).toThrow();
  });

  it("filtre par statut (todo inclut les non suivis), matière et recherche", () => {
    setStatus(db, u1, ex[0], "mastered");
    setStatus(db, u1, ex[1], "doing");
    expect(listExercises(db, { userId: u1, status: "mastered" }).map((e) => e.id)).toEqual([ex[0]]);
    expect(listExercises(db, { userId: u1, status: "doing" }).map((e) => e.id)).toEqual([ex[1]]);
    expect(listExercises(db, { userId: u1, status: "todo" }).map((e) => e.id)).toEqual([ex[2]]);
    expect(listExercises(db, { userId: u1, subjectId: subB }).map((e) => e.id)).toEqual([ex[2]]);
    expect(listExercises(db, { userId: u1, q: "pointeur" }).map((e) => e.id)).toEqual([ex[0]]);
    expect(listExercises(db, { userId: u1, q: "100%" }).map((e) => e.id)).toEqual([ex[2]]);
    expect(listExercises(db, { userId: u1, q: "%" }).map((e) => e.id)).toEqual([ex[2]]);
  });

  it("filtre par langue", () => {
    expect(listExercises(db, { userId: u1, lang: "en" }).map((e) => e.id)).toEqual([ex[1]]);
  });

  it("progressSummary", () => {
    setStatus(db, u1, ex[0], "mastered");
    setStatus(db, u1, ex[1], "doing");
    expect(progressSummary(db, u1)).toEqual({ todo: 1, doing: 1, mastered: 1, total: 3 });
    expect(progressSummary(db, u1, subA)).toEqual({ todo: 0, doing: 1, mastered: 1, total: 2 });
    expect(progressSummary(db, u2)).toEqual({ todo: 3, doing: 0, mastered: 0, total: 3 });
  });
});
