import { describe, expect, it } from "vitest";
import {
  categorizeDocument,
  compareDocumentsInCategory,
  documentContextBadge,
  extractSubGroup,
  formatFileKind,
  groupDocumentsByCategory,
  matchesDocumentQuery,
  parseCategory,
  type CategorizableDoc,
} from "@/lib/doc-categories";
import { inferTags, inferType } from "@/server/import/pairing";
import { titleFromFileName } from "@/lib/upload-core";

let seq = 0;

function makeDoc(
  overrides: Partial<CategorizableDoc> & { title?: string; filePath?: string; mime?: string },
): CategorizableDoc & { createdAt: Date } {
  const sourcePath = overrides.sourcePath ?? null;
  const baseName = sourcePath ? sourcePath.split("/").pop() ?? "doc.pdf" : "doc.pdf";
  const ext = /\.([^.]+)$/.exec(baseName)?.[1]?.toLowerCase() ?? "pdf";
  const defaultMime =
    ext === "png"
      ? "image/png"
      : ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "webp"
          ? "image/webp"
          : ext === "c" || ext === "h"
            ? "text/x-c"
            : ext === "py"
              ? "text/x-python"
              : ext === "md"
                ? "text/markdown"
                : ext === "txt"
                  ? "text/plain"
                  : ext === "docx"
                    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    : ext === "pptx"
                      ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                      : "application/pdf";

  const inferredType = sourcePath ? inferType(sourcePath) : "course";
  const inferredTags = sourcePath ? inferTags(sourcePath) : [];

  return {
    id: overrides.id ?? `doc-${++seq}`,
    title: overrides.title ?? (sourcePath ? titleFromFileName(baseName) : "Document"),
    type: overrides.type ?? inferredType,
    subjectId: overrides.subjectId ?? "subj-1",
    filePath: overrides.filePath ?? `uploads/imported/hash.${ext}`,
    mime: overrides.mime ?? defaultMime,
    source: overrides.source ?? (sourcePath ? "github" : "upload"),
    sourcePath,
    tags: overrides.tags ?? inferredTags,
    correctionOfId: overrides.correctionOfId ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-10-01T10:00:00Z"),
  };
}

