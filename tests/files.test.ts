import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contentDisposition, resolveServedFile } from "@/server/files";

let root: string;
let outside: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bb1-files-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "bb1-outside-"));
  fs.mkdirSync(path.join(root, "uploads", "2026", "11"), { recursive: true });
  fs.writeFileSync(path.join(root, "uploads", "2026", "11", "a.pdf"), "pdf");
  fs.writeFileSync(path.join(root, "data.db"), "secret");
  fs.mkdirSync(path.join(root, "drafts"), { recursive: true });
  fs.writeFileSync(path.join(root, "drafts", "x.pdf"), "draft");
  fs.writeFileSync(path.join(outside, "evil.txt"), "evil");
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe("resolveServedFile", () => {
  it("sert un fichier sous uploads/", () => {
    const abs = resolveServedFile(["uploads", "2026", "11", "a.pdf"], root);
    expect(abs).toBe(fs.realpathSync(path.join(root, "uploads", "2026", "11", "a.pdf")));
  });

  it("refuse la base de données et les brouillons (hors uploads/)", () => {
    expect(resolveServedFile(["data.db"], root)).toBeNull();
    expect(resolveServedFile(["drafts", "x.pdf"], root)).toBeNull();
  });

  it("refuse les segments de traversée et les séparateurs", () => {
    expect(resolveServedFile(["uploads", "..", "data.db"], root)).toBeNull();
    expect(resolveServedFile(["uploads", "2026", "..", "..", "data.db"], root)).toBeNull();
    expect(resolveServedFile(["uploads", "..\\data.db"], root)).toBeNull();
    expect(resolveServedFile(["uploads", "a/../../data.db"], root)).toBeNull();
    expect(resolveServedFile(["uploads", "a\0.pdf"], root)).toBeNull();
    expect(resolveServedFile(["uploads", ""], root)).toBeNull();
    expect(resolveServedFile([], root)).toBeNull();
  });

  it("refuse un chemin absolu", () => {
    expect(resolveServedFile([path.join(outside, "evil.txt")], root)).toBeNull();
  });

  it("refuse un dossier ou un fichier absent", () => {
    expect(resolveServedFile(["uploads", "2026"], root)).toBeNull();
    expect(resolveServedFile(["uploads", "2026", "11", "nope.pdf"], root)).toBeNull();
  });

  it("refuse un lien symbolique sortant du stockage", () => {
    const link = path.join(root, "uploads", "link.txt");
    try {
      fs.symlinkSync(path.join(outside, "evil.txt"), link);
    } catch {
      return; // symlinks non autorisés (Windows sans mode développeur)
    }
    expect(resolveServedFile(["uploads", "link.txt"], root)).toBeNull();
  });
});

describe("contentDisposition", () => {
  it("encode le nom de fichier sans casser l'en-tête", () => {
    const h = contentDisposition("attachment", 'Cours "C" é.pdf');
    expect(h).toContain("attachment");
    expect(h).not.toContain('"C"');
    expect(h).toContain("filename*=UTF-8''Cours%20%22C%22%20%C3%A9.pdf");
  });
});
