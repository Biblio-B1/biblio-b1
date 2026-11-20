import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/server/db/client";
import { documents, exercises, subjects, users } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { createDocument, deleteDocument, setDocumentSubject } from "@/server/documents";
import { importTree } from "@/server/import/run";
import { indexDocument, indexExercise, parseSearchQuery, reindexAll, search } from "@/server/search";
import { createThread, deleteThread } from "@/server/threads";

let db: Db;
let tmp: string;
let userId: string;
let otherId: string;
let subjA: string;
let subjB: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bb1-search-"));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function mkDoc(title: string, text: string, extra: Partial<typeof documents.$inferInsert> = {}) {
  n++;
  return createDocument(db, {
    title,
    type: "course",
    filePath: `uploads/f${n}.pdf`,
    mime: "application/pdf",
    sha256: `sha-${n}`,
    text,
    source: "upload",
    ...extra,
  });
}
function mkEx(documentId: string, title: string, statement: string, subjectId: string | null = null) {
  n++;
  const row = db.insert(exercises).values({ documentId, number: n, title, statement, groupKey: `g${n}`, subjectId }).returning().get();
  indexExercise(db, row);
  return row;
}

beforeEach(() => {
  db = createTestDb();
  userId = db.insert(users).values({ name: "Ana", email: "a@x.io", passwordHash: "x" }).returning().get().id;
  otherId = db.insert(users).values({ name: "Bob", email: "b@x.io", passwordHash: "x" }).returning().get().id;
  subjA = db.insert(subjects).values({ name: "Alpha", slug: "alpha" }).returning().get().id;
  subjB = db.insert(subjects).values({ name: "Beta", slug: "beta" }).returning().get().id;
});

