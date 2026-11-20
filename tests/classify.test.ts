import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/server/db/client";
import { subjects as subjectsTable } from "@/server/db/schema";
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
      [
        "algorithmique-et-prog-c",
        "anglais-professionnel-technique-avance",
        "comm-posture-professionnelle",
        "developpement-web-front-end",
        "infra-data",
        "linux-environnement-ia",
        "mathematiques-pour-info",
        "presentations-b1",
        "techaway-dataanalysis",
      ],
    );
  });

  it("seedSubjects supprime Shift B1 / Shift(s) 1 s'il est encore présent", () => {
    db.insert(
      subjectsTable,
    ).values({ name: "Shift B1", slug: "shift-b1", color: "#ca8a04", rules: { pathPatterns: [], keywords: {} } }).run();
    seedSubjects(db);
    expect(listSubjects(db).some((s) => s.slug === "shift-b1" || s.slug === "shift-s-1-decoder-pour-agir")).toBe(false);
  });

  it("reconnaît prog-c par le nom de fichier", () => {
    const r = classify({ fileName: "ECE - Algo et C - TP6 - Pointeurs.pdf" }, subjects);
    expect(slugOf(r.subjectId)).toBe("algorithmique-et-prog-c");
  });

  it("reconnaît prog-c par le texte", () => {
    const r = classify(
      { fileName: "notes.txt", text: "#include <stdio.h>\nint *p = malloc(4);\nprintf(\"x\");" },
      subjects,
    );
    expect(slugOf(r.subjectId)).toBe("algorithmique-et-prog-c");
  });

  it("reconnaît prog-c par l'extension .c", () => {
    expect(slugOf(classify({ fileName: "tp1.c" }, subjects).subjectId)).toBe("algorithmique-et-prog-c");
  });

  it("reconnaît linux", () => {
    const r = classify({ fileName: "memo.txt", text: "grep, chmod, bash" }, subjects);
    expect(slugOf(r.subjectId)).toBe("linux-environnement-ia");
  });

  it("reconnaît maths, sans tenir compte des accents ni de la casse", () => {
    const r = classify({ fileName: "x.txt", text: "INTEGRALE, derivee, Matrice" }, subjects);
    expect(slugOf(r.subjectId)).toBe("mathematiques-pour-info");
    const r2 = classify({ fileName: "x.txt", text: "intégrale, dérivée, matrice" }, subjects);
    expect(slugOf(r2.subjectId)).toBe("mathematiques-pour-info");
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
    expect(slug({ fileName: "ECE - Algo et C - TD1 - Algorithmes et Logigrammes.pdf" })).toBe("algorithmique-et-prog-c");
    expect(slug({ fileName: "PROG-C_Exam_Bachelor1_2025-12-10-v1_EN.pdf" })).toBe("algorithmique-et-prog-c");
    expect(slug({ fileName: "Memory_List_FR.pdf", path: "ARCHIVE/2026/C/Memory_List_FR.pdf" })).toBe("algorithmique-et-prog-c");
    expect(slug({ fileName: "Memory_List_FR.pdf", path: "Cours C\\Memory_List_FR.pdf" })).toBe("algorithmique-et-prog-c");
    expect(slug({ fileName: "x.pdf", path: "C/x.pdf" })).toBe("algorithmique-et-prog-c");
    expect(slug({ fileName: "x.pdf", path: "dossier\\C\\x.pdf" })).toBe("algorithmique-et-prog-c");
  });

  it("keywords finissant par * (char *p)", () => {
    const r = classify({ fileName: "a.txt", text: "char *p; void *q;" }, subjects);
    expect(slugOf(r.subjectId)).toBe("algorithmique-et-prog-c");
  });

  it("plafonne les occurrences à 5", () => {
    const one = classify({ fileName: "a.txt", text: "malloc ".repeat(5) }, subjects);
    const many = classify({ fileName: "a.txt", text: "malloc ".repeat(50) }, subjects);
    expect(many.scores).toEqual(one.scores);
  });

  it("seuil minimal : un mot-clé faible ne suffit pas", () => {
    expect(classify({ fileName: "a.txt", text: "essay" }, subjects).subjectId).toBeNull();
  });

  it("les 9 matières portent exactement les noms des dossiers de cours", () => {
    expect(DEFAULT_SUBJECTS.map((s) => s.name)).toEqual([
      "Algorithmique et Prog C",
      "Anglais professionnel & technique avancé",
      "comm-posture professionnelle",
      "Développement web Front-End",
      "infra-data",
      "Linux & environnement IA",
      "Mathématiques pour Info",
      "Présentations B1",
      "Techaway dataanalysis",
    ]);
  });

  it("bonus fort quand un segment du chemin est le nom ou le slug d'une matière", () => {
    const slug = (i: Parameters<typeof classify>[0]) => slugOf(classify(i, subjects).subjectId);
    expect(slug({ fileName: "Seance 1.pdf", path: "cours/Présentations B1/Seance 1.pdf" })).toBe("presentations-b1");
    expect(slug({ fileName: "x.pdf", path: "COMM-POSTURE PROFESSIONNELLE\\x.pdf" })).toBe("comm-posture-professionnelle");
    // Le bonus de dossier l'emporte sur des mots-clés d'une autre matière.
    const r = classify({ fileName: "m.txt", path: "infra-data/m.txt", text: "grep chmod bash" }, subjects);
    expect(slugOf(r.subjectId)).toBe("infra-data");
    // Un segment qui contient seulement le nom ne compte pas.
    const r2 = classify({ fileName: "x.pdf", path: "pas-infra-data-du-tout/x.pdf" }, subjects);
    expect(r2.scores[subjects.find((s) => s.slug === "infra-data")!.id] ?? 0).toBeLessThan(20);
  });

  it("nouvelles matières : front-end, données, anglais", () => {
    const slug = (i: Parameters<typeof classify>[0]) => slugOf(classify(i, subjects).subjectId);
    expect(slug({ fileName: "2_CSS_Flexbox.pdf" })).toBe("developpement-web-front-end");
    expect(slug({ fileName: "notes.txt", text: "document.querySelector et addEventListener sur le DOM" })).toBe("developpement-web-front-end");
    expect(slug({ fileName: "notes.txt", text: "Databricks, lakehouse, ETL et parquet" })).toBe("infra-data");
    expect(slug({ fileName: "Syllabus_TECHAWAY_Data Analysis N1.pdf" })).toBe("techaway-dataanalysis");
    expect(slug({ fileName: "grammar.txt", text: "present perfect, irregular verbs" })).toBe("anglais-professionnel-technique-avance");
  });
});
