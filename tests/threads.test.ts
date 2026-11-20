import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/server/db/client";
import { documents, posts, threads, users } from "@/server/db/schema";
import { createDocument, deleteDocument } from "@/server/documents";
import { saveUpload } from "@/server/storage";
import { addPost, createThread, deletePost, deleteThread, listThreads, markSynthesis, pinPost } from "@/server/threads";

type Actor = { id: string; role: "admin" | "member" };
let db: Db;
let tmp: string;
let author: Actor;
let other: Actor;
let admin: Actor;
let docId: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bb1-threads-"));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function mkUser(name: string, role: "admin" | "member"): Actor {
  const u = db.insert(users).values({ name, email: `${name}@x.io`, passwordHash: "x", role }).returning().get();
  return { id: u.id, role };
}
function mkThread(a: Actor = author, extra: { imagePath?: string } = {}) {
  return createThread(db, { targetType: "document", targetId: docId, authorId: a.id, title: "Pourquoi ?", body: "Corps", kind: "question", ...extra });
}
function img(): string {
  return saveUpload(Buffer.from("png-bytes"), "a.png", tmp).filePath;
}
const exists = (rel: string) => fs.existsSync(path.join(tmp, rel));

beforeEach(() => {
  db = createTestDb();
  author = mkUser("auteur", "member");
  other = mkUser("autre", "member");
  admin = mkUser("chef", "admin");
  docId = createDocument(db, { title: "d", type: "course", filePath: "uploads/x.pdf", mime: "application/pdf", sha256: "s1", source: "upload" }).id;
});

describe("createThread / addPost", () => {
  it("cree le fil avec son message d'ouverture", () => {
    const t = mkThread();
    const [item] = listThreads(db, "document", docId);
    expect(item.thread.id).toBe(t.id);
    expect(item.thread.kind).toBe("question");
    expect(item.posts).toHaveLength(1);
    expect(item.posts[0].body).toBe("Corps");
  });

  it("refuse un corps ou un titre vide", () => {
    expect(() => createThread(db, { targetType: "document", targetId: docId, authorId: author.id, title: "T", body: "  ", kind: "note" })).toThrow();
    expect(() => createThread(db, { targetType: "document", targetId: docId, authorId: author.id, title: " ", body: "x", kind: "note" })).toThrow();
    const t = mkThread();
    expect(() => addPost(db, { threadId: t.id, authorId: other.id, body: "" })).toThrow();
    expect(() => addPost(db, { threadId: t.id, authorId: other.id, body: "   " })).toThrow();
  });

  it("refuse une cible inconnue et un chemin d'image invalide", () => {
    expect(() => createThread(db, { targetType: "document", targetId: "nope", authorId: author.id, title: "T", body: "x", kind: "note" })).toThrow("not_found");
    const t = mkThread();
    expect(() => addPost(db, { threadId: t.id, authorId: other.id, body: "x", imagePath: "../../etc/passwd" })).toThrow();
    expect(() => addPost(db, { threadId: t.id, authorId: other.id, body: "x", imagePath: "uploads/2026/01/a.pdf" })).toThrow();
  });
});

describe("pinPost", () => {
  it("epingler un second post desepingle le premier", () => {
    const t = mkThread();
    const a = addPost(db, { threadId: t.id, authorId: other.id, body: "r1" });
    const b = addPost(db, { threadId: t.id, authorId: other.id, body: "r2" });
    pinPost(db, a.id, author.id);
    pinPost(db, b.id, author.id);
    const rows = db.select().from(posts).where(eq(posts.threadId, t.id)).all();
    expect(rows.filter((p) => p.pinned).map((p) => p.id)).toEqual([b.id]);
  });

  it("un membre non auteur du fil ne peut pas epingler (forbidden) ; admin oui", () => {
    const t = mkThread();
    const a = addPost(db, { threadId: t.id, authorId: other.id, body: "r1" });
    expect(() => pinPost(db, a.id, other.id)).toThrow("forbidden");
    expect(() => pinPost(db, a.id, admin.id)).not.toThrow();
  });
});

