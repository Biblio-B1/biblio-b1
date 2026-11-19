import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/server/db/client";
import { classify } from "@/server/classify";
import { listSubjects, seedSubjects, DEFAULT_SUBJECTS } from "@/server/subjects";

describe("classify", () => {
  let db: Db;
  let subjects: ReturnType<typeof listSubjects>;
  const slugOf = (id: string | null) => subjects.find((s) => s.id === id)?.slug ?? null;

  beforeEach(() => {
    db = createTestDb();
    seedSubjects(db);
    subjects = listSubjects(db);
  });

  it("seedSubjects est idempotent", () => {
    seedSubjects(db);
    expect(listSubjects(db)).toHaveLength(DEFAULT_SUBJECTS.length);
    expect(listSubjects(db).map((s) => s.slug).sort()).toEqual(
      ["anglais", "archi", "linux", "maths", "prog-c"],
    );
  });

  it("reconnaît prog-c par le nom de fichier", () => {
    const r = classify({ fileName: "ECE - Algo et C - TP6 - Pointeurs.pdf" }, subjects);
    expect(slugOf(r.subjectId)).toBe("prog-c");
  });

  it("reconnaît prog-c par le texte", () => {
    const r = classify(
      { fileName: "notes.txt", text: "#include <stdio.h>\nint *p = malloc(4);\nprintf(\"x\");" },
      subjects,
    );
    expect(slugOf(r.subjectId)).toBe("prog-c");
  });

  it("reconnaît prog-c par l'extension .c", () => {
    expect(slugOf(classify({ fileName: "tp1.c" }, subjects).subjectId)).toBe("prog-c");
  });

  it("reconnaît linux", () => {
    const r = classify({ fileName: "memo.txt", text: "grep, chmod, bash" }, subjects);
    expect(slugOf(r.subjectId)).toBe("linux");
  });

  it("reconnaît maths, sans tenir compte des accents ni de la casse", () => {
    const r = classify({ fileName: "x.txt", text: "INTEGRALE, derivee, Matrice" }, subjects);
    expect(slugOf(r.subjectId)).toBe("maths");
    const r2 = classify({ fileName: "x.txt", text: "intégrale, dérivée, matrice" }, subjects);
    expect(slugOf(r2.subjectId)).toBe("maths");
  });

  it("photo.jpg sans texte -> null", () => {
    expect(classify({ fileName: "photo.jpg" }, subjects).subjectId).toBeNull();
  });

  it("pas de faux positif sur un c isolé dans un mot", () => {
    const r = classify({ fileName: "recette cuisine.pdf", text: "c'est un picnic" }, subjects);
    expect(r.subjectId).toBeNull();
  });

  it.each(["Vitamine C.pdf", "Annexe C.pdf", "Option C - planning.pdf"])(
    "un C nu dans le nom de fichier (%s) ne classe pas prog-c",
    (fileName) => {
      expect(classify({ fileName }, subjects).subjectId).toBeNull();
    },
  );

  it("fichiers ECE réels et dossier C", () => {
    const slug = (i: Parameters<typeof classify>[0]) => slugOf(classify(i, subjects).subjectId);
    expect(slug({ fileName: "ECE - Algo et C - TD1 - Algorithmes et Logigrammes.pdf" })).toBe("prog-c");
    expect(slug({ fileName: "PROG-C_Exam_Bachelor1_2025-12-10-v1_EN.pdf" })).toBe("prog-c");
    expect(slug({ fileName: "Memory_List_FR.pdf", path: "ARCHIVE/2026/C/Memory_List_FR.pdf" })).toBe("prog-c");
    expect(slug({ fileName: "Memory_List_FR.pdf", path: "Cours C\\Memory_List_FR.pdf" })).toBe("prog-c");
    expect(slug({ fileName: "x.pdf", path: "C/x.pdf" })).toBe("prog-c");
    expect(slug({ fileName: "x.pdf", path: "dossier\\C\\x.pdf" })).toBe("prog-c");
  });

  it("keywords finissant par * (char *p)", () => {
    const r = classify({ fileName: "a.txt", text: "char *p; void *q;" }, subjects);
    expect(slugOf(r.subjectId)).toBe("prog-c");
  });

  it("plafonne les occurrences à 5", () => {
    const one = classify({ fileName: "a.txt", text: "malloc ".repeat(5) }, subjects);
    const many = classify({ fileName: "a.txt", text: "malloc ".repeat(50) }, subjects);
    expect(many.scores).toEqual(one.scores);
  });

  it("seuil minimal : un mot-clé faible ne suffit pas", () => {
    expect(classify({ fileName: "a.txt", text: "essay" }, subjects).subjectId).toBeNull();
  });
});
