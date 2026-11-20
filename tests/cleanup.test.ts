import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/server/db/client";
import { documents, exercises, importExclusions, posts, progress, subjects, threads, users } from "@/server/db/schema";
import { createDocument, deleteDocument, type Document } from "@/server/documents";
import { isExcludedPath } from "@/server/import/exclusions";
import { pruneImported } from "@/server/import/prune";
import { importTree } from "@/server/import/run";
import { scanDir } from "@/server/import/scan";
import { saveImported } from "@/server/storage";
import { DEFAULT_SUBJECTS, seedSubjects } from "@/server/subjects";

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bb1-cleanup-"));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function put(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

describe("exclusions", () => {
  it("exclut netflix, logos, cmake-build, Version Archive (PDF Archive gardé)", () => {
    expect(isExcludedPath("HOMEWORKS/TPE07 - 01/Resources/VS--Netflix-LeVoyage-23.jpg")).toBe(true);
    expect(isExcludedPath("Présentations B1/ECE_logo.png")).toBe(true);
    expect(isExcludedPath("assets/Omnes Logo.JPG")).toBe(true);
    expect(isExcludedPath("PROJECTS/demo/cmake-build-debug/main.c")).toBe(true);
    expect(isExcludedPath("PROJECTS/demo/CMakeLists.txt")).toBe(true);
    expect(isExcludedPath("COURSES/TPE-004/Version Archive/Basics (1.0).pptx")).toBe(true);
    expect(isExcludedPath("COURSES/TPE-004/PDF Archive/Basics (v0.8).pdf")).toBe(false);
    expect(isExcludedPath("LICENSE.md")).toBe(true);
  });

  it("garde cours, TD et images de formules", () => {
    expect(isExcludedPath("ARCHIVE/2026/01_Algo/ECE - Algo et C - TD1 - Algorithmes et Logigrammes.pdf")).toBe(false);
    expect(isExcludedPath("COURSES/TPE-004. The Basics of C/Resources/trigo.png")).toBe(false);
    expect(isExcludedPath("ARCHIVE/2026/Memento_general.pdf")).toBe(false);
    expect(isExcludedPath("SYLLABUS.md")).toBe(false);
    expect(isExcludedPath("Algorithmique et Prog C/README.md")).toBe(false);
  });

  it("scanDir applique les exclusions", () => {
    const root = path.join(tmp, "scan");
    put(root, "M/TD1.pdf", "x");
    put(root, "M/Resources/VS--Netflix-x.png", "x");
    put(root, "M/Resources/trigo.png", "x");
    put(root, "M/Version Archive/old.pdf", "x");
    put(root, "M/logo.png", "x");
    expect(scanDir(root).map((f) => f.relPath)).toEqual(["M/Resources/trigo.png", "M/TD1.pdf"]);
  });
});

describe("matières par défaut", () => {
  it("ne contient plus data-analysis (10 matières)", () => {
    expect(DEFAULT_SUBJECTS).toHaveLength(10);
    expect(DEFAULT_SUBJECTS.some((s) => s.slug === "data-analysis")).toBe(false);
  });

  it("import local : pas de matière pour un dossier vide ou exclu", async () => {
    const db = createTestDb();
    const root = path.join(tmp, "folders");
    put(root, "Maths/cours.txt", "contenu maths");
    fs.mkdirSync(path.join(root, "data-analysis"), { recursive: true });
    put(root, "Version Archive/old.txt", "ancien");
    await importTree(db, { root, source: "local", storage: path.join(tmp, "st0"), mode: "folders" });
    const names = db.select().from(subjects).all().map((s) => s.name);
    expect(names).toEqual(["Maths"]);
  });
});

