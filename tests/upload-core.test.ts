import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, mimeOf, uploadStoragePath, validateUploadFile } from "@/lib/upload-core";
import { classify } from "@/lib/classify";

describe("dépôt de fichiers (navigateur)", () => {
  it("rangé sous uploads/<id utilisateur>/<sha256>.<ext>", () => {
    expect(uploadStoragePath("uid-1", "abc123", "Cours Pointeurs.PDF")).toBe("uploads/uid-1/abc123.pdf");
    expect(uploadStoragePath("uid-1", "abc123", "sans-extension")).toBe("uploads/uid-1/abc123");
  });

  it("type MIME d'après l'extension", () => {
    expect(mimeOf("a.pdf")).toBe("application/pdf");
    expect(mimeOf("b.md")).toBe("text/markdown");
    expect(mimeOf("c.c")).toBe("text/x-c");
    expect(mimeOf("d.jpeg")).toBe("image/jpeg");
    expect(mimeOf("e.docx")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(mimeOf("f.xyz")).toBe("application/octet-stream");
  });

  it("50 Mo au plus, nom présent", () => {
    expect(MAX_UPLOAD_BYTES).toBe(50 * 1024 * 1024);
    expect(validateUploadFile({ name: "a.pdf", size: MAX_UPLOAD_BYTES })).toBeNull();
    expect(validateUploadFile({ name: "a.pdf", size: MAX_UPLOAD_BYTES + 1 })).toMatch(/50 Mo/);
    expect(validateUploadFile({ name: "", size: 10 })).toMatch(/Nom de fichier/);
  });

  it("le classement partagé propose la matière d'après le nom et le texte", () => {
    const subjects = [
      { id: "s1", name: "Algorithmique et Prog C", slug: "algorithmique-et-prog-c", rules: { pathPatterns: [], keywords: { pointeur: 3, malloc: 3 } } },
      { id: "s2", name: "Anglais", slug: "anglais", rules: { pathPatterns: [], keywords: { grammar: 3 } } },
    ];
    expect(classify({ fileName: "td.pdf", text: "Les pointeurs et malloc en C" }, subjects).subjectId).toBe("s1");
  });
});
