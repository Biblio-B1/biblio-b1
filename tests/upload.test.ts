import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { listSubjects, seedSubjects } from "@/server/subjects";
import { listDocuments } from "@/server/documents";
import { cleanupDrafts, createDraft, readDraft } from "@/server/drafts";
import { confirmDraft, confirmItemSchema, guessType, prepareUpload } from "@/server/uploads";

let root: string;
let db: Db;
let owner: string;
let other: string;

function addUser(name: string) {
  return db
    .insert(users)
    .values({ name, email: `${name}@x.fr`, passwordHash: "h" })
    .returning()
    .get().id;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bb1-upload-"));
  db = createTestDb();
  seedSubjects(db);
  owner = addUser("alice");
  other = addUser("bob");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("drafts", () => {
  it("stocke un brouillon hors de uploads/ sous un nom généré", async () => {
    const d = createDraft(Buffer.from("x"), "../../etc/TP1.pdf", owner, null, root);
    expect(d.tmpId).toMatch(/^[0-9a-f-]{36}$/);
    expect(d.fileName).toBe("TP1.pdf");
    expect(fs.readdirSync(path.join(root, "drafts")).sort()).toEqual(
      [`${d.tmpId}.json`, `${d.tmpId}.pdf`].sort(),
    );
    expect(fs.existsSync(path.join(root, "uploads"))).toBe(false);
  });

  it("refuse extensions interdites, fichier vide, trop gros", async () => {
    expect(() => createDraft(Buffer.from("x"), "a.exe", owner, null, root)).toThrow(/Extension/);
    expect(() => createDraft(Buffer.alloc(0), "a.pdf", owner, null, root)).toThrow(/vide/);
    expect(() => createDraft(Buffer.alloc(50 * 1024 * 1024 + 1), "a.pdf", owner, null, root)).toThrow(/50 Mo/);
  });

  it("un brouillon n'est lisible que par son auteur, avec un identifiant valide", async () => {
    const d = createDraft(Buffer.from("abc"), "a.md", owner, null, root);
    expect(readDraft(d.tmpId, owner, root)?.buf.toString()).toBe("abc");
    expect(readDraft(d.tmpId, other, root)).toBeNull();
    expect(readDraft("../data", owner, root)).toBeNull();
    expect(readDraft("00000000-0000-4000-8000-000000000000", owner, root)).toBeNull();
  });

  it("cleanupDrafts supprime les brouillons anciens seulement", async () => {
    const old = createDraft(Buffer.from("a"), "a.md", owner, null, root);
    const now = Date.now() + 25 * 3600_000;
    const fresh = createDraft(Buffer.from("b"), "b.md", owner, null, root);
    // rajeunit "fresh" artificiellement
    const meta = path.join(root, "drafts", `${fresh.tmpId}.json`);
    const m = JSON.parse(fs.readFileSync(meta, "utf8"));
    fs.writeFileSync(meta, JSON.stringify({ ...m, createdAt: now }));
    cleanupDrafts(root, 24 * 3600_000, now);
    expect(readDraft(old.tmpId, owner, root)).toBeNull();
    expect(readDraft(fresh.tmpId, owner, root)).not.toBeNull();
  });
});

describe("guessType", () => {
  it("devine le type d'après le nom", async () => {
    expect(guessType("IMG_2031.jpg")).toBe("photo");
    expect(guessType("photo.WEBP")).toBe("photo");
    expect(guessType("main.c")).toBe("exercise");
    expect(guessType("TD3 pointeurs.pdf")).toBe("exercise");
    expect(guessType("Partiel 2025.pdf")).toBe("exam");
    expect(guessType("Annale DS1.pdf")).toBe("exam");
    expect(guessType("resume.md")).toBe("note");
    expect(guessType("Chapitre 2.pdf")).toBe("course");
    expect(guessType("slides.pptx")).toBe("course");
  });
});

describe("prepareUpload / confirmDraft", () => {
  it("propose une matière d'après le nom de fichier", async () => {
    const d = await prepareUpload(db, Buffer.from("%PDF"), "ECE - Algo et C - TP6.pdf", owner, root);
    const progC = listSubjects(db).find((s) => s.slug === "prog-c")!;
    expect(d.suggestedSubjectId).toBe(progC.id);
    expect(d.suggestedType).toBe("exercise");
    expect(d.title).toBe("ECE - Algo et C - TP6");
    expect(d.duplicateOfId).toBeNull();
  });

  it("sans indice : aucune matière proposée", async () => {
    const d = await prepareUpload(db, Buffer.from("zz"), "scan.jpg", owner, root);
    expect(d.suggestedSubjectId).toBeNull();
  });

  it("confirme : crée le document, déplace le fichier sous uploads/, supprime le brouillon", async () => {
    const d = await prepareUpload(db, Buffer.from("hello"), "notes linux.md", owner, root);
    const linux = listSubjects(db).find((s) => s.slug === "linux")!;
    const doc = confirmDraft(db, { tmpId: d.tmpId, subjectId: linux.id, title: "Mes notes", type: "note" }, owner, root);
    expect(doc.subjectId).toBe(linux.id);
    expect(doc.subjectConfirmed).toBe(true);
    expect(doc.authorId).toBe(owner);
    expect(doc.source).toBe("upload");
    expect(doc.filePath).toMatch(/^uploads\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.md$/);
    expect(fs.readFileSync(path.join(root, doc.filePath), "utf8")).toBe("hello");
    expect(readDraft(d.tmpId, owner, root)).toBeNull();
  });

  it("extrait le texte à l'upload, l'utilise pour la matière et le stocke à la confirmation", async () => {
    const body = ["#include <stdio.h>", "int main(void) { char *p = malloc(4); free(p); return 0; }", ""].join("\n");
    const d = await prepareUpload(db, Buffer.from(body), "cours.txt", owner, root);
    const progC = listSubjects(db).find((s) => s.slug === "prog-c")!;
    expect(d.suggestedSubjectId).toBe(progC.id);
    const doc = confirmDraft(db, { tmpId: d.tmpId, subjectId: progC.id, title: "C", type: "course" }, owner, root);
    expect(doc.text).toContain("malloc");
  });

  it("refuse le brouillon d'un autre utilisateur et une matière inconnue", async () => {
    const d = await prepareUpload(db, Buffer.from("x1"), "a.md", owner, root);
    expect(() => confirmDraft(db, { tmpId: d.tmpId, subjectId: null, title: "t", type: "note" }, other, root)).toThrow(/introuvable/);
    expect(() => confirmDraft(db, { tmpId: d.tmpId, subjectId: "nope", title: "t", type: "note" }, owner, root)).toThrow(/Matière/);
    expect(listDocuments(db)).toHaveLength(0);
  });

  it("signale un doublon (même sha256) à l'upload et au moment de confirmer", async () => {
    const a = await prepareUpload(db, Buffer.from("same"), "a.md", owner, root);
    const b = await prepareUpload(db, Buffer.from("same"), "b.md", owner, root);
    const doc = confirmDraft(db, { tmpId: a.tmpId, subjectId: null, title: "A", type: "note" }, owner, root);
    expect((await prepareUpload(db, Buffer.from("same"), "c.md", owner, root)).duplicateOfId).toBe(doc.id);
    expect(() => confirmDraft(db, { tmpId: b.tmpId, subjectId: null, title: "B", type: "note" }, owner, root)).toThrow(/déjà/);
    expect(listDocuments(db)).toHaveLength(1);
  });

  it("échec de createDocument : fichier sauvegardé supprimé, brouillon conservé", async () => {
    const d = await prepareUpload(db, Buffer.from("boom"), "a.md", owner, root);
    db.$client.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT, 'boom'); END");
    expect(() => confirmDraft(db, { tmpId: d.tmpId, subjectId: null, title: "t", type: "note" }, owner, root)).toThrow(/boom/);
    const uploads = path.join(root, "uploads");
    const files = fs.existsSync(uploads) ? fs.readdirSync(uploads, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()) : [];
    expect(files).toHaveLength(0);
    expect(readDraft(d.tmpId, owner, root)).not.toBeNull();
  });

  it("confirmItemSchema valide les entrées", async () => {
    const ok = { tmpId: "00000000-0000-4000-8000-000000000000", subjectId: null, title: " T ", type: "course" };
    expect(confirmItemSchema.parse(ok).title).toBe("T");
    expect(confirmItemSchema.safeParse({ ...ok, type: "video" }).success).toBe(false);
    expect(confirmItemSchema.safeParse({ ...ok, title: "" }).success).toBe(false);
    expect(confirmItemSchema.safeParse({ ...ok, tmpId: "../x" }).success).toBe(false);
  });
});