describe("categorizeDocument — dépôt C_courses réel", () => {
  it("classe les cours, TP, mémos et piège 04_Functions-and-Projects dans ARCHIVE/2026", () => {
    expect(
      categorizeDocument(
        makeDoc({
          sourcePath:
            "ARCHIVE/2026/01_Algorithm-and-Logigrams/ECE - memo - Algo et C - Cours 1 - Algorithmes et Logigrammes.pdf",
        }),
      ),
    ).toBe("notes");

    expect(
      categorizeDocument(
        makeDoc({ sourcePath: "ARCHIVE/2026/01_Algorithm-and-Logigrams/Memento Algo-Organigramme.pdf" }),
      ),
    ).toBe("notes");

    expect(
      categorizeDocument(makeDoc({ sourcePath: "ARCHIVE/2026/Memento_general.pdf" })),
    ).toBe("notes");

    expect(
      categorizeDocument(
        makeDoc({
          sourcePath:
            "ARCHIVE/2026/01_Algorithm-and-Logigrams/ECE - Algo et C - TD1 - Algorithmes et Logigrammes.pdf",
        }),
      ),
    ).toBe("exercises");

    expect(
      categorizeDocument(
        makeDoc({
          sourcePath:
            "ARCHIVE/2026/01_Algorithm-and-Logigrams/ECE - Algo et C - TD1 - Algorithmes et Logigrammes (corrigé).pdf",
          correctionOfId: "td1-id",
        }),
      ),
    ).toBe("corrections");

    // Piège 04_Functions-and-Projects : cours/TP, surtout pas "projects"
    expect(
      categorizeDocument(
        makeDoc({
          sourcePath:
            "ARCHIVE/2026/04_Functions-and-Projects/ECE - Algo et C - Cours 4 - Sous-programmes et multi-fichiers.pdf",
        }),
      ),
    ).toBe("course");

    expect(
      categorizeDocument(
        makeDoc({
          sourcePath:
            "ARCHIVE/2026/04_Functions-and-Projects/ECE - Algo et C - TP4 - Sous-programmes et multi-fichiers.pdf",
        }),
      ),
    ).toBe("exercises");

    expect(
      categorizeDocument(
        makeDoc({ sourcePath: "ARCHIVE/2026/10_RECURSIVITY/ECE - Algo et C - Cours - Récursivité.pdf" }),
      ),
    ).toBe("course");

    expect(
      categorizeDocument(makeDoc({ sourcePath: "ARCHIVE/2026/11_Chained-Lists/ECE TP Listes Chaînées.pdf" })),
    ).toBe("exercises");
  });

  it("classe UNSORTED_MESS (corrigés autonomes, zip Correctif TP 9, zip Partiels et corrections)", () => {
    expect(
      categorizeDocument(makeDoc({ sourcePath: "ARCHIVE/2026/08_File-Handling/CORRECTION_save_load.txt" })),
    ).toBe("corrections");

    expect(
      categorizeDocument(
        makeDoc({ sourcePath: "ARCHIVE/2026/UNSORTED_MESS/Correction exercice dentrainement pour le partiel.c" }),
      ),
    ).toBe("corrections");

    expect(
      categorizeDocument(makeDoc({ sourcePath: "ARCHIVE/2026/UNSORTED_MESS/correction exo 1.txt" })),
    ).toBe("corrections");

    expect(
      categorizeDocument(
        makeDoc({ sourcePath: "ARCHIVE/2026/UNSORTED_MESS/Correctif TP 9-20260924.zip/main.c" }),
      ),
    ).toBe("corrections");

    // Dans ECE - Partiels et corrections.zip : un sujet reste dans exams, un corrigé va dans corrections
    expect(
      categorizeDocument(
        makeDoc({
          sourcePath: "ARCHIVE/2026/UNSORTED_MESS/ECE - Partiels et corrections.zip/Partiel_2024.pdf",
        }),
      ),
    ).toBe("exams");

    expect(
      categorizeDocument(
        makeDoc({
          sourcePath: "ARCHIVE/2026/UNSORTED_MESS/ECE - Partiels et corrections.zip/Partiel_2024 (corrigé).pdf",
        }),
      ),
    ).toBe("corrections");
  });

  it("classe COURSES (TPE vs TD vs images), EXAMS, EXERCISES, HOMEWORKS, PROJECTS et SYLLABUS", () => {
    // TPE-004 ne doit pas matcher "tp"
    expect(
      categorizeDocument(
        makeDoc({ sourcePath: "COURSES/TPE-004. The Basics of C/PDF Archive/TPE-004. Basics of C (v0.8).pdf" }),
      ),
    ).toBe("course");

    expect(
      categorizeDocument(
        makeDoc({ sourcePath: "COURSES/TPE-004. The Basics of C/TPE-004. Basics of C (1.0).pptx" }),
      ),
    ).toBe("course");

    expect(
      categorizeDocument(
        makeDoc({ sourcePath: "COURSES/TPE-004. The Basics of C/C-TD-Chapter02-v0.7.docx" }),
      ),
    ).toBe("exercises");

    expect(
      categorizeDocument(
        makeDoc({ sourcePath: "COURSES/TPE-004. The Basics of C/Resources/trigo.png" }),
      ),
    ).toBe("photos");

    // EXAMS/0. Inspirations : compilation mixte -> exams ; corrigé isolé -> corrections
    expect(
      categorizeDocument(
        makeDoc({ sourcePath: "EXAMS/0. Inspirations/annexe-3-anciens-ds-et-examens-corriges.pdf" }),
      ),
    ).toBe("exams");

    expect(
      categorizeDocument(makeDoc({ sourcePath: "EXAMS/0. Inspirations/DS2-MP2I-Correction.pdf" })),
    ).toBe("corrections");

    expect(
      categorizeDocument(makeDoc({ sourcePath: "EXAMS/0. Inspirations/correction__ds_programmation_11-2017.pdf" })),
    ).toBe("corrections");

    expect(
      categorizeDocument(makeDoc({ sourcePath: "EXAMS/2025/Mock exam/PROG-C_Exam_Bachelor1_2025-12-10-v2_EN.pdf" })),
    ).toBe("exams");

    expect(
      categorizeDocument(makeDoc({ sourcePath: "EXAMS/2026/B1_inter_mock/MOCK EXAM - B1 inter 2026.pdf" })),
    ).toBe("exams");

    expect(
      categorizeDocument(makeDoc({ sourcePath: "EXERCISES/LAB_GENERAL/03_Pointers.pdf" })),
    ).toBe("exercises");

    expect(
      categorizeDocument(makeDoc({ sourcePath: "EXERCISES/REVISIONS/SOUTIEN 2 - IF-FOR-WHILE.pdf" })),
    ).toBe("exercises");

    expect(
      categorizeDocument(makeDoc({ sourcePath: "EXERCISES/cahier_exo_C.pdf" })),
    ).toBe("exercises");

    expect(
      categorizeDocument(makeDoc({ sourcePath: "HOMEWORKS/TPE07 - 01 - Spirited Away/HOMEWORK - Spirited Away (v.1).docx" })),
    ).toBe("projects");

    expect(
      categorizeDocument(makeDoc({ sourcePath: "PROJECTS/C_project_chess_v1.4.pdf" })),
    ).toBe("projects");

    // PROJECTS/chess_project_solution/main.c reste avec le projet Chess
    expect(
      categorizeDocument(makeDoc({ sourcePath: "PROJECTS/chess_project_solution/main.c" })),
    ).toBe("projects");

    expect(categorizeDocument(makeDoc({ sourcePath: "SYLLABUS.md" }))).toBe("syllabus");
    expect(categorizeDocument(makeDoc({ sourcePath: "SYLLABUS/C-Syllabus-v1.1.pdf" }))).toBe("syllabus");
  });
});

