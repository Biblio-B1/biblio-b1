import { describe, expect, it } from "vitest";
import { examEvents, validateExam, type ExamRow } from "@/lib/api/exams";
import { allDayEventsForDay, isExamEvent, timedEventsForDay } from "@/lib/calendar-view";

const base = { kind: "controle", subjectId: "s1", title: " DS  1 ", date: "2026-12-02", startTime: "", endTime: "", location: "", details: "" };

describe("validateExam", () => {
  it("accepte un contrôle sans heure et nettoie l'intitulé", () => {
    const v = validateExam(base, ["s1"]);
    expect(v).toEqual({
      ok: true,
      value: { kind: "controle", subjectId: "s1", title: "DS 1", date: "2026-12-02", startTime: null, endTime: null, location: null, details: null },
    });
  });
  it("refuse matière inconnue, date invalide, heures incohérentes", () => {
    expect(validateExam({ ...base, subjectId: "x" }, ["s1"]).ok).toBe(false);
    expect(validateExam({ ...base, date: "02/12/2026" }, ["s1"]).ok).toBe(false);
    expect(validateExam({ ...base, kind: "autre" }, ["s1"]).ok).toBe(false);
    expect(validateExam({ ...base, endTime: "10:00" }, ["s1"]).ok).toBe(false);
    expect(validateExam({ ...base, startTime: "10:00", endTime: "09:00" }, ["s1"]).ok).toBe(false);
    expect(validateExam({ ...base, kind: "projet", startTime: "08:30", endTime: "10:00" }, ["s1"]).ok).toBe(true);
  });
});

const exam = (o: Partial<ExamRow>): ExamRow => ({
  id: "e1",
  kind: "controle",
  subjectId: "s1",
  subjectName: "Maths",
  subjectColor: "#000",
  title: "",
  date: "2026-12-02",
  startTime: null,
  endTime: null,
  location: null,
  details: null,
  source: "manual",
  edtUid: null,
  authorId: null,
  authorName: "Lea",
  ...o,
});

describe("examEvents", () => {
  it("avec horaire : séance à l'heure de Paris ; sans horaire : journée entière ; edt ignoré", () => {
    const evs = examEvents([
      exam({ id: "a", startTime: "09:00", endTime: "11:00" }),
      exam({ id: "b", kind: "projet", date: "2026-12-04" }),
      exam({ id: "c", source: "edt", edtUid: "u" }),
    ]);
    expect(evs.map((e) => e.uid)).toEqual(["exam:a", "exam:b"]);
    expect(evs[0]).toMatchObject({ start: "2026-12-02T08:00:00.000Z", end: "2026-12-02T10:00:00.000Z", allDay: false, title: "Contrôle · Maths" });
    expect(timedEventsForDay(evs, "2026-12-02")).toHaveLength(1);
    expect(allDayEventsForDay(evs, "2026-12-04").map((e) => e.title)).toEqual(["Projet final · Maths"]);
    expect(allDayEventsForDay(evs, "2026-12-05")).toEqual([]);
    expect(evs.every(isExamEvent)).toBe(true);
    expect(isExamEvent({ uid: "x", description: "Matière : C\nType : EVALUATION" })).toBe(true);
    expect(isExamEvent({ uid: "x", description: "Type : CRS" })).toBe(false);
  });
});
