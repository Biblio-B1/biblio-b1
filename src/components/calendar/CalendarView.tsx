"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconChevron, IconHomework } from "@/components/layout/Icons";
import {
  allDayEventsForDay,
  cleanEventDescription,
  dateKeyInParis,
  homeworksForEvent,
  labelDate,
  matchEventSubject,
  mondayOfWeek,
  shiftDateKey,
  timeLabel,
  timedEventsForDay,
  todayKeyInParis,
  visibleHourRange,
  weekDateKeys,
  type CalendarDaySegment,
  type CalendarHomework,
  type CalendarSubject,
  type ScheduleEvent,
} from "@/lib/calendar-view";

function eventTime(start: string, end: string): string {
  return `${new Date(start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })} – ${new Date(end).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}`;
}

function weekLabel(days: string[]): string {
  const first = days[0];
  const last = days[6];
  const firstMonth = labelDate(first, { month: "long" });
  const lastMonth = labelDate(last, { month: "long" });
  const firstYear = labelDate(first, { year: "numeric" });
  const lastYear = labelDate(last, { year: "numeric" });
  if (firstMonth === lastMonth && firstYear === lastYear) {
    return `${labelDate(first, { day: "numeric" })} – ${labelDate(last, { day: "numeric", month: "long", year: "numeric" })}`;
  }
  return `${labelDate(first, { day: "numeric", month: "short", year: "numeric" })} – ${labelDate(last, { day: "numeric", month: "short", year: "numeric" })}`;
}

function dayLabel(day: string): string {
  return labelDate(day, { weekday: "short" }).replace(".", "");
}

function eventStatus(event: ScheduleEvent): string {
  if (event.status === "cancelled") return "Annulé";
  if (event.status === "tentative") return "À confirmer";
  return "Confirmé";
}

function homeworkTooltip(hws: CalendarHomework[]): string {
  return hws
    .map((h) => `${h.englishGroup ? `[${h.englishGroup}] ` : ""}${h.title}`)
    .join(" · ");
}