describe("categorizeDocument — autres matières, uploads et faux positifs", () => {
  it("évite les faux positifs sur les titres ambigus", () => {
    expect(categorizeDocument(makeDoc({ title: "Solutions cloud et architecture", source: "upload" }))).toBe("course");
    expect(categorizeDocument(makeDoc({ title: "Programme en C : structures", source: "upload" }))).toBe("course");
  });

  it("classe les autres matières (Maths, Front-End, Anglais, Linux, Infra-Data, Techaway, Présentations B1)", () => {
    expect(
      categorizeDocument(
        makeDoc({ source: "local", sourcePath: "Mathématiques pour Info/Algèbre linéaire/Cours 2.pdf" }),
      ),
    ).toBe("course");

    expect(
      categorizeDocument(
        makeDoc({ source: "local", sourcePath: "Mathématiques pour Info/TD Matrices.pdf" }),
      ),
    ).toBe("exercises");

    expect(
      categorizeDocument(
        makeDoc({ source: "local", sourcePath: "Mathématiques pour Info/TD Matrices (corrigé).pdf" }),
      ),
    ).toBe("corrections");

    expect(
      categorizeDocument(
        makeDoc({ source: "local", sourcePath: "Développement web Front-End/2_CSS_Flexbox.pdf" }),
      ),
    ).toBe("course");

    expect(
      categorizeDocument(
        makeDoc({ source: "local", sourcePath: "Développement web Front-End/Mini-projet Portfolio.pdf" }),
      ),
    ).toBe("projects");

    expect(
      categorizeDocument(
        makeDoc({ source: "local", sourcePath: "Anglais professionnel & technique avancé/Worksheet 3 - Irregular verbs.pdf" }),
      ),
    ).toBe("exercises");

    expect(
      categorizeDocument(
        makeDoc({ source: "local", sourcePath: "Anglais professionnel & technique avancé/Worksheet 3 - Answer Key.pdf" }),
      ),
    ).toBe("corrections");

    expect(
      categorizeDocument(
        makeDoc({ source: "local", sourcePath: "Anglais professionnel & technique avancé/TOEIC Practice Test.pdf" }),
      ),
    ).toBe("exams");

    expect(
      categorizeDocument(
        makeDoc({ source: "local", sourcePath: "Anglais professionnel & technique avancé/Assignment - Tech Essay.docx" }),
      ),
    ).toBe("projects");

    expect(
      categorizeDocument(
        makeDoc({ source: "local", sourcePath: "Linux & environnement IA/Aide-mémoire commandes Linux.md" }),
      ),
    ).toBe("notes");

    expect(
      categorizeDocument(
        makeDoc({ source: "local", sourcePath: "infra-data/Étude de cas Data Warehouse.pdf" }),
      ),
    ).toBe("projects");

    expect(
      categorizeDocument(
        makeDoc({ source: "local", sourcePath: "Techaway dataanalysis/Syllabus_TECHAWAY_Data Analysis N1.pdf" }),
      ),
    ).toBe("syllabus");

    expect(
      categorizeDocument(
        makeDoc({ source: "local", sourcePath: "Présentations B1/Présentation cursus B1.pdf" }),
      ),
    ).toBe("syllabus");
  });

  it("classe les documents déposés via le navigateur (sans sourcePath)", () => {
    expect(
      categorizeDocument(makeDoc({ title: "Fiche révision pointeurs", type: "note", mime: "text/markdown", source: "upload" })),
    ).toBe("notes");

    expect(
      categorizeDocument(makeDoc({ title: "Photo du tableau", type: "photo", mime: "image/jpeg", source: "upload" })),
    ).toBe("photos");

    expect(
      categorizeDocument(makeDoc({ title: "TP3 Boucles", type: "exercise", mime: "application/pdf", source: "upload" })),
    ).toBe("exercises");

    expect(
      categorizeDocument(makeDoc({ title: "Solution TP3", type: "exercise", mime: "text/x-c", source: "upload" })),
    ).toBe("corrections");

    expect(
      categorizeDocument(makeDoc({ title: "Partiel blanc 2026", type: "exam", mime: "application/pdf", source: "upload" })),
    ).toBe("exams");
  });
});

