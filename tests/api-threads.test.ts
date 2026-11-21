import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, imageUploadPath, orderThreads, validateImage } from "@/lib/api/threads-core";

const t = (id: string, createdAt: string, isSynthesis = false) => ({ id, createdAt, isSynthesis, authorId: "u", question: id });
const p = (id: string, threadId: string, createdAt: string, pinned = false) => ({ id, threadId, createdAt, pinned, authorId: "u" });

describe("orderThreads", () => {
  it("synthèses, puis fils avec un message épinglé, puis les plus récents ; ouverture puis épinglé dans un fil", () => {
    const items = orderThreads(
      [t("ancien", "2026-01-01"), t("recent", "2026-01-03"), t("synthese", "2026-01-02", true), t("epingle", "2026-01-01T12:00:00Z")],
      [
        p("o1", "epingle", "2026-01-01T12:00:00Z"),
        p("r1", "epingle", "2026-01-01T13:00:00Z"),
        p("r2", "epingle", "2026-01-01T14:00:00Z", true),
        p("o2", "recent", "2026-01-03"),
      ],
      new Map([["u", "Léa"]]),
    );
    expect(items.map((i) => i.thread.id)).toEqual(["synthese", "epingle", "recent", "ancien"]);
    expect(items[1].posts.map((x) => x.id)).toEqual(["o1", "r2", "r1"]);
    expect(items[1].authorName).toBe("Léa");
  });
});

describe("images des messages", () => {
  it("jpg, png ou webp de 10 Mo au plus", () => {
    expect(validateImage({ name: "photo.JPG", size: 1000 })).toBeNull();
    expect(validateImage({ name: "doc.pdf", size: 1000 })).toMatch(/jpg, png ou webp/);
    expect(validateImage({ name: "grosse.png", size: MAX_IMAGE_BYTES + 1 })).toMatch(/10 Mo/);
  });

  it("rangée sous uploads/<id utilisateur>/posts/ (seul dossier autorisé en écriture)", () => {
    expect(imageUploadPath("uid-1", "Mon image.PNG", "abc")).toBe("uploads/uid-1/posts/abc.png");
  });
});