function DayAgenda({
  events,
  day,
  subjects,
  homeworks,
  onSelect,
}: {
  events: ScheduleEvent[];
  day: string;
  subjects: CalendarSubject[];
  homeworks: CalendarHomework[];
  onSelect: (event: ScheduleEvent, dayKey: string) => void;
}) {
  const allDay = allDayEventsForDay(events, day);
  const timed = timedEventsForDay(events, day);
  const rows = [
    ...allDay.map((event) => ({ event, time: "Toute la journée", sort: 0 })),
    ...timed.map((segment) => ({
      event: segment.event,
      time: eventTime(segment.event.start, segment.event.end),
      sort: segment.startMinutes,
    })),
  ].sort((a, b) => a.sort - b.sort);

  if (!rows.length) {
    return <p className="rounded-lg border border-dashed border-line-strong p-5 text-sm text-ink-2">Aucun cours ce jour-là.</p>;
  }
  return (
    <ol className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {rows.map(({ event, time }) => {
        const subject = matchEventSubject(event, subjects);
        const due = homeworksForEvent(event, day, subjects, homeworks);
        return (
          <li
            key={`${event.uid}-${event.start}`}
            style={
              event.status !== "cancelled" && subject
                ? { boxShadow: `inset 4px 0 0 ${subject.color}` }
                : undefined
            }
          >
            <button
              type="button"
              className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-sunken sm:flex-row sm:gap-4"
              onClick={() => onSelect(event, day)}
            >
              {/* Téléphone : horaire au-dessus du titre (toute la largeur pour le titre). */}
              <time dateTime={event.start} className="shrink-0 text-sm tabular-nums text-ink-2 sm:w-32">{time}</time>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 font-medium break-words">
                  {event.title}
                  {due.length > 0 && (
                    <span
                      title={`Devoir à rendre : ${homeworkTooltip(due)}`}
                      className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-sunken px-2 py-0.5 text-[11px] font-medium text-ink"
                    >
                      <IconHomework size={12} />
                      <span>{due.length} devoir{due.length > 1 ? "s" : ""}</span>
                    </span>
                  )}
                  {event.status === "cancelled" && <span className="text-xs text-danger">Annulé</span>}
                  {event.status === "tentative" && <span className="text-xs text-ink-3">À confirmer</span>}
                </span>
                {(subject || event.location || event.categories?.length) && (
                  <span className="mt-1 block truncate text-xs text-ink-2">
                    {[subject?.name ?? event.categories?.join(", "), event.location].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function EventBlock({
  segment,
  day,
  startHour,
  subjects,
  homeworks,
  onSelect,
}: {
  segment: CalendarDaySegment;
  day: string;
  startHour: number;
  subjects: CalendarSubject[];
  homeworks: CalendarHomework[];
  onSelect: (event: ScheduleEvent, dayKey: string) => void;
}) {
  const top = segment.startMinutes - startHour * 60;
  const height = Math.max(24, segment.endMinutes - segment.startMinutes);
  const start = timeLabel(segment.startMinutes);
  const subject = matchEventSubject(segment.event, subjects);
  const due = homeworksForEvent(segment.event, day, subjects, homeworks);
  const cancelled = segment.event.status === "cancelled";

  const colorStyle =
    !cancelled && subject
      ? {
          borderLeftColor: subject.color,
          backgroundColor: `color-mix(in srgb, ${subject.color} 18%, var(--surface))`,
        }
      : undefined;

  return (
    <button
      type="button"
      title={`${start} · ${segment.event.title}${segment.event.location ? ` · ${segment.event.location}` : ""}${due.length ? ` · Devoir : ${homeworkTooltip(due)}` : ""}`}
      aria-label={`${start}, ${segment.event.title}, ${eventStatus(segment.event)}${segment.event.location ? `, ${segment.event.location}` : ""}${due.length ? `, ${due.length} devoir à rendre` : ""}`}
      onClick={() => onSelect(segment.event, day)}
      className={`absolute z-10 overflow-hidden rounded border-l-[3px] px-1.5 py-1 text-left text-[11px] leading-tight transition-opacity hover:opacity-95 ${
        cancelled
          ? "border-danger bg-danger-bg text-danger line-through"
          : subject
            ? "border border-line/60 text-ink"
            : "border-focus bg-focus/10 text-ink"
      }`}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        left: `calc(${(segment.lane * 100) / segment.laneCount}% + 2px)`,
        width: `calc(${100 / segment.laneCount}% - 4px)`,
        ...colorStyle,
      }}
    >
      {due.length > 0 && (
        <span
          aria-label={`${due.length} devoir à rendre`}
          title={`Devoir à rendre : ${homeworkTooltip(due)}`}
          className="absolute top-1 right-1 inline-flex items-center gap-0.5 rounded bg-surface/90 px-1 py-0.5 text-[10px] font-semibold text-ink shadow-xs ring-1 ring-line-strong"
        >
          <IconHomework size={11} />
          {due.length > 1 && <span>{due.length}</span>}
        </span>
      )}
      <span className={`block truncate font-semibold ${due.length > 0 ? "pr-6" : ""}`}>
        {segment.event.title}
      </span>
      <span className="block truncate text-ink-2">
        {start}{segment.event.location ? ` · ${segment.event.location}` : ""}
      </span>
    </button>
  );
}

function CurrentTimeLine({ minute, startHour }: { minute: number; startHour: number }) {
  const top = minute - startHour * 60;
  return (
    <div aria-hidden className="pointer-events-none absolute right-0 left-0 z-20 flex items-center" style={{ top: `${top}px` }}>
      <span className="-ml-1.5 h-2.5 w-2.5 rounded-full bg-danger" />
      <span className="h-px flex-1 bg-danger" />
    </div>
  );
}

export function CalendarView({
  events,
  subjects = [],
  homeworks = [],
}: {
  events: ScheduleEvent[];
  subjects?: CalendarSubject[];
  homeworks?: CalendarHomework[];
}) {
  const router = useRouter();
  const [today, setToday] = useState<string>();
  const [now, setNow] = useState<Date>();
  const [active, setActive] = useState<{ event: ScheduleEvent; dayKey: string }>();
  const [weekStart, setWeekStart] = useState(() => mondayOfWeek(todayKeyInParis()));
  const [selectedDay, setSelectedDay] = useState(() => todayKeyInParis());
  const days = useMemo(() => weekDateKeys(weekStart), [weekStart]);
  const hours = useMemo(() => visibleHourRange(events, days), [events, days]);
  const hasWeekEvents = useMemo(
    () => days.some((day) => allDayEventsForDay(events, day).length > 0 || timedEventsForDay(events, day).length > 0),
    [events, days],
  );
  const todayMinute = now ? (() => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
    return values.hour * 60 + values.minute;
  })() : undefined;

  const lastTodayRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const update = () => {
      const current = new Date();
      const day = dateKeyInParis(current);
      const prevToday = lastTodayRef.current;
      lastTodayRef.current = day;
      setToday(day);
      setNow(current);
      if (prevToday && prevToday !== day) {
        setWeekStart((ws) => (ws === mondayOfWeek(prevToday) ? mondayOfWeek(day) : ws));
        setSelectedDay((sd) => (sd === prevToday ? day : sd));
      }
    };
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [router]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActive(undefined);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  const moveWeek = (delta: number) => {
    const next = shiftDateKey(weekStart, delta * 7);
    setWeekStart(next);
    setSelectedDay(next);
  };
  const goToday = () => {
    const current = today ?? todayKeyInParis();
    setWeekStart(mondayOfWeek(current));
    setSelectedDay(current);
  };
  const openEvent = (event: ScheduleEvent, dayKey: string) => setActive({ event, dayKey });

  return (
    <section className="flex flex-col gap-3" aria-label="Calendrier hebdomadaire">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center">
            <button type="button" className="btn btn-icon rounded-r-none" aria-label="Semaine précédente" onClick={() => moveWeek(-1)}>
              <IconChevron dir="left" />
            </button>
            <button type="button" className="btn btn-icon -ml-px rounded-l-none" aria-label="Semaine suivante" onClick={() => moveWeek(1)}>
              <IconChevron />
            </button>
          </div>
          <button type="button" className="btn" onClick={goToday}>Aujourd’hui</button>
        </div>
        <div className="text-right">
          <h2 aria-live="polite" className="text-sm font-semibold capitalize text-ink">{weekLabel(days)}</h2>
          <p className="text-xs text-ink-3">Actualisation automatique · 1 min</p>
        </div>
      </div>

      {subjects.length > 0 && (
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-2" aria-label="Couleurs des matières">
          {subjects.map((s) => (
            <li key={s.id} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              <span>{s.name}</span>
            </li>
          ))}
        </ul>
      )}

      {!hasWeekEvents && (
        <p className="rounded-md border border-dashed border-line-strong px-3 py-2 text-sm text-ink-2">
          Aucun événement dans cette semaine.
        </p>
      )}

      <div className="grid grid-cols-7 gap-1 md:hidden" aria-label="Choisir un jour">
        {days.map((day) => (
          <button
            type="button"
            key={day}
            aria-pressed={selectedDay === day}
            onClick={() => setSelectedDay(day)}
            className={`flex min-w-0 flex-col items-center rounded-md px-1 py-2 text-xs ${
              selectedDay === day ? "bg-ink text-bg" : "text-ink-2 hover:bg-sunken"
            }`}
          >
            <span className="capitalize">{dayLabel(day)}</span>
            <span className="mt-1 text-base font-semibold tabular-nums">{day.slice(-2)}</span>
          </button>
        ))}
      </div>
      <div className="md:hidden">
        <h3 className="mb-2 text-sm font-semibold capitalize">{labelDate(selectedDay, { weekday: "long", day: "numeric", month: "long" })}</h3>
        <DayAgenda events={events} day={selectedDay} subjects={subjects} homeworks={homeworks} onSelect={openEvent} />
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-line bg-surface md:block">
        <div className="min-w-[900px]">
          <div
            className="grid border-b border-line"
            style={{ gridTemplateColumns: "4.25rem repeat(7, minmax(0, 1fr))" }}
          >
            <div className="border-r border-line" />
            {days.map((day) => (
              <div key={day} className={`border-r border-line px-2 py-2 text-center last:border-r-0 ${day === today ? "bg-sunken" : ""}`}>
                <span className="block text-xs capitalize text-ink-3">{dayLabel(day)}</span>
                <span className={`mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold tabular-nums ${
                  day === today ? "bg-primary text-on-primary" : "text-ink"
                }`}>
                  {Number(day.slice(-2))}
                </span>
              </div>
            ))}
          </div>

          <div
            className="grid border-b border-line"
            style={{ gridTemplateColumns: "4.25rem repeat(7, minmax(0, 1fr))" }}
          >
            <div className="border-r border-line px-1 py-2 text-right text-[10px] text-ink-3">Journée</div>
            {days.map((day) => (
              <div key={day} className="min-h-9 border-r border-line p-1 last:border-r-0">
                {allDayEventsForDay(events, day).map((event) => {
                  const subject = matchEventSubject(event, subjects);
                  const due = homeworksForEvent(event, day, subjects, homeworks);
                  const cancelled = event.status === "cancelled";
                  return (
                    <button
                      type="button"
                      key={`${event.uid}-${event.start}`}
                      title={event.title}
                      onClick={() => openEvent(event, day)}
                      className={`mb-1 flex w-full items-center gap-1 rounded border-l-2 px-1.5 py-1 text-left text-[11px] font-medium ${
                        cancelled
                          ? "border-danger bg-danger-bg text-danger line-through"
                          : subject
                            ? "text-ink"
                            : "border-focus bg-focus/10 text-ink"
                      }`}
                      style={
                        !cancelled && subject
                          ? {
                              borderLeftColor: subject.color,
                              backgroundColor: `color-mix(in srgb, ${subject.color} 18%, var(--surface))`,
                            }
                          : undefined
                      }
                    >
                      <span className="min-w-0 flex-1 truncate">{event.title}</span>
                      {due.length > 0 && <IconHomework size={11} className="shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div
            className="grid"
            style={{
              gridTemplateColumns: "4.25rem repeat(7, minmax(0, 1fr))",
              height: `${(hours.end - hours.start) * 60}px`,
            }}
          >
            <div className="relative border-r border-line">
              {Array.from({ length: hours.end - hours.start }, (_, index) => {
                const hour = hours.start + index;
                return (
                  <span
                    key={hour}
                    className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-ink-3"
                    style={{ top: `${index * 60}px` }}
                  >
                    {String(hour).padStart(2, "0")}:00
                  </span>
                );
              })}
            </div>
            {days.map((day) => {
              const segments = timedEventsForDay(events, day);
              const showNow = day === today && todayMinute !== undefined &&
                todayMinute >= hours.start * 60 && todayMinute <= hours.end * 60;
              return (
                <div
                  key={day}
                  className={`relative border-r border-line last:border-r-0 ${day === today ? "bg-focus/[0.025]" : ""}`}
                  style={{
                    height: `${(hours.end - hours.start) * 60}px`,
                    backgroundImage: "linear-gradient(to bottom, var(--line) 1px, transparent 1px)",
                    backgroundSize: "100% 60px",
                  }}
                >
                  {segments.map((segment) => (
                    <EventBlock
                      key={`${segment.event.uid}-${segment.event.start}`}
                      segment={segment}
                      day={day}
                      startHour={hours.start}
                      subjects={subjects}
                      homeworks={homeworks}
                      onSelect={openEvent}
                    />
                  ))}
                  {showNow && <CurrentTimeLine minute={todayMinute} startHour={hours.start} />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {active && (
        <EventDetails
          event={active.event}
          dayKey={active.dayKey}
          subjects={subjects}
          homeworks={homeworks}
          onClose={() => setActive(undefined)}
        />
      )}
    </section>
  );
}

function EventDetails({
  event,
  dayKey,
  subjects,
  homeworks,
  onClose,
}: {
  event: ScheduleEvent;
  dayKey: string;
  subjects: CalendarSubject[];
  homeworks: CalendarHomework[];
  onClose: () => void;
}) {
  const start = new Date(event.start);
  const date = start.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  });
  const time = event.allDay ? "Toute la journée" : eventTime(event.start, event.end);
  const subject = matchEventSubject(event, subjects);
  const due = homeworksForEvent(event, dayKey, subjects, homeworks);
  const cleanedDescription = event.description ? cleanEventDescription(event.description) : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/50" aria-label="Fermer les détails" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-event-title"
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm capitalize text-ink-2">{date} · {time}</p>
            <h3 id="calendar-event-title" className="mt-1 text-xl font-semibold">{event.title}</h3>
          </div>
          <button type="button" className="btn h-8 shrink-0 px-2 text-xs" onClick={onClose}>Fermer</button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {subject && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-ink"
              style={{
                borderColor: `color-mix(in srgb, ${subject.color} 45%, transparent)`,
                backgroundColor: `color-mix(in srgb, ${subject.color} 15%, var(--surface))`,
              }}
            >
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: subject.color }} />
              {subject.name}
            </span>
          )}
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            event.status === "cancelled" ? "bg-danger-bg text-danger" : "bg-sunken text-ink-2"
          }`}>
            {eventStatus(event)}
          </span>
          {event.lastModified && (
            <span className="rounded-full bg-sunken px-2.5 py-1 text-xs text-ink-2">
              Modifié le {new Date(event.lastModified).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}
            </span>
          )}
        </div>

        {due.length > 0 && (
          <div className="mt-4 flex flex-col gap-2 rounded-lg border border-line-strong bg-sunken p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <IconHomework size={16} />
                Devoir{due.length > 1 ? "s" : ""} à rendre pour ce cours
              </span>
              <Link href="/devoirs" onClick={onClose} className="text-xs font-medium text-ink underline underline-offset-2">
                Voir les devoirs
              </Link>
            </div>
            <ul className="flex flex-col gap-2">
              {due.map((hw) => (
                <li key={hw.id} className="rounded-md border border-line bg-surface p-2.5 text-sm">
                  {hw.englishGroup && (
                    <span className="mb-1 inline-block rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-ink-2">
                      Groupe : {hw.englishGroup}
                    </span>
                  )}
                  <p className="whitespace-pre-wrap text-ink">{hw.title}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        <dl className="mt-5 grid grid-cols-1 gap-x-3 gap-y-0.5 text-sm sm:grid-cols-[7rem_1fr] sm:gap-y-3">
          {event.categories?.length ? (
            <>
              <dt className="mt-2.5 text-ink-3 first:mt-0 sm:mt-0">Matière</dt>
              <dd>{event.categories.join(", ")}</dd>
            </>
          ) : null}
          {event.location && (
            <>
              <dt className="mt-2.5 text-ink-3 first:mt-0 sm:mt-0">Salle</dt>
              <dd>{event.location}</dd>
            </>
          )}
          {event.organizer && (
            <>
              <dt className="mt-2.5 text-ink-3 first:mt-0 sm:mt-0">Intervenant</dt>
              <dd>{event.organizer}</dd>
            </>
          )}
          {cleanedDescription && (
            <>
              <dt className="mt-2.5 text-ink-3 first:mt-0 sm:mt-0">Description</dt>
              <dd className="whitespace-pre-wrap">{cleanedDescription}</dd>
            </>
          )}
        </dl>
      </section>
    </div>
  );
}
