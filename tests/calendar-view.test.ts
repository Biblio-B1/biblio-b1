import { describe, expect, it } from "vitest";
import {
  allDayEventsForDay,
  dateKeyInParis,
  homeworksForEvent,
  homeworksForNextWeek,
  matchEventSubject,
  mondayOfWeek,
  shiftDateKey,
  timedEventsForDay,
  visibleHourRange,
  weekDateKeys,
  type CalendarHomework,
  type ScheduleEvent,
} from "@/lib/calendar-view";
import { createTestDb } from "@/server/db/client";
import { listSubjects, seedSubjects } from "@/server/subjects";

const event = (uid: string, start: string, end: string): ScheduleEvent => ({
  uid,
  title: uid,
  start,
  end,
  allDay: false,
});

describe("calendar view helpers", () => {
  it("builds Monday-based weeks and shifts dates across month boundaries", () => {
    expect(mondayOfWeek("2026-11-22")).toBe("2026-11-16");
    expect(weekDateKeys("2026-11-30")).toEqual([
      "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03",
      "2026-12-04", "2026-12-05", "2026-12-06",
    ]);
    expect(shiftDateKey("2026-12-01", -1)).toBe("2026-11-30");
  });

  it("groups events by the Paris calendar date", () => {
    expect(dateKeyInParis(new Date("2026-11-22T23:30:00.000Z"))).toBe("2026-11-23");
  });

  it("places overlapping events in separate lanes and includes overnight segments", () => {
    const events = [
      event("one", "2026-11-23T08:00:00.000Z", "2026-11-23T09:00:00.000Z"),
      event("two", "2026-11-23T08:30:00.000Z", "2026-11-23T09:30:00.000Z"),
      event("overnight", "2026-11-23T22:30:00.000Z", "2026-11-24T00:30:00.000Z"),
    ];

    const monday = timedEventsForDay(events, "2026-11-23");
    expect(monday).toHaveLength(3);
    expect(monday[0].laneCount).toBe(2);
    expect(monday[1].laneCount).toBe(2);
    expect(monday[2]).toMatchObject({ startMinutes: 23 * 60 + 30, endMinutes: 24 * 60 });
    expect(timedEventsForDay(events, "2026-11-24")).toMatchObject([
      { startMinutes: 0, endMinutes: 90 },
    ]);
  });

  it("shows all-day events on their exclusive-end date range and expands hours", () => {
    const allDay: ScheduleEvent = {
      uid: "holiday",
      title: "Révision",
      start: "2026-11-23T00:00:00.000Z",
      end: "2026-11-24T00:00:00.000Z",
      allDay: true,
    };
    const late = event("late", "2026-11-23T21:00:00.000Z", "2026-11-23T22:00:00.000Z");
    expect(allDayEventsForDay([allDay], "2026-11-23")).toEqual([allDay]);
    expect(allDayEventsForDay([allDay], "2026-11-24")).toEqual([]);
    expect(visibleHourRange([late], ["2026-11-23"])).toEqual({ start: 8, end: 24 });
  });

  it("matches Boostcamp event titles to subjects and attaches due homeworks", () => {
    const db = createTestDb();
    seedSubjects(db);
    const subjects = listSubjects(db);

    const cases: [string, string][] = [
      ["Algorithmique et programmation C - M. VANDAMME SIMON - CRS", "algorithmique-et-prog-c"],
      ["Soutien Programmation C - M. VANDAMME SIMON - CRS-CV", "algorithmique-et-prog-c"],
      ["fermé - Anglais professionnel & technique intermédiaire - Mme LISOWSKI", "anglais-professionnel-technique-avance"],
      ["Communication & posture professionnelle - Mme COUDERT CAROLE", "comm-posture-professionnelle"],
      ["Développement web Front -End - M. TAALBI RABAH - CRS", "developpement-web-front-end"],
      ["fermé - Infrastructures et Systèmes pour la Data - KONATE DOTEMIN - CRS", "infra-data"],
      ["Linux & environnement de développement IA - M. ABDELLAOUI LÉO", "linux-environnement-ia"],
      ["Mathématiques pour l'informatique - M. KADI", "mathematiques-pour-info"],
      ["Soutien mathématiques - M. KADI", "mathematiques-pour-info"],
      ["TECHAWAY-DATAANALYSIS-N1 - BOUVERET GRIMAUD - CRS-TD-CV", "techaway-dataanalysis"],
    ];
    for (const [title, expectedSlug] of cases) {
      const matched = matchEventSubject({ title }, subjects);
      expect(matched?.slug, title).toBe(expectedSlug);
    }

    expect(matchEventSubject({ title: "Férié" }, subjects)).toBeUndefined();

    const dataSub = subjects.find((s) => s.slug === "infra-data")!;
    const hws: CalendarHomework[] = [
      { id: "h1", subjectId: dataSub.id, subjectName: dataSub.name, title: "Requête SQL", dueDate: "2026-11-24" },
      { id: "h2", subjectId: dataSub.id, subjectName: dataSub.name, title: "Autre jour", dueDate: "2026-11-25" },
    ];
    const dataEvent = event("data-1", "2026-11-24T08:00:00.000Z", "2026-11-24T10:00:00.000Z");
    dataEvent.title = "Infrastructures et Systèmes pour la Data - KONATE DOTEMIN - CRS";
    expect(homeworksForEvent(dataEvent, "2026-11-24", subjects, hws).map((h) => h.id)).toEqual(["h1"]);

    expect(homeworksForNextWeek(hws, "2026-11-20").map((h) => h.id)).toEqual(["h1", "h2"]);
    expect(homeworksForNextWeek([{ dueDate: "2026-11-22" }, { dueDate: "2026-11-30" }], "2026-11-20")).toEqual([]);
  });
});