describe("tri pédagogique naturel", () => {
  it("trie les chapitres 1 à 11 dans l'ordre numérique (y compris Cours 10 et 11 sans numéro dans le titre)", () => {
    const c10 = makeDoc({
      title: "ECE - Algo et C - Cours - Récursivité",
      sourcePath: "ARCHIVE/2026/10_RECURSIVITY/ECE - Algo et C - Cours - Récursivité.pdf",
    });
    const c2 = makeDoc({
      title: "ECE - Algo et C - Cours 2 - Ordinateurs",
      sourcePath: "ARCHIVE/2026/02_Computer-IDE-and-MORE/ECE - Algo et C - Cours 2 - Ordinateurs.pdf",
    });
    const c1 = makeDoc({
      title: "ECE - Algo et C - Cours 1 - Algorithmes",
      sourcePath: "ARCHIVE/2026/01_Algorithm-and-Logigrams/ECE - Algo et C - Cours 1 - Algorithmes.pdf",
    });
    const c11 = makeDoc({
      title: "ECE - Algo et C - Cours - Listes chaînées",
      sourcePath: "ARCHIVE/2026/11_Chained-Lists/ECE - Algo et C - Cours - Listes chaînées.pdf",
    });
    const sorted = [c10, c2, c11, c1].sort((a, b) => compareDocumentsInCategory(a, b, "course"));
    expect(sorted.map((d) => d.title)).toEqual([c1.title, c2.title, c10.title, c11.title]);
  });

  it("trie 2_CSS avant 10_JS naturellement", () => {
    const d10 = makeDoc({ title: "10 JS DOM", source: "local", sourcePath: "Développement web Front-End/10_JS_DOM.pdf" });
    const d2 = makeDoc({ title: "2 CSS Flexbox", source: "local", sourcePath: "Développement web Front-End/2_CSS_Flexbox.pdf" });
    const sorted = [d10, d2].sort((a, b) => compareDocumentsInCategory(a, b, "course"));
    expect(sorted.map((d) => d.title)).toEqual(["2 CSS Flexbox", "10 JS DOM"]);
  });

  it("trie les examens par année décroissante et les photos par date décroissante", () => {
    const e2017 = makeDoc({ title: "ds_2017", sourcePath: "EXAMS/0. Inspirations/ds_2017.pdf" });
    const e2025 = makeDoc({ title: "Exam 2025", sourcePath: "EXAMS/2025/Exam.pdf" });
    const e2026 = makeDoc({ title: "Mock 2026", sourcePath: "EXAMS/2026/Mock.pdf" });
    const sortedExams = [e2017, e2026, e2025].sort((a, b) => compareDocumentsInCategory(a, b, "exams"));
    expect(sortedExams.map((d) => d.title)).toEqual(["Mock 2026", "Exam 2025", "ds_2017"]);

    const oldPhoto = makeDoc({ title: "Tableau 1", type: "photo", mime: "image/jpeg", createdAt: new Date("2026-09-01") });
    const newPhoto = makeDoc({ title: "Tableau 2", type: "photo", mime: "image/jpeg", createdAt: new Date("2026-11-20") });
    const sortedPhotos = [oldPhoto, newPhoto].sort((a, b) => compareDocumentsInCategory(a, b, "photos"));
    expect(sortedPhotos.map((d) => d.title)).toEqual(["Tableau 2", "Tableau 1"]);
  });
});

