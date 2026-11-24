import { describe, expect, it } from "vitest";
import { daysBetween, homeworksForHome, relativeDayLabel } from "@/lib/calendar-view";

const hw = (id: string, dueDate: string) => ({ id, dueDate });
const TODAY = "2026-11-24"; // mardi

describe("devoirs de l'accueil", () => {
  it("ceux des 7 prochains jours, triés, aujourd'hui compris", () => {
    const r = homeworksForHome([hw("c", "2026-11-30"), hw("a", "2026-11-24"), hw("old", "2026-11-20"), hw("far", "2026-12-01")], TODAY);
    expect(r).toEqual({ mode: "week", items: [hw("a", "2026-11-24"), hw("c", "2026-11-30")] });
  });

  it("rien dans la semaine : les 3 plus proches, ou moins s'il y en a moins", () => {
    const later = [hw("d", "2026-12-20"), hw("a", "2026-12-02"), hw("c", "2026-12-10"), hw("b", "2026-12-05")];
    expect(homeworksForHome(later, TODAY)).toEqual({ mode: "next", items: [hw("a", "2026-12-02"), hw("b", "2026-12-05"), hw("c", "2026-12-10")] });
    expect(homeworksForHome([hw("x", "2026-12-15")], TODAY).items.map((h) => h.id)).toEqual(["x"]);
    expect(homeworksForHome([hw("old", "2026-11-01")], TODAY)).toEqual({ mode: "next", items: [] });
  });

  it("libellés de jour et écarts", () => {
    expect(relativeDayLabel("2026-11-24", TODAY)).toBe("Aujourd'hui");
    expect(relativeDayLabel("2026-11-25", TODAY)).toBe("Demain");
    expect(relativeDayLabel("2026-12-02", TODAY)).toBe("mercredi 2 décembre");
    expect(daysBetween(TODAY, "2026-12-16")).toBe(22);
  });
});
