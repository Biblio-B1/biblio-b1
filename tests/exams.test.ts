import { describe, expect, it } from "vitest";
import { pickedFiles, toAttachments, validateFiles } from "@/lib/api/attachments";
import { examEvents, validateExam, type ExamRow } from "@/lib/api/exams";
import { allDayEventsForDay, isExamEvent, timedEventsForDay } from "@/lib/calendar-view";

const base = { subjectId: "s1", title: " DS  1 ", date: "2026-12-02", startTime: "", endTime: "", location: "", details: "" };
const SUBJECTS = [
  { id: "s1", name: "Maths", slug: "maths" },
  { id: "en", name: "Anglais professionnel & technique avancé", slug: "anglais" },
];

describe("validateExam", () => {
  it("accepte un contrôle sans heure et nettoie l'intitulé", () => {
    const v = validateExam(base, SUBJECTS);
    expect(v).toEqual({
      ok: true,
      value: { subjectId: "s1", englishGroup: null, title: "DS 1", date: "2026-12-02", startTime: null, endTime: null, location: null, details: null },
    });
  });
  it("anglais : le groupe est obligatoire ; ignoré pour les autres matières", () => {
    expect(validateExam({ ...base, subjectId: "en" }, SUBJECTS)).toEqual({ ok: false, error: "Précisez quel groupe d'anglais passe ce contrôle." });
    const v = validateExam({ ...base, subjectId: "en", englishGroup: "  Anglais   avancé Gr2 " }, SUBJECTS);
    expect(v.ok && v.value.englishGroup).toBe("Anglais avancé Gr2");
    const m = validateExam({ ...base, englishGroup: "Gr1" }, SUBJECTS);
    expect(m.ok && m.value.englishGroup).toBeNull();
    expect(validateExam({ ...base, subjectId: "en", englishGroup: "x".repeat(121) }, SUBJECTS).ok).toBe(false);
  });
  it("refuse matière inconnue, date invalide, heures incohérentes", () => {
    expect(validateExam({ ...base, subjectId: "x" }, SUBJECTS).ok).toBe(false);
    expect(validateExam({ ...base, date: "02/12/2026" }, SUBJECTS).ok).toBe(false);
    expect(validateExam({ ...base, endTime: "10:00" }, SUBJECTS).ok).toBe(false);
    expect(validateExam({ ...base, startTime: "10:00", endTime: "09:00" }, SUBJECTS).ok).toBe(false);
    expect(validateExam({ ...base, startTime: "08:30", endTime: "10:00" }, SUBJECTS).ok).toBe(true);
  });
});

const exam = (o: Partial<ExamRow>): ExamRow => ({
  id: "e1",
  subjectId: "s1",
  subjectName: "Maths",
  subjectColor: "#000",
  title: "",
  date: "2026-12-02",
  startTime: null,
  endTime: null,
  location: null,
  details: null,
  englishGroup: null,
  source: "manual",
  edtUid: null,
  authorId: null,
  authorName: "Lea",
  attachments: [],
  ...o,
});

describe("examEvents", () => {
  it("avec horaire : séance à l'heure de Paris ; sans horaire : journée entière ; edt ignoré", () => {
    const evs = examEvents([
      exam({ id: "a", startTime: "09:00", endTime: "11:00" }),
      exam({ id: "b", date: "2026-12-04" }),
      exam({ id: "c", source: "edt", edtUid: "u" }),
    ]);
    expect(evs.map((e) => e.uid)).toEqual(["exam:a", "exam:b"]);
    expect(evs[0]).toMatchObject({ start: "2026-12-02T08:00:00.000Z", end: "2026-12-02T10:00:00.000Z", allDay: false, title: "Contrôle · Maths" });
    expect(timedEventsForDay(evs, "2026-12-02")).toHaveLength(1);
    expect(allDayEventsForDay(evs, "2026-12-04").map((e) => e.title)).toEqual(["Contrôle · Maths"]);
    expect(allDayEventsForDay(evs, "2026-12-05")).toEqual([]);
    expect(evs.every(isExamEvent)).toBe(true);
    expect(isExamEvent({ uid: "x", description: "Matière : C\nType : EVALUATION" })).toBe(true);
    expect(isExamEvent({ uid: "x", description: "Type : CRS" })).toBe(false);
  });
});

describe("pièces jointes (contrôles et devoirs)", () => {
  it("garde les fichiers choisis, au plus 10, 30 Mo chacun", () => {
    const f = (name: string, size: number) => new File([new Uint8Array(size)], name);
    expect(pickedFiles(["texte", f("", 0), f("vide.pdf", 0), f("sujet.pdf", 3)]).map((x) => x.name)).toEqual(["sujet.pdf"]);
    expect(validateFiles([{ name: "a.pdf", size: 10 }])).toBeNull();
    expect(validateFiles([{ name: "gros.pdf", size: 31 * 1024 * 1024 }])).toContain("« gros.pdf » dépasse la limite de 30 Mo");
    expect(validateFiles(Array.from({ length: 11 }, () => ({ name: "a", size: 1 })))).toContain("10 pièces jointes maximum");
    expect(validateFiles([{ name: "a", size: 1 }], 10)).toContain("10 pièces jointes maximum");
  });

  it("trie les pièces jointes par date d'ajout", () => {
    const row = (id: string, created_at: string) => ({ id, path: `uploads/u/${id}.pdf`, name: `${id}.pdf`, size: 1, author_id: "u", created_at });
    expect(toAttachments([row("b", "2026-11-24T10:00:00Z"), row("a", "2026-11-24T09:00:00Z")]).map((a) => a.id)).toEqual(["a", "b"]);
    expect(toAttachments(null)).toEqual([]);
  });
});

describe("contrôle d'anglais sur l'emploi du temps", () => {
  it("le groupe apparaît dans le titre et la description", () => {
    const [e] = examEvents([exam({ id: "g", subjectName: "Anglais", englishGroup: "Gr2", startTime: "09:00", endTime: "10:00" })]);
    expect(e.title).toBe("Contrôle · Anglais (Gr2)");
    expect(e.description).toContain("Groupe : Gr2");
  });
});