describe("markSynthesis / listThreads", () => {
  it("reserve a l'auteur du fil ou a un admin", () => {
    const t = mkThread();
    expect(() => markSynthesis(db, t.id, other.id)).toThrow("forbidden");
    expect(markSynthesis(db, t.id, author.id)).toBe(true);
  });

  it("la synthese remonte en tete, puis les fils avec un post epingle", () => {
    const t1 = mkThread();
    const t2 = mkThread();
    const t3 = mkThread();
    const p = addPost(db, { threadId: t2.id, authorId: other.id, body: "r" });
    pinPost(db, p.id, author.id);
    expect(listThreads(db, "document", docId)[0].thread.id).toBe(t2.id);
    markSynthesis(db, t3.id, admin.id);
    expect(listThreads(db, "document", docId).map((i) => i.thread.id)).toEqual([t3.id, t2.id, t1.id]);
    expect(markSynthesis(db, t3.id, admin.id)).toBe(false); // bascule
  });

  it("dans un fil : ouverture, puis post epingle, puis les autres", () => {
    const t = mkThread();
    const a = addPost(db, { threadId: t.id, authorId: other.id, body: "r1" });
    const b = addPost(db, { threadId: t.id, authorId: other.id, body: "r2" });
    pinPost(db, b.id, author.id);
    const [item] = listThreads(db, "document", docId);
    expect(item.posts.slice(1).map((p) => p.id)).toEqual([b.id, a.id]);
  });
});

describe("suppression", () => {
  it("deletePost : auteur ou admin, pas un tiers", () => {
    const t = mkThread();
    const a = addPost(db, { threadId: t.id, authorId: other.id, body: "r1" });
    expect(() => deletePost(db, a.id, author, tmp)).toThrow("forbidden");
    deletePost(db, a.id, other, tmp);
    const b = addPost(db, { threadId: t.id, authorId: other.id, body: "r2" });
    deletePost(db, b.id, admin, tmp);
    expect(listThreads(db, "document", docId)[0].posts).toHaveLength(1);
    expect(() => deletePost(db, b.id, admin, tmp)).toThrow("not_found");
  });

  it("le message d'ouverture ne se supprime que via le fil", () => {
    mkThread();
    const open = listThreads(db, "document", docId)[0].posts[0];
    expect(() => deletePost(db, open.id, author, tmp)).toThrow("opening_post");
  });

  it("deleteThread : auteur du fil ou admin ; supprime les posts", () => {
    const t = mkThread();
    addPost(db, { threadId: t.id, authorId: other.id, body: "r1" });
    expect(() => deleteThread(db, t.id, other, tmp)).toThrow("forbidden");
    deleteThread(db, t.id, author, tmp);
    expect(db.select().from(threads).all()).toHaveLength(0);
    expect(db.select().from(posts).all()).toHaveLength(0);
    const t2 = mkThread();
    deleteThread(db, t2.id, admin, tmp);
    expect(() => deleteThread(db, t2.id, admin, tmp)).toThrow("not_found");
  });

  it("efface l'image du post supprime, mais pas si une autre ligne la reference", () => {
    const t = mkThread();
    const f1 = img();
    const p1 = addPost(db, { threadId: t.id, authorId: other.id, body: "x", imagePath: f1 });
    deletePost(db, p1.id, other, tmp);
    expect(exists(f1)).toBe(false);

    const f2 = img();
    const p2 = addPost(db, { threadId: t.id, authorId: other.id, body: "x", imagePath: f2 });
    addPost(db, { threadId: t.id, authorId: other.id, body: "y", imagePath: f2 });
    deletePost(db, p2.id, other, tmp);
    expect(exists(f2)).toBe(true);
  });

  it("deleteThread efface les images du fil", () => {
    const f1 = img();
    const f2 = img();
    const t = mkThread(author, { imagePath: f1 });
    addPost(db, { threadId: t.id, authorId: other.id, body: "x", imagePath: f2 });
    deleteThread(db, t.id, author, tmp);
    expect(exists(f1)).toBe(false);
    expect(exists(f2)).toBe(false);
  });

  it("deleteDocument efface les images des fils en cascade", () => {
    const f1 = img();
    const t = mkThread(author, { imagePath: f1 });
    const f2 = img();
    addPost(db, { threadId: t.id, authorId: other.id, body: "x", imagePath: f2 });
    deleteDocument(db, docId, admin, tmp);
    expect(db.select().from(posts).all()).toHaveLength(0);
    expect(exists(f1)).toBe(false);
    expect(exists(f2)).toBe(false);
    expect(db.select().from(documents).all()).toHaveLength(0);
  });
});
