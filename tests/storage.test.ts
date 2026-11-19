import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveUpload } from "@/server/storage";
import { createTestDb } from "@/server/db/client";
import { createDocument, getDocument, listDocuments, setDocumentSubject } from "@/server/documents";
import { listSubjects, seedSubjects } from "@/server/subjects";

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bb1-storage-"));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("saveUpload", () => {
  it("neutralise les ../ et reste sous uploads/", () => {
    const r = saveUpload(Buffer.from("hello"), "../../etc/passwd.pdf", root);
    expect(r.filePath).toMatch(/^uploads\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
    expect(r.filePath).not.toContain("..");
    expect(r.mime).toBe("application/pdf");
    const abs = path.resolve(root, r.filePath);
    expect(abs.startsWith(path.resolve(root, "uploads") + path.sep)).toBe(true);
    expect(fs.readFileSync(abs, "utf8")).toBe("hello");
  });

  it("refuse les extensions non autorisées", () => {
    expect(() => saveUpload(Buffer.from("x"), "virus.exe", root)).toThrow();
    expect(() => saveUpload(Buffer.from("x"), "noext", root)).toThrow();
  });

  it("refuse les fichiers trop gros", () => {
    expect(() => saveUpload(Buffer.alloc(50 * 1024 * 1024 + 1), "a.pdf", root)).toThrow();
  });

  it("sha256 stable pour un même contenu, chemins distincts", () => {
    const a = saveUpload(Buffer.from("same"), "a.txt", root);
    const b = saveUpload(Buffer.from("same"), "b.txt", root);
    expect(a.sha256).toBe(b.sha256);
    expect(a.filePath).not.toBe(b.filePath);
  });
});

describe("documents", () => {
  it("crée, lit, liste et reclasse", () => {
    const db = createTestDb();
    seedSubjects(db);
    const [s1, s2] = listSubjects(db);
    const doc = createDocument(db, {
      title: "Cours 1", type: "course", filePath: "uploads/x.pdf",
      mime: "application/pdf", sha256: "abc", source: "upload", subjectId: s1.id,
    });
    expect(getDocument(db, doc.id)?.title).toBe("Cours 1");
    expect(listDocuments(db, { subjectId: s1.id })).toHaveLength(1);
    expect(listDocuments(db, { subjectId: s2.id })).toHaveLength(0);
    expect(listDocuments(db, { type: "exam" })).toHaveLength(0);
    const upd = setDocumentSubject(db, doc.id, s2.id);
    expect(upd?.subjectId).toBe(s2.id);
    expect(upd?.subjectConfirmed).toBe(true);
    expect(() =>
      createDocument(db, { title: "", type: "course", filePath: "a", mime: "a", sha256: "z", source: "upload" }),
    ).toThrow();
  });
});
