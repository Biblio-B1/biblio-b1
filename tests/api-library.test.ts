import { describe, expect, it, vi } from "vitest";
import { SIGNED_URL_TTL, signedFileUrl, storagePathOf } from "@/lib/api/files";
import { toDocument, toSubject } from "@/lib/api/types";

describe("toDocument", () => {
  it("convertit une ligne Supabase (snake_case, dates ISO) au format des composants", () => {
    const d = toDocument({
      id: "d1",
      title: "Cours",
      type: "course",
      subject_id: "s1",
      subject_confirmed: true,
      file_path: "uploads/imported/a.pdf",
      mime: "application/pdf",
      sha256: "abc",
      source: "github",
      source_path: "x/a.pdf",
      tags: ["c"],
      author_id: null,
      correction_of_id: null,
      created_at: "2026-11-20T10:00:00+00:00",
    });
    expect(d).toMatchObject({ subjectId: "s1", subjectConfirmed: true, filePath: "uploads/imported/a.pdf", text: "" });
    expect(d.createdAt).toBeInstanceOf(Date);
    expect(d.createdAt.toISOString()).toBe("2026-11-20T10:00:00.000Z");
  });

  it("toSubject garde les règles de classement", () => {
    expect(toSubject({ id: "s1", name: "Algo", slug: "algo", color: "#123456", rules: { keywords: { c: 2 } }, created_at: "2026-01-01T00:00:00Z" })).toMatchObject({
      slug: "algo",
      rules: { keywords: { c: 2 } },
    });
  });
});

describe("fichiers privés", () => {
  it("les chemins des documents sont ceux du bucket", () => {
    expect(storagePathOf("uploads/imported/x.pdf")).toBe("uploads/imported/x.pdf");
    expect(storagePathOf("/uploads/a b.pdf")).toBe("uploads/a b.pdf");
  });

  it("URL signée d'une heure, téléchargement nommé", async () => {
    const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: "https://x/signed" }, error: null }));
    const fake = { storage: { from: vi.fn(() => ({ createSignedUrl })) } };
    const url = await signedFileUrl("uploads/a.pdf", { download: "Cours.pdf" }, fake as never);
    expect(url).toBe("https://x/signed");
    expect(fake.storage.from).toHaveBeenCalledWith("files");
    expect(createSignedUrl).toHaveBeenCalledWith("uploads/a.pdf", SIGNED_URL_TTL, { download: "Cours.pdf" });
    expect(SIGNED_URL_TTL).toBe(3600);
  });

  it("erreur Supabase : message clair", async () => {
    const fake = { storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: "Object not found" } }) }) } };
    await expect(signedFileUrl("uploads/x.pdf", {}, fake as never)).rejects.toThrow(/Fichier indisponible/);
  });
});
