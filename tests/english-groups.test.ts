import { describe, expect, it } from "vitest";
import { englishGroupKey, inMyEnglishGroup, myEnglishGroups, visibleForMe } from "@/lib/english-groups";
import type { ScheduleEvent } from "@/lib/calendar-view";

const ev = (title: string, description: string): ScheduleEvent => ({
  uid: title,
  title,
  start: "2026-12-01T08:00:00Z",
  end: "2026-12-01T10:00:00Z",
  allDay: false,
  description,
});

const calendar = [
  ev("Anglais professionnel & technique avancé", "Matière : Anglais professionnel & technique avancé\nTD : B1 Anglais avancé Gr2, B1Anglais avancé Gr2\nType : CRS-TD"),
  ev("Algorithmique et programmation C", "Matière : Algorithmique et programmation C\nTD : Bch B1 Intelligence Artificielle Gr1"),
];

describe("groupes d'anglais", () => {
  it("le groupe de l'élève vient des séances d'anglais de son emploi du temps", () => {
    expect(myEnglishGroups(calendar)).toEqual(["anglaisavancegr2"]);
    expect(englishGroupKey("B1 Anglais avancé Groupe 2")).toBe("anglaisavancegr2");
  });

  it("le groupe tapé sur le site correspond même écrit autrement", () => {
    const mine = myEnglishGroups(calendar);
    expect(inMyEnglishGroup("Anglais avancé Gr2", mine)).toBe(true);
    expect(inMyEnglishGroup("anglais  AVANCE gr2", mine)).toBe(true);
    expect(inMyEnglishGroup("Anglais intermédiaire Gr1", mine)).toBe(false);
    expect(inMyEnglishGroup("Anglais débutant", mine)).toBe(false);
  });

  it("seuls les contrôles d'anglais d'un autre groupe sont cachés", () => {
    const items = [
      { id: "maths", englishGroup: null, authorId: "x" },
      { id: "avance", englishGroup: "Anglais avancé Gr2", authorId: "x" },
      { id: "inter", englishGroup: "Anglais intermédiaire Gr1", authorId: "x" },
      { id: "inter-moi", englishGroup: "Anglais intermédiaire Gr1", authorId: "me" },
    ];
    expect(visibleForMe(items, calendar, "me").map((i) => i.id)).toEqual(["maths", "avance", "inter-moi"]);
    // Sans emploi du temps (ou sans cours d'anglais), le groupe est inconnu : tout reste visible.
    expect(visibleForMe(items, null, "me")).toHaveLength(4);
    expect(visibleForMe(items, [calendar[1]], "me")).toHaveLength(4);
  });
});
