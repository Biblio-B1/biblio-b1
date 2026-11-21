import { describe, expect, it } from "vitest";
import { validateHomework } from "@/lib/homework-rules";

const algo = { id: "s1", name: "Algorithmique et Prog C", slug: "algo" };
const anglais = { id: "s2", name: "Anglais professionnel", slug: "anglais-pro" };

describe("validateHomework", () => {
  it("devoir valide", () => {
    expect(validateHomework({ subjectId: "s1", title: " TD 3 ", dueDate: "2026-11-27", englishGroup: "x" }, [algo])).toEqual({
      ok: true,
      value: { subjectId: "s1", title: "TD 3", dueDate: "2026-11-27", englishGroup: null },
    });
  });

  it("date invalide ou inexistante", () => {
    expect(validateHomework({ subjectId: "s1", title: "TD", dueDate: "27/11/2026" }, [algo])).toMatchObject({ ok: false, error: expect.stringMatching(/Date de rendu/) });
    expect(validateHomework({ subjectId: "s1", title: "TD", dueDate: "2026-02-30" }, [algo]).ok).toBe(false);
  });

  it("matière inconnue, description vide", () => {
    expect(validateHomework({ subjectId: "zz", title: "TD", dueDate: "2026-11-27" }, [algo])).toMatchObject({ ok: false, error: "Matière introuvable." });
    expect(validateHomework({ subjectId: "s1", title: "  ", dueDate: "2026-11-27" }, [algo])).toMatchObject({ ok: false, error: expect.stringMatching(/décrire/) });
  });

  it("anglais : groupe obligatoire", () => {
    expect(validateHomework({ subjectId: "s2", title: "Essay", dueDate: "2026-11-27" }, [anglais])).toMatchObject({ ok: false, error: expect.stringMatching(/groupe d'anglais/) });
    expect(validateHomework({ subjectId: "s2", title: "Essay", dueDate: "2026-11-27", englishGroup: "G2" }, [anglais])).toMatchObject({ ok: true, value: { englishGroup: "G2" } });
  });
});
