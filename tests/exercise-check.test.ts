import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/server/db/client";
import { documents, exercises } from "@/server/db/schema";
import { checkExerciseCode } from "@/server/exercise-check";
import { listSubjects, seedSubjects } from "@/server/subjects";

let db: Db;
let docId: string;
let cSubjectId: string;

function addExercise(opts: { number: number; title: string; statement: string; solution?: string | null; hints?: string[] | null }) {
  return db
    .insert(exercises)
    .values({
      documentId: docId,
      number: opts.number,
      title: opts.title,
      statement: opts.statement,
      solution: opts.solution ?? null,
      hints: opts.hints ?? null,
      lang: "fr",
      groupKey: `g-${opts.number}`,
      subjectId: cSubjectId,
    })
    .returning()
    .get().id;
}

beforeEach(() => {
  db = createTestDb();
  seedSubjects(db);
  cSubjectId = listSubjects(db).find((s) => s.slug === "algorithmique-et-prog-c")!.id;
  docId = db
    .insert(documents)
    .values({
      title: "TD1",
      type: "exercise",
      subjectId: cSubjectId,
      filePath: "uploads/td1.pdf",
      mime: "application/pdf",
      sha256: "td1sha",
      source: "upload",
    })
    .returning()
    .get().id;
});

describe("checkExerciseCode", () => {
  it("signale les erreurs de syntaxe et fournit explication et réponse", () => {
    const exId = addExercise({
      number: 1,
      title: "Exercice 1 : Somme de 1 à n",
      statement: "Écrire une fonction qui calcule la somme des entiers de 1 à n.",
      solution: "int somme(int n) {\n    int s = 0;\n    for (int i = 1; i <= n; i++) s += i;\n    return s;\n}",
      hints: ["Utilisez une boucle for."],
    });

    const res = checkExerciseCode(db, exId, "int somme(int n) {\n  int s = 0\n  return s;\n");
    expect(res.correct).toBe(false);
    expect(res.issues.length).toBeGreaterThanOrEqual(2);
    expect(res.explanation).toContain("Erreurs ou manques");
    expect(res.explanation).toContain("Utilisez une boucle for.");
    expect(res.answer).toContain("for (int i = 1; i <= n; i++)");
  });

  it("valide un code correct et génère une réponse de repli si aucune solution importée", () => {
    const swapId = addExercise({
      number: 2,
      title: "Exercice 2 : Échange avec pointeurs",
      statement: "Écrire une fonction qui échange deux entiers avec des pointeurs.",
    });

    const bad = checkExerciseCode(db, swapId, "void echanger(int a, int b) { int tmp = a; a = b; b = tmp; }");
    expect(bad.correct).toBe(false);
    expect(bad.issues.some((i) => /pointeur/i.test(i))).toBe(true);
    expect(bad.answer).toContain("int *a");

    const good = checkExerciseCode(db, swapId, "void echanger(int *a, int *b) {\n  int tmp = *a;\n  *a = *b;\n  *b = tmp;\n}");
    expect(good.correct).toBe(true);
    expect(good.issues).toEqual([]);
  });

  it("détecte un accumulateur initialisé à 0 pour un produit", () => {
    const prodId = addExercise({
      number: 3,
      title: "Exercice 3 : Produit",
      statement: "Calculer le produit des entiers de 1 à n.",
    });
    const res = checkExerciseCode(db, prodId, "int prod(int n) {\n  int p = 0;\n  for (int i = 1; i <= n; i++) p *= i;\n  return p;\n}");
    expect(res.correct).toBe(false);
    expect(res.issues.some((i) => /1/.test(i))).toBe(true);
  });
});
