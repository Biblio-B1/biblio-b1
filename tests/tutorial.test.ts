import { describe, expect, it } from "vitest";
import { TUTORIAL_STEPS, targetSelector } from "@/lib/tutorial";

describe("tutoriel", () => {
  it("commence par participer (déposer, devoirs, contrôles), puis où trouver les cours, puis le reste", () => {
    expect(TUTORIAL_STEPS.map((s) => s.target ?? null)).toEqual([
      null,
      "/upload",
      "/devoirs",
      "/controles",
      "/library",
      "/training",
      "/timetable",
      "/annuaire",
      "/",
    ]);
    expect(TUTORIAL_STEPS[2].body.join(" ")).toContain("Projet final");
    expect(TUTORIAL_STEPS.at(-1)!.body.join(" ")).toContain("Paramètres");
  });

  it("met en avant le lien du menu, avec ou sans le préfixe du site", () => {
    const sel = targetSelector("/upload");
    expect(sel).toBe('aside a[href$="/upload"], aside a[href$="/upload/"]');
    expect(targetSelector("/")).toContain('aside a[href$="/biblio-b1"]');
    expect(targetSelector("[data-x]")).toBe("[data-x]");
  });
});