describe("groupDocumentsByCategory — sous-groupement adaptatif", () => {
  it("n'active pas les sous-groupes si la catégorie a moins de 8 documents", () => {
    const docs = [
      makeDoc({ sourcePath: "ARCHIVE/2026/01_Algo/Cours 1.pdf" }),
      makeDoc({ sourcePath: "COURSES/TPE-004/TPE-004.pdf" }),
    ];
    const groups = groupDocumentsByCategory(docs);
    expect(groups).toHaveLength(1);
    expect(groups[0].category.id).toBe("course");
    expect(groups[0].subGroups).toBeUndefined();
  });

  it("active les sous-groupes quand >= 8 docs et structure pertinente (ex. Cours C)", () => {
    const docs = [
      makeDoc({ sourcePath: "ARCHIVE/2026/01_Algo/Cours 1.pdf" }),
      makeDoc({ sourcePath: "ARCHIVE/2026/02_IDE/Cours 2.pdf" }),
      makeDoc({ sourcePath: "ARCHIVE/2026/03_Loops/Cours 3.pdf" }),
      makeDoc({ sourcePath: "ARCHIVE/2026/04_Functions-and-Projects/Cours 4.pdf" }),
      makeDoc({ sourcePath: "ARCHIVE/2026/05_Lists/Cours 5.pdf" }),
      makeDoc({ sourcePath: "ARCHIVE/2026/06_Pointers/Cours 6.pdf" }),
      makeDoc({ sourcePath: "COURSES/TPE-001/Intro.pdf" }),
      makeDoc({ sourcePath: "COURSES/TPE-004/Basics.pdf" }),
    ];
    const groups = groupDocumentsByCategory(docs);
    expect(groups).toHaveLength(1);
    expect(groups[0].subGroups?.map((sg) => sg.label)).toEqual(["Cours par chapitre", "Supports TPE"]);
    expect(groups[0].subGroups?.[0].docs).toHaveLength(6);
    expect(groups[0].subGroups?.[1].docs).toHaveLength(2);
  });

  it("aplatit les sous-groupes dégénérés (1 doc par dossier) et ignore Resources/ dans les chemins locaux", () => {
    expect(
      extractSubGroup(
        makeDoc({ source: "local", sourcePath: "Maths/Resources/Cours 1.pdf" }),
        "course",
      ),
    ).toBeNull();

    expect(
      extractSubGroup(
        makeDoc({ source: "local", sourcePath: "Maths/Algèbre/Resources/Cours 1.pdf" }),
        "course",
      ),
    ).toBe("Algèbre");

    const degenerate = Array.from({ length: 8 }, (_, i) =>
      makeDoc({ source: "local", sourcePath: `Maths/Dossier_${i}/Cours ${i}.pdf` }),
    );
    const groups = groupDocumentsByCategory(degenerate);
    expect(groups[0].subGroups).toBeUndefined();
  });
});

describe("utilitaires parseCategory, formatFileKind, documentContextBadge, matchesDocumentQuery", () => {
  it("parseCategory gère les catégories et les anciens types", () => {
    expect(parseCategory("corrections")).toBe("corrections");
    expect(parseCategory(null, "exercise")).toBe("exercises");
    expect(parseCategory(undefined, "exam")).toBe("exams");
    expect(parseCategory("invalide")).toBeUndefined();
  });

  it("formatFileKind et documentContextBadge", () => {
    expect(formatFileKind("a/b/main.c", "text/x-c")).toBe("Code C");
    expect(formatFileKind("a/b/doc.pdf", "application/pdf")).toBe("PDF");
    expect(formatFileKind("a/b/slide.pptx", "application/octet-stream")).toBe("PowerPoint");

    const ch6 = makeDoc({ sourcePath: "ARCHIVE/2026/06_Pointers/Memory_List_FR.pdf" });
    expect(documentContextBadge(ch6)).toBe("Chapitre 6");

    const ext = makeDoc({ sourcePath: "EXAMS/0. Inspirations/ds.pdf" });
    expect(documentContextBadge(ext)).toBe("Externe");

    const local = makeDoc({ source: "local", sourcePath: "Maths/Analyse/Cours.pdf" });
    expect(documentContextBadge(local)).toBe("Analyse");
    expect(documentContextBadge(local, { hideSubGroup: "Analyse" })).toBeNull();
  });

  it("matchesDocumentQuery recherche sans accents dans le titre, catégorie, tags et sous-groupe", () => {
    const doc = makeDoc({
      title: "ECE - Algo et C - Cours - Récursivité",
      sourcePath: "ARCHIVE/2026/10_RECURSIVITY/ECE - Algo et C - Cours - Récursivité.pdf",
    });
    expect(matchesDocumentQuery(doc, "recursivite")).toBe(true);
    expect(matchesDocumentQuery(doc, "chapitre-10")).toBe(true);
    expect(matchesDocumentQuery(doc, "cours")).toBe(true);
    expect(matchesDocumentQuery(doc, "python")).toBe(false);
  });
});
