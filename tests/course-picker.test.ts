import { describe, expect, it } from "vitest";
import { parisWallTimeToIso, upcomingCourses, type ScheduleEvent } from "@/lib/calendar-view";

const subjects = [
  { id: "web", name: "Développement web", slug: "dev-web", color: "#2563eb" },
  { id: "c", name: "Algorithmique et programmation C", slug: "algo-c", color: "#16a34a" },
];

const ev = (uid: string, matiere: string, day: string, from: string, to: string, over: Partial<ScheduleEvent> = {}): ScheduleEvent => ({
  uid,
  title: `${matiere} - Cours`,
  start: parisWallTimeToIso(day, from),
  end: parisWallTimeToIso(day, to),
  allDay: false,
  description: `Matière : ${matiere}\nType : CRS`,
  ...over,
});

describe("upcomingCourses", () => {
  const events = [
    ev("late", "Algorithmique et programmation C", "2026-11-25", "13:30", "16:30"),
    ev("early", "Développement web", "2026-11-25", "09:00", "12:00"),
    ev("past", "Développement web", "2026-11-20", "09:00", "12:00"),
    ev("far", "Développement web", "2026-12-09", "09:00", "12:00"),
    ev("cancel", "Développement web", "2026-11-26", "09:00", "12:00", { status: "cancelled" }),
    ev("exam:1", "Développement web", "2026-11-27", "09:00", "10:00"),
    ev("ferie", "Férié", "2026-11-28", "00:00", "00:00", { allDay: true }),
  ];

  it("groupe par jour, dans l'ordre, sur 14 jours, sans annulés, journées entières ni contrôles du site", () => {
    const days = upcomingCourses(events, subjects, "2026-11-24", 14);
    expect(days.map((d) => d.dayKey)).toEqual(["2026-11-25"]);
    expect(days[0].courses.map((c) => [c.event.uid, c.time, c.subject?.id])).toEqual([
      ["early", "09:00–12:00", "web"],
      ["late", "13:30–16:30", "c"],
    ]);
    expect(upcomingCourses(events, subjects, "2026-11-24", 16).map((d) => d.dayKey)).toEqual(["2026-11-25", "2026-12-09"]);
  });

  it("filtre sur une matière", () => {
    const days = upcomingCourses(events, subjects, "2026-11-24", 14, "c");
    expect(days.flatMap((d) => d.courses.map((c) => c.event.uid))).toEqual(["late"]);
  });
});