describe("search", () => {
  it("trouve par préfixe (pointeur → Pointeurs)", () => {
    const d = mkDoc("Cours sur les Pointeurs", "Les pointeurs en C");
    mkDoc("Autre", "rien à voir");
    expect(search(db, { q: "pointeur" }).map((x) => x.refId)).toEqual([d.id]);
  });

  it("ignore les accents dans les deux sens", () => {
    const a = mkDoc("Gestion de la mémoire", "malloc et free");
    const b = mkDoc("Pointéur nu", "texte");
    expect(search(db, { q: "memoire" }).map((x) => x.refId)).toEqual([a.id]);
    expect(search(db, { q: "mémoire" }).map((x) => x.refId)).toEqual([a.id]);
    expect(search(db, { q: "pointeur" }).map((x) => x.refId)).toEqual([b.id]);
  });

  it("filtre par type (exercise = exercices + documents de type exercice)", () => {
    const d = mkDoc("Série pointeurs", "pointeur", { type: "exercise" });
    const c = mkDoc("Cours pointeurs", "pointeur");
    const e = mkEx(c.id, "Pointeur fonction", "écrire un pointeur");
    const ids = search(db, { q: "pointeur", kind: "exercise" }).map((x) => x.refId).sort();
    expect(ids).toEqual([d.id, e.id].sort());
    expect(search(db, { q: "pointeur", kind: "course" }).map((x) => x.refId)).toEqual([c.id]);
    expect(search(db, { q: "pointeur", kind: "exam" })).toEqual([]);
  });

  it("filtre par matière, auteur et dates", () => {
    const a = mkDoc("Tableaux A", "tableau", { subjectId: subjA, authorId: userId });
    const b = mkDoc("Tableaux B", "tableau", { subjectId: subjB, authorId: otherId });
    expect(search(db, { q: "tableau", subjectId: subjA }).map((x) => x.refId)).toEqual([a.id]);
    expect(search(db, { q: "tableau", authorId: otherId }).map((x) => x.refId)).toEqual([b.id]);
    const t = a.createdAt.getTime();
    expect(search(db, { q: "tableau", from: new Date(t + 10 * 60_000) })).toEqual([]);
    expect(search(db, { q: "tableau", to: new Date(t - 10 * 60_000) })).toEqual([]);
    expect(search(db, { q: "tableau", from: new Date(t - 60_000), to: new Date(t + 60_000) })).toHaveLength(2);
  });

  it.each(['"', "a*b", "-x", "c:", "(", "AND", "NEAR(", '"" ""', "*", "^x", "a OR", "\\", 'c++ "x', "col:x", "{title}:x"])(
    "requête spéciale %j : pas d'exception",
    (q) => {
      mkDoc("Langage C", "a b x c AND OR NEAR");
      expect(() => search(db, { q })).not.toThrow();
      expect(Array.isArray(search(db, { q }))).toBe(true);
    },
  );

  it("chaque terme est préfixé et combiné en ET ; -x cherche x", () => {
    const d = mkDoc("Langage C", "boucle for");
    expect(search(db, { q: "lang bou" }).map((x) => x.refId)).toEqual([d.id]);
    expect(search(db, { q: "lang inexistant" })).toEqual([]);
    expect(search(db, { q: "-boucle" }).map((x) => x.refId)).toEqual([d.id]);
  });

  it("requête vide ou blanche → []", () => {
    mkDoc("Langage C", "x");
    expect(search(db, { q: "" })).toEqual([]);
    expect(search(db, { q: "   " })).toEqual([]);
    expect(search(db, { q: "***" })).toEqual([]);
  });

  it("snippet avec <mark>, HTML du texte échappé", () => {
    mkDoc("Doc", "avant <script>alert(1)</script> pointeur après");
    const [r] = search(db, { q: "pointeur" });
    expect(r.snippet).toContain("<mark>pointeur</mark>");
    expect(r.snippet).not.toContain("<script>");
    expect(r.snippet).toContain("&lt;script&gt;");
  });

  it("ne cherche pas dans les colonnes de type (mots « course », « document »)", () => {
    mkDoc("Titre", "texte");
    expect(search(db, { q: "course" })).toEqual([]);
    expect(search(db, { q: "document" })).toEqual([]);
  });

  it("limit", () => {
    for (let i = 0; i < 5; i++) mkDoc(`Pile ${i}`, "pile");
    expect(search(db, { q: "pile", limit: 3 })).toHaveLength(3);
  });

  it("un titre qui correspond passe avant un corps", () => {
    mkDoc("Autre", "pointeur ".repeat(3));
    const t = mkDoc("Pointeur", "x");
    expect(search(db, { q: "pointeur" })[0].refId).toBe(t.id);
  });

  it("met à jour l'index (upsert) au reclassement, sans doublon", () => {
    const d = mkDoc("Tableaux", "t");
    expect(search(db, { q: "tableaux", subjectId: subjA })).toEqual([]);
    db.update(documents).set({ subjectId: subjA }).run();
    const doc = db.select().from(documents).get()!;
    indexDocument(db, doc);
    indexDocument(db, doc);
    expect(search(db, { q: "tableaux", subjectId: subjA }).map((x) => x.refId)).toEqual([d.id]);
    expect(search(db, { q: "tableaux" })).toHaveLength(1);
  });

  it("indexe les fils (note) avec lien vers la cible et ancre", () => {
    const d = mkDoc("Cours", "x");
    const t = createThread(db, { targetType: "document", targetId: d.id, authorId: userId, title: "Piège du déréférencement", body: "attention au NULL", kind: "note" });
    const r = search(db, { q: "dereferencement" });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ refId: t.id, kind: "note", entity: "thread", href: `/doc/${d.id}#thread-${t.id}` });
    expect(search(db, { q: "NULL", kind: "note" })).toHaveLength(1);
    deleteThread(db, t.id, { id: userId, role: "admin" }, tmp);
    expect(search(db, { q: "dereferencement" })).toEqual([]);
  });

  it("un exercice pointe vers /training/[id]", () => {
    const d = mkDoc("Série", "x");
    const e = mkEx(d.id, "Boucles", "écrire une boucle");
    expect(search(db, { q: "boucle", kind: "exercise" })[0].href).toBe(`/training/${e.id}`);
  });

  it("supprimer un document retire document, exercices et fils de l'index", () => {
    const d = mkDoc("Cours liste chaînée", "liste");
    const e = mkEx(d.id, "Exo liste", "liste chaînée");
    createThread(db, { targetType: "exercise", targetId: e.id, authorId: userId, title: "Question liste", body: "liste ?", kind: "question" });
    expect(search(db, { q: "liste" })).toHaveLength(3);
    deleteDocument(db, d.id, { id: userId, role: "admin" }, tmp);
    expect(search(db, { q: "liste" })).toEqual([]);
  });

  it("plafonne le corps indexé (200 000 caractères)", () => {
    mkDoc("Gros", "a ".repeat(50_000) + "x".repeat(150_000) + " tailqueue");
    expect(search(db, { q: "tailqueue" })).toEqual([]);
    expect(search(db, { q: "gros" })).toHaveLength(1);
  });
});

