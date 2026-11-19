import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { simpleGit } from "simple-git";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "@/server/db/client";
import { documents, exercises, subjects } from "@/server/db/schema";
import { seedSubjects } from "@/server/subjects";
import { saveImported } from "@/server/storage";
import { expandZips, scanDir } from "@/server/import/scan";
import { detectLang, groupKey, inferTags, inferType, isCorrection, pairCorrections } from "@/server/import/pairing";
import { syncRepo } from "@/server/import/github";
import { importTree, runImport } from "@/server/import/run";

let tmp: string;

async function makePdf(lines: string[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  lines.forEach((l, i) => page.drawText(l, { x: 50, y: 780 - i * 20, size: 12, font }));
  return Buffer.from(await pdf.save());
}

function put(root: string, rel: string, content: Buffer | string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

/** Arborescence factice reproduisant le dépôt du professeur. */
async function makeProfTree(root: string): Promise<void> {
  put(root, "ARCHIVE/2026/01_Algo/TD1.pdf", await makePdf([
    "TD1 - Les boucles",
    "Exercice 1 : Somme",
    "Ecrire un programme qui calcule la somme des entiers de 1 a n.",
    "Exercice 2 : Produit",
    "Ecrire un programme qui calcule le produit des entiers de 1 a n.",
  ]));
  put(root, "ARCHIVE/2026/01_Algo/TD1 (corrigé).pdf", await makePdf([
    "TD1 - Correction",
    "Exercice 1 : Somme",
    "int s = 0; for (int i = 1; i <= n; i++) s += i;",
    "Exercice 2 : Produit",
    "int p = 1; for (int i = 1; i <= n; i++) p *= i;",
  ]));
  put(root, "EXERCISES/LAB_GENERAL/03_Pointers.pdf", await makePdf([
    "Exercise 1: Swap",
    "Write a function that swaps two integers using pointers.",
  ]));
  put(root, "EXERCISES/LAB_GENERAL/03_Pointeurs.pdf", await makePdf([
    "Exercice 1 : Echange",
    "Ecrire une fonction qui echange deux entiers avec des pointeurs.",
  ]));
  put(root, "EXAMS/0. Inspirations/ds.pdf", await makePdf(["Devoir surveille externe"]));
  put(root, "PROJECTS/demo/bin/x.exe", "MZ binaire");
  put(root, "PROJECTS/demo/obj/main.o", "objet");
  put(root, "PROJECTS/demo/demo.cbp", "<CodeBlocks/>");
  put(root, "000_TEMPLATE/modele.pdf", "%PDF modele");
  put(root, "COURSES/page_files/style.css", "body{}");
  put(root, "COURSES/README", "sans extension");
  put(root, "PROJECTS/demo/cmake-build-debug/CMakeCache.txt", "cache");
  put(root, "PROJECTS/demo/CMakeFiles/log.txt", "log");
  const zip = new AdmZip();
  zip.addFile("exo.c", Buffer.from("#include <stdio.h>\nint main(void) { return 0; }\n"));
  zip.addFile("zz/evil.txt", Buffer.from("evasion"));
  zip.addFile("bin/y.exe", Buffer.from("MZ"));
  zip.addFile("run.exe", Buffer.from("MZ"));
  // adm-zip assainit les noms à l'écriture : on forge l'entrée `../evil.txt` à la main (même longueur).
  const raw = zip.toBuffer();
  const forged = Buffer.from(raw.toString("latin1").replaceAll("zz/evil.txt", "../evil.txt"), "latin1");
  put(root, "ARCHIVE/2026/UNSORTED_MESS/paquet.zip", forged);
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bb1-import-"));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("scanDir / expandZips", () => {
  it("ignore binaires, dossiers exclus, extensions non autorisées ; extrait les zips sans `..`", async () => {
    const root = path.join(tmp, "scan");
    await makeProfTree(root);
    const files = scanDir(root);
    const rels = files.map((f) => f.relPath).sort();
    expect(rels).toEqual([
      "ARCHIVE/2026/01_Algo/TD1 (corrigé).pdf",
      "ARCHIVE/2026/01_Algo/TD1.pdf",
      "ARCHIVE/2026/UNSORTED_MESS/paquet.zip",
      "EXAMS/0. Inspirations/ds.pdf",
      "EXERCISES/LAB_GENERAL/03_Pointers.pdf",
      "EXERCISES/LAB_GENERAL/03_Pointeurs.pdf",
    ]);
    const out = path.join(tmp, "scan-zips");
    const expanded = expandZips(files, out);
    const fromZip = expanded.filter((f) => f.relPath.includes("paquet.zip"));
    expect(fromZip.map((f) => f.relPath)).toEqual(["ARCHIVE/2026/UNSORTED_MESS/paquet.zip/exo.c"]);
    expect(fromZip[0].ext).toBe(".c");
    expect(fs.readFileSync(fromZip[0].absPath, "utf8")).toContain("#include");
    expect(expanded.some((f) => f.ext === ".zip")).toBe(false);
    expect(fs.existsSync(path.join(tmp, "evil.txt"))).toBe(false);
  });
});

describe("inférence et appariement", () => {
  it("inferType", () => {
    expect(inferType("EXAMS/0. Inspirations/ds.pdf")).toBe("exam");
    expect(inferType("ARCHIVE/2026/01_Algo/TD1.pdf")).toBe("exercise");
    expect(inferType("ARCHIVE/2026/02_x/TP3 - Tableaux.pdf")).toBe("exercise");
    expect(inferType("EXERCISES/LAB_GENERAL/03_Pointers.pdf")).toBe("exercise");
    expect(inferType("x/correction exo 1.txt")).toBe("exercise");
    expect(inferType("COURSES/Cours 1 - Introduction.pdf")).toBe("course");
    expect(inferType("Mathématiques pour Info/exercices logique.pdf")).toBe("exercise");
  });

  it("inferTags", () => {
    expect(inferTags("EXAMS/0. Inspirations/ds.pdf")).toContain("externe");
    expect(inferTags("ARCHIVE/2026/07_Pointeurs/TD7.pdf")).toContain("chapitre-07");
    expect(inferTags("COURSES/a.pdf")).toEqual([]);
  });

  it("isCorrection / pairCorrections (accents, casse, préfixes)", () => {
    expect(isCorrection("TD1 (corrigé).pdf")).toBe(true);
    expect(isCorrection("CORRECTION_save_load.txt")).toBe(true);
    expect(isCorrection("TD1.pdf")).toBe(false);
    const pairs = pairCorrections([
      { id: "a", relPath: "ARCHIVE/2026/01_Algo/TD1.pdf" },
      { id: "b", relPath: "ARCHIVE/2026/01_Algo/td1 (CORRIGE).pdf" },
      { id: "c", relPath: "U/save_load.txt" },
      { id: "d", relPath: "U/CORRECTION_save_load.txt" },
      { id: "e", relPath: "U/TP2.pdf" },
      { id: "f", relPath: "U/TP2 corrigé.pdf" },
      { id: "g", relPath: "U/Orphelin (corrigé).pdf" },
    ]);
    expect(Object.fromEntries(pairs)).toEqual({ a: "b", c: "d", e: "f" });
  });

  it("groupKey : même préfixe numérique dans le même dossier", () => {
    expect(groupKey("EXERCISES/LAB_GENERAL/03_Pointers.pdf")).toBe(groupKey("EXERCISES/LAB_GENERAL/03_Pointeurs.pdf"));
    expect(groupKey("EXERCISES/LAB_GENERAL/01_Variables_Si_Boucles.pdf")).toBe(
      groupKey("EXERCISES/LAB_GENERAL/01_Variables_IF_Loops.pdf"),
    );
    expect(groupKey("EXERCISES/LAB_GENERAL/01_a.pdf")).not.toBe(groupKey("EXERCISES/LAB_GENERAL/03_a.pdf"));
    expect(groupKey("A/01_a.pdf")).not.toBe(groupKey("B/01_a.pdf"));
    expect(groupKey("EXAMS/Exam_FR.pdf")).toBe(groupKey("EXAMS/Exam_EN.pdf"));
  });

  it("detectLang : suffixe du nom, sinon mots FR/EN, défaut fr", () => {
    expect(detectLang("Exam_EN.pdf", "")).toBe("en");
    expect(detectLang("Exam_FR.pdf", "the and with")).toBe("fr");
    expect(detectLang("03_Pointers.pdf", "Write a function that swaps the two values with pointers")).toBe("en");
    expect(detectLang("03_Pointeurs.pdf", "Ecrire une fonction qui echange les deux valeurs avec des pointeurs")).toBe("fr");
    expect(detectLang("x.pdf", "")).toBe("fr");
  });
});

describe("saveImported", () => {
  it("écrit uploads/imported/<sha256><ext>", () => {
    const root = path.join(tmp, "save");
    const r = saveImported(Buffer.from("abc"), ".TXT", root);
    expect(r.filePath).toMatch(/^uploads\/imported\/[0-9a-f]{64}\.txt$/);
    expect(r.mime).toBe("text/plain");
    expect(fs.readFileSync(path.join(root, r.filePath), "utf8")).toBe("abc");
    expect(() => saveImported(Buffer.from("x"), ".exe", root)).toThrow();
  });
});

describe("runImport (dépôt prof + dossier local)", () => {
  let db: Db;
  let storage: string;
  let repo: string;
  let local: string;

  beforeAll(async () => {
    db = createTestDb();
    seedSubjects(db);
    storage = path.join(tmp, "storage");
    repo = path.join(tmp, "prof-repo");
    local = path.join(tmp, "local");
    await makeProfTree(repo);
    const git = simpleGit(repo);
    await git.init();
    await git.add(".");
    await git.raw(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
    // Dossier local : un dossier = une matière.
    put(local, "Mathématiques pour Info/exercices logique.pdf", await makePdf(["Exercice 1 : Tables de verite", "Construire la table de verite de A et B."]));
    put(local, "Nouvelle Matiere/notes.md", "# Notes\nrien de special");
    put(local, "infra-data/page_files/x.css", "body{}");
    put(local, "infra-data/page.html", "<html></html>");
    put(local, "memo linux.txt", "grep chmod bash sudo");
  });

  it("premier import : ajoute, apparie, extrait les exercices ; second import : added = 0", async () => {
    const first = await runImport({ db, localRoot: local, repoUrl: repo, storage });
    expect(first.errors).toEqual([]);
    // Dépôt : TD1, corrigé, Pointers, Pointeurs, ds, exo.c ; local : 3 fichiers.
    expect(db.select().from(documents).all().filter((d) => d.source === "github").map((d) => d.sourcePath).sort()).toEqual([
      "ARCHIVE/2026/01_Algo/TD1 (corrigé).pdf",
      "ARCHIVE/2026/01_Algo/TD1.pdf",
      "ARCHIVE/2026/UNSORTED_MESS/paquet.zip/exo.c",
      "EXAMS/0. Inspirations/ds.pdf",
      "EXERCISES/LAB_GENERAL/03_Pointers.pdf",
      "EXERCISES/LAB_GENERAL/03_Pointeurs.pdf",
    ]);
    expect(first.github.added).toBe(6);
    expect(first.local.added).toBe(3);
    expect(first.added).toBe(9);

    const all = db.select().from(documents).all();
    const by = (name: string) => all.find((d) => d.sourcePath?.endsWith(name))!;
    const progC = db.select().from(subjects).where(eq(subjects.slug, "algorithmique-et-prog-c")).get()!;
    for (const d of all.filter((d) => d.source === "github")) {
      expect(d.subjectId).toBe(progC.id);
      expect(d.subjectConfirmed).toBe(true);
      expect(d.filePath).toMatch(/^uploads\/imported\/[0-9a-f]{64}\.\w+$/);
    }
    expect(by("exo.c").sourcePath).toBe("ARCHIVE/2026/UNSORTED_MESS/paquet.zip/exo.c");
    expect(by("TD1 (corrigé).pdf").correctionOfId).toBe(by("TD1.pdf").id);
    expect(by("ds.pdf").type).toBe("exam");
    expect(by("ds.pdf").tags).toContain("externe");
    expect(by("TD1.pdf").tags).toContain("chapitre-01");
    expect(all.some((d) => d.sourcePath?.endsWith(".exe"))).toBe(false);

    // Matières locales : dossier existant (accents) -> matière existante ; sinon créée.
    const maths = db.select().from(subjects).where(eq(subjects.slug, "mathematiques-pour-info")).get()!;
    expect(by("exercices logique.pdf").subjectId).toBe(maths.id);
    expect(by("exercices logique.pdf").subjectConfirmed).toBe(true);
    expect(by("exercices logique.pdf").source).toBe("local");
    const created = db.select().from(subjects).where(eq(subjects.slug, "nouvelle-matiere")).get();
    expect(created?.name).toBe("Nouvelle Matiere");
    expect(by("notes.md").subjectId).toBe(created!.id);
    // Fichier à la racine : classify().
    const linux = db.select().from(subjects).where(eq(subjects.slug, "linux-environnement-ia")).get()!;
    expect(by("memo linux.txt").subjectId).toBe(linux.id);
    expect(by("memo linux.txt").subjectConfirmed).toBe(false);

    // Exercices + solutions du corrigé apparié.
    const td1Ex = db.select().from(exercises).where(eq(exercises.documentId, by("TD1.pdf").id)).all();
    expect(td1Ex.map((e) => e.number).sort()).toEqual([1, 2]);
    expect(td1Ex.find((e) => e.number === 1)!.solution).toContain("s += i");
    expect(td1Ex.find((e) => e.number === 2)!.solution).toContain("p *= i");
    expect(td1Ex[0].subjectId).toBe(progC.id);
    // Le corrigé ne crée pas d'exercices en double.
    expect(db.select().from(exercises).where(eq(exercises.documentId, by("TD1 (corrigé).pdf").id)).all()).toHaveLength(0);
    // FR/EN : même groupKey, langues différentes.
    const en = db.select().from(exercises).where(eq(exercises.documentId, by("03_Pointers.pdf").id)).get()!;
    const fr = db.select().from(exercises).where(eq(exercises.documentId, by("03_Pointeurs.pdf").id)).get()!;
    expect(en.groupKey).toBe(fr.groupKey);
    expect(en.lang).toBe("en");
    expect(fr.lang).toBe("fr");
    const exCount = db.select().from(exercises).all().length;
    expect(first.exercises).toBe(exCount);

    const second = await runImport({ db, localRoot: local, repoUrl: repo, storage });
    expect(second.errors).toEqual([]);
    expect(second.added).toBe(0);
    expect(second.exercises).toBe(0);
    expect(second.skipped).toBe(first.added);
    expect(db.select().from(exercises).all()).toHaveLength(exCount);
    expect(db.select().from(documents).all()).toHaveLength(all.length);
    const again = db.select().from(documents).all();
    expect(again.find((d) => d.sourcePath?.endsWith("TD1 (corrigé).pdf"))!.correctionOfId).toBe(by("TD1.pdf").id);
  });

  it("dépôt injoignable : erreur signalée, l'import local continue", async () => {
    const db2 = createTestDb();
    seedSubjects(db2);
    const r = await runImport({
      db: db2,
      localRoot: local,
      repoUrl: path.join(tmp, "nexiste-pas"),
      storage: path.join(tmp, "storage2"),
    });
    expect(r.errors.length).toBe(1);
    expect(r.local.added).toBe(3);
  });

  it("syncRepo : clone si absent, pull sinon", async () => {
    const dest = path.join(tmp, "clone");
    await syncRepo(repo, dest);
    expect(fs.existsSync(path.join(dest, "EXAMS/0. Inspirations/ds.pdf"))).toBe(true);
    put(repo, "COURSES/new.md", "# nouveau");
    const git = simpleGit(repo);
    await git.add(".");
    await git.raw(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "add"]);
    await syncRepo(repo, dest);
    expect(fs.existsSync(path.join(dest, "COURSES/new.md"))).toBe(true);
  });

  it("importTree en mode classify : pas de matière forcée", async () => {
    const db3 = createTestDb();
    seedSubjects(db3);
    const root = path.join(tmp, "loose");
    put(root, "tp1.c", "#include <stdio.h>\nint main(void){ printf(\"x\"); }");
    const r = await importTree(db3, { root, source: "local", storage: path.join(tmp, "storage3"), mode: "classify" });
    expect(r.added).toBe(1);
    const d = db3.select().from(documents).get()!;
    expect(d.subjectConfirmed).toBe(false);
    expect(db3.select().from(subjects).where(eq(subjects.id, d.subjectId!)).get()!.slug).toBe("algorithmique-et-prog-c");
  });

  it("import interrompu : un énoncé déjà présent sans exercices les reçoit au passage suivant, sans doublon", async () => {
    const db4 = createTestDb();
    seedSubjects(db4);
    const root = path.join(tmp, "interrupted");
    put(root, "Algorithmique et Prog C/TD1.pdf", await makePdf([
      "Exercice 1 : Somme", "Ecrire un programme qui calcule la somme des entiers.",
      "Exercice 2 : Produit", "Ecrire un programme qui calcule le produit des entiers.",
    ]));
    put(root, "Algorithmique et Prog C/TD1 (corrigé).pdf", await makePdf([
      "Exercice 1 : Somme", "int s = 0; for (int i = 1; i <= n; i++) s += i;",
      "Exercice 2 : Produit", "int p = 1; for (int i = 1; i <= n; i++) p *= i;",
    ]));
    const opts = { root, source: "local" as const, storage: path.join(tmp, "storage4"), mode: "folders" as const };
    const first = await importTree(db4, opts);
    expect(first.exercises).toBe(2);
    const td1 = db4.select().from(documents).all().find((d) => d.sourcePath?.endsWith("TD1.pdf"))!;
    // Simule un passage interrompu après la création du document, avant ses exercices.
    db4.delete(exercises).where(eq(exercises.documentId, td1.id)).run();

    const second = await importTree(db4, opts);
    expect(second.added).toBe(0);
    expect(second.failed).toBe(0);
    expect(second.exercises).toBe(2);
    const rows = db4.select().from(exercises).where(eq(exercises.documentId, td1.id)).all();
    expect(rows.map((e) => e.number).sort()).toEqual([1, 2]);
    expect(rows.find((e) => e.number === 1)!.solution).toContain("s += i");

    const third = await importTree(db4, opts);
    expect(third.exercises).toBe(0);
    expect(db4.select().from(exercises).all()).toHaveLength(2);
  });

  it("dossier au nom de plus de 60 caractères : une seule matière, même après plusieurs imports", async () => {
    const db5 = createTestDb();
    seedSubjects(db5);
    const root = path.join(tmp, "longname");
    // Ponctuation au milieu : le slug du nom complet (« un-dossier-de-cours-ia ») diffère de
    // celui du nom tronqué à 60 caractères (« un-dossier-de-cours »).
    const longName = `Un dossier de cours ${"-".repeat(50)} IA`;
    expect(longName.length).toBeGreaterThan(60);
    put(root, `${longName}/a.md`, "# a");
    const opts = { root, source: "local" as const, storage: path.join(tmp, "storage5"), mode: "folders" as const };
    await importTree(db5, opts);
    put(root, `${longName}/b.md`, "# b");
    await importTree(db5, opts);
    const created = db5.select().from(subjects).all().filter((s) => s.name.startsWith("Un dossier de cours"));
    expect(created).toHaveLength(1);
    expect(created[0].name.length).toBeLessThanOrEqual(60);
    expect(db5.select().from(documents).all().every((d) => d.subjectId === created[0].id)).toBe(true);
  });
});

describe("expandZips : garde-fous", () => {
  function zipWith(n: number, size: number): string {
    const zip = new AdmZip();
    for (let i = 0; i < n; i++) zip.addFile(`f${i}.txt`, Buffer.alloc(size, 97));
    const p = path.join(tmp, `bomb-${n}-${size}.zip`);
    fs.writeFileSync(p, zip.toBuffer());
    return p;
  }
  const limits = { maxEntries: 5000, maxBytesPerZip: 500 * 1024 * 1024, maxBytesTotal: 2 * 1024 * 1024 * 1024 };

  it("zip au-delà du nombre max d'entrées : ignoré", () => {
    const abs = zipWith(10, 1);
    const out = expandZips([{ absPath: abs, relPath: "z.zip", ext: ".zip" }], path.join(tmp, "bomb1"), { ...limits, maxEntries: 5 });
    expect(out).toEqual([]);
  });

  it("plafond d'octets par zip et total : le reste est ignoré", () => {
    const abs = zipWith(10, 1000);
    const f = { absPath: abs, relPath: "z.zip", ext: ".zip" };
    expect(expandZips([f], path.join(tmp, "bomb2"), { ...limits, maxBytesPerZip: 3500 })).toHaveLength(3);
    const two = [f, { ...f, relPath: "y.zip" }];
    expect(expandZips(two, path.join(tmp, "bomb3"), { ...limits, maxBytesPerZip: 3500, maxBytesTotal: 5000 })).toHaveLength(5);
    expect(expandZips([f], path.join(tmp, "bomb4"))).toHaveLength(10);
  });
});