describe("deleteDocument", () => {
  let db: Db;
  let storage: string;
  let admin: { id: string; role: "admin" };
  let alice: { id: string; role: "member" };
  let bob: { id: string; role: "member" };

  const mkUser = (name: string, role: "admin" | "member") =>
    db.insert(users).values({ name, email: `${name}@x.fr`, passwordHash: "x", role }).returning().get();

  function mkDoc(opts: { authorId?: string | null }): Document {
    const saved = saveImported(Buffer.from(crypto.randomUUID()), ".txt", storage);
    return createDocument(db, {
      title: "Doc",
      type: "note",
      filePath: saved.filePath,
      mime: saved.mime,
      sha256: saved.sha256,
      source: "upload",
      authorId: opts.authorId ?? null,
    });
  }
  const abs = (d: Document) => path.join(storage, d.filePath);

  beforeEach(() => {
    db = createTestDb();
    seedSubjects(db);
    storage = fs.mkdtempSync(path.join(tmp, "st-"));
    admin = { id: mkUser("admin", "admin").id, role: "admin" };
    alice = { id: mkUser("alice", "member").id, role: "member" };
    bob = { id: mkUser("bob", "member").id, role: "member" };
  });

  it("l'auteur supprime sa note ; fichier, exercices, progression et fils disparaissent", () => {
    const doc = mkDoc({ authorId: alice.id });
    const ex = db.insert(exercises).values({ documentId: doc.id, number: 1, title: "t", statement: "s", groupKey: "g" }).returning().get();
    db.insert(progress).values({ userId: bob.id, exerciseId: ex.id, status: "doing" }).run();
    const th = db.insert(threads).values({ targetType: "document", targetId: doc.id, question: "q", authorId: bob.id }).returning().get();
    db.insert(posts).values({ threadId: th.id, authorId: bob.id, body: "b" }).run();
    db.insert(threads).values({ targetType: "exercise", targetId: ex.id, question: "q", authorId: bob.id }).run();
    const corr = mkDoc({ authorId: alice.id });
    db.update(documents).set({ correctionOfId: doc.id }).where(eq(documents.id, corr.id)).run();
    expect(fs.existsSync(abs(doc))).toBe(true);

    deleteDocument(db, doc.id, alice, storage);

    expect(db.select().from(documents).where(eq(documents.id, doc.id)).get()).toBeUndefined();
    expect(fs.existsSync(abs(doc))).toBe(false);
    expect(db.select().from(exercises).all()).toHaveLength(0);
    expect(db.select().from(progress).all()).toHaveLength(0);
    expect(db.select().from(threads).all()).toHaveLength(0);
    expect(db.select().from(posts).all()).toHaveLength(0);
    expect(db.select().from(documents).where(eq(documents.id, corr.id)).get()!.correctionOfId).toBeNull();
  });

  it("un autre membre ne peut pas ; l'admin peut tout", () => {
    const doc = mkDoc({ authorId: alice.id });
    expect(() => deleteDocument(db, doc.id, bob, storage)).toThrow("forbidden");
    expect(fs.existsSync(abs(doc))).toBe(true);
    deleteDocument(db, doc.id, admin, storage);
    expect(fs.existsSync(abs(doc))).toBe(false);
    expect(() => deleteDocument(db, doc.id, admin, storage)).toThrow("not_found");
  });

  it("garde le fichier s'il est référencé par un autre document", () => {
    const a = mkDoc({ authorId: alice.id });
    const b = db.insert(documents).values({ ...a, id: crypto.randomUUID(), sha256: "autre" }).returning().get();
    deleteDocument(db, a.id, alice, storage);
    expect(fs.existsSync(abs(b))).toBe(true);
  });

  it("document importé : admin seulement, sha256 exclu du ré-import", async () => {
    const root = path.join(tmp, "reimport");
    put(root, "Maths/cours.txt", "contenu du cours de maths");
    const st = path.join(tmp, "st-reimport");
    const r1 = await importTree(db, { root, source: "local", storage: st, mode: "folders" });
    expect(r1.added).toBe(1);
    const doc = db.select().from(documents).get()!;
    expect(() => deleteDocument(db, doc.id, alice, st)).toThrow("forbidden");
    deleteDocument(db, doc.id, admin, st);
    const ex = db.select().from(importExclusions).all();
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ sha256: doc.sha256, sourcePath: "Maths/cours.txt", deletedBy: admin.id });
    const r2 = await importTree(db, { root, source: "local", storage: st, mode: "folders" });
    expect(r2.added).toBe(0);
    expect(db.select().from(documents).all()).toHaveLength(0);
  });
});

describe("pruneImported", () => {
  it("supprime les documents exclus et les matières vides hors défaut ; idempotent", () => {
    const db = createTestDb();
    seedSubjects(db);
    const storage = fs.mkdtempSync(path.join(tmp, "st-prune-"));
    const extra = db.insert(subjects).values({ name: "data-analysis", slug: "data-analysis" }).returning().get();
    const used = db.insert(subjects).values({ name: "Perso", slug: "perso" }).returning().get();
    const mk = (n: string, sourcePath: string | null, source: "local" | "upload", subjectId?: string) => {
      const saved = saveImported(Buffer.from(n), ".txt", storage);
      return createDocument(db, { title: n, type: "course", filePath: saved.filePath, mime: saved.mime, sha256: saved.sha256, source, sourcePath, subjectId });
    };
    const bad = mk("netflix", "HW/Resources/VS--Netflix-a.png", "local");
    mk("good", "HW/Resources/trigo.png", "local", used.id);
    const upload = mk("up", "x/Netflix.png", "upload");
    const r = pruneImported(db, storage);
    expect(r.documents.map((d) => d.sourcePath)).toEqual(["HW/Resources/VS--Netflix-a.png"]);
    expect(r.subjects).toEqual(["data-analysis"]);
    expect(db.select().from(documents).where(eq(documents.id, bad.id)).get()).toBeUndefined();
    expect(db.select().from(documents).where(eq(documents.id, upload.id)).get()).toBeDefined();
    expect(db.select().from(subjects).where(eq(subjects.id, extra.id)).get()).toBeUndefined();
    expect(db.select().from(subjects).where(eq(subjects.id, used.id)).get()).toBeDefined();
    const again = pruneImported(db, storage);
    expect(again.documents).toHaveLength(0);
    expect(again.subjects).toHaveLength(0);
  });
});

describe("pruneImported (simulation)", () => {
  it("une matière dont les seuls exercices appartiennent à des documents condamnés est annoncée vide", () => {
    const db = createTestDb();
    seedSubjects(db);
    const storage = fs.mkdtempSync(path.join(tmp, "st-prune-dry-"));
    const extra = db.insert(subjects).values({ name: "data-analysis", slug: "data-analysis" }).returning().get();
    const saved = saveImported(Buffer.from("x"), ".txt", storage);
    const doc = createDocument(db, {
      title: "x", type: "exercise", filePath: saved.filePath, mime: saved.mime, sha256: saved.sha256,
      source: "local", sourcePath: "HW/Resources/VS--Netflix-a.png", subjectId: null,
    });
    db.insert(exercises).values({ documentId: doc.id, number: 1, title: "e", statement: "s", groupKey: "g", subjectId: extra.id }).run();
    const dry = pruneImported(db, storage, { dryRun: true });
    expect(dry.documents).toHaveLength(1);
    expect(dry.subjects).toEqual(["data-analysis"]);
    const real = pruneImported(db, storage);
    expect(real.subjects).toEqual(dry.subjects);
  });
});