describe("reindexAll", () => {
  it("reconstruit l'index depuis la base et renvoie les comptes", () => {
    const d = mkDoc("Cours pile", "pile");
    mkEx(d.id, "Exo pile", "pile");
    createThread(db, { targetType: "document", targetId: d.id, authorId: userId, title: "Note pile", body: "pile", kind: "note" });
    db.$client.exec("DELETE FROM search_index");
    expect(reindexAll(db)).toEqual({ documents: 1, exercises: 1, threads: 1 });
    expect(search(db, { q: "pile" })).toHaveLength(3);
    reindexAll(db); // idempotent
    expect(search(db, { q: "pile" })).toHaveLength(3);
  });

  it("search() reconstruit l'index vide s'il y a des documents", () => {
    mkDoc("Cours pile", "pile");
    db.$client.exec("DELETE FROM search_index");
    expect(search(db, { q: "pile" })).toHaveLength(1);
  });
});

describe("parseSearchQuery et route", () => {
  it("valide les paramètres (zod)", () => {
    expect(parseSearchQuery({ q: " a " })?.params.q).toBe("a");
    expect(parseSearchQuery({ q: "a", kind: "nope" })).toBeNull();
    expect(parseSearchQuery({ q: "a", from: "pas-une-date" })).toBeNull();
    expect(parseSearchQuery({ q: "a", from: "2026-02-31x" })).toBeNull();
    expect(parseSearchQuery({ q: "a", kind: "", subject: "" })?.params.kind).toBeUndefined();
    expect(parseSearchQuery({ q: "x".repeat(201) })).toBeNull();
    const p = parseSearchQuery({ q: "a", to: "2026-03-01" })!.params;
    expect(p.to!.toISOString()).toBe("2026-03-01T23:59:59.999Z");
  });

  it("la route /api/search valide elle-même la session", () => {
    const src = fs.readFileSync(path.resolve(import.meta.dirname, "../src/app/api/search/route.ts"), "utf8");
    expect(src).toMatch(/await getCurrentUser[(]/);
    expect(src).toMatch(/status: 401/);
    expect(src).toMatch(/parseSearchQuery/);
  });
});

describe("fraîcheur de l'index", () => {
  it("l'appariement d'un corrigé à l'import réindexe les solutions des exercices", async () => {
    const root = fs.mkdtempSync(path.join(tmp, "idx-"));
    const put = (rel: string, c: string) => fs.writeFileSync(path.join(root, rel), c);
    put("TD1.txt", "Exercice 1 : Somme\nCalculer la somme.\nExercice 2 : Produit\nCalculer le produit.");
    put("TD1 (corrigé).txt", "Exercice 1 : Somme\nutiliser accumulateurzeta ici.\nExercice 2 : Produit\nautre chose.");
    const st = fs.mkdtempSync(path.join(tmp, "idx-st-"));
    await importTree(db, { root, source: "local", storage: st, mode: "classify" });
    expect(db.select().from(exercises).all().some((e) => e.solution?.includes("accumulateurzeta"))).toBe(true);
    expect(search(db, { q: "accumulateurzeta" }).map((h) => h.entity)).toContain("exercise");
  });

  it("setDocumentSubject réindexe le document, ses exercices et les fils qui les visent", () => {
    const d = mkDoc("Cours tableaux", "tableaux", { subjectId: subjA });
    const e = mkEx(d.id, "Exo tableaux", "tableaux", subjA);
    createThread(db, { targetType: "document", targetId: d.id, authorId: userId, title: "Question tableaux", body: "tableaux ?", kind: "question" });
    createThread(db, { targetType: "exercise", targetId: e.id, authorId: userId, title: "Note exo tableaux", body: "tableaux", kind: "note" });
    expect(search(db, { q: "tableaux", subjectId: subjA })).toHaveLength(4);
    setDocumentSubject(db, d.id, subjB);
    expect(search(db, { q: "tableaux", subjectId: subjA })).toEqual([]);
    expect(search(db, { q: "tableaux", subjectId: subjB })).toHaveLength(4);
    expect(db.select().from(exercises).where(eq(exercises.id, e.id)).get()!.subjectId).toBe(subjB);
  });
});
