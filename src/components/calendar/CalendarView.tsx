"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { IconChevron } from "@/components/layout/Icons";
import {
  allDayEventsForDay,
  dateKeyInParis,
  labelDate,
  mondayOfWeek,
  shiftDateKey,
  timeLabel,
  timedEventsForDay,
  todayKeyInParis,
  visibleHourRange,
  weekDateKeys,
  type CalendarDaySegment,
  type ScheduleEvent,
} from "@/lib/calendar-view";

function eventTime(start: string, end: string): string {
  return `${new Date(start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })} – ${new Date(end).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}`;
}

function statusLabel(status: ScheduleEvent["status"]): string | undefined {
  if (status === "cancelled") return "Annulé";
  if (status === "tentative") return "À confirmer";
  return undefined;
}

function EventDetails({ event, onClose }: { event: ScheduleEvent; onClose: () => void }) {
  const date = new Date(event.start).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="calendar-event-title" className="w-full max-w-lg rounded-xl border border-line bg-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            {statusLabel(event.status) && (
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-danger">{statusLabel(event.status)}</p>
            )}
            <h2 id="calendar-event-title" className={`text-lg font-semibold ${event.status === "cancelled" ? "line-through" : ""}`}>
              {event.title}
            </h2>
          </div>
          <button type="button" className="btn h-8 shrink-0" onClick={onClose}>Fermer</button>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-[7rem_1fr]">
          <dt className="text-ink-3">Horaire</dt>
          <dd>{date}{event.allDay ? " · Toute la journée" : ` · ${eventTime(event.start, event.end)}`}</dd>
          {event.categories?.length ? (
            <>
              <dt className="text-ink-3">Matière</dt>
              <dd>{event.categories.join(", ")}</dd>
            </>
          ) : null}
          {event.location && (
            <>
              <dt className="text-ink-3">Salle</dt>
              <dd>{event.location}</dd>
            </>
          )}
          {event.organizer && (
            <>
              <dt className="text-ink-3">Intervenant / organisateur</dt>
              <dd>{event.organizer}</dd>
            </>
          )}
          {event.lastModified && (
            <>
              <dt className="text-ink-3">Dernière modification</dt>
              <dd>{new Date(event.lastModified).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</dd>
            </>
          )}
          {event.description && (
            <>
              <dt className="text-ink-3">Description</dt>
              <dd className="whitespace-pre-wrap">{event.description}</dd>
            </>
          )}
        </dl>
      </section>
    </div>
  );
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

function headingDayLabel(day: string): string {
  return labelDate(day, { day: "numeric", month: "short" });
}

function DayAgenda({
  events,
  day,
  onSelect,
}: {
  events: ScheduleEvent[];
  day: string;
  onSelect: (event: ScheduleEvent) => void;
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
      {rows.map(({ event, time }) => (
        <li key={`${event.uid}-${event.start}`}>
          <button
            type="button"
            className="flex w-full gap-4 px-4 py-3 text-left hover:bg-sunken"
            onClick={() => onSelect(event)}
            aria-label={`${event.title}, ${time}${event.location ? `, salle ${event.location}` : ""}`}
          >
            <time dateTime={event.start} className="w-32 shrink-0 text-sm tabular-nums text-ink-2">{time}</time>
            <span className="flex min-w-0 flex-col gap-1">
              <span className={`font-medium ${event.status === "cancelled" ? "line-through text-danger" : ""}`}>{event.title}</span>
              <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3">
                {event.categories?.map((category) => <span key={category}>{category}</span>)}
                {event.location && <span>{event.location}</span>}
                {statusLabel(event.status) && <span className="font-semibold text-danger">{statusLabel(event.status)}</span>}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function EventBlock({
  segment,
  startHour,
  onSelect,
}: {
  segment: CalendarDaySegment;
  startHour: number;
  onSelect: (event: ScheduleEvent) => void;
}) {
  const top = segment.startMinutes - startHour * 60;
  const height = Math.max(24, segment.endMinutes - segment.startMinutes);
  const start = timeLabel(segment.startMinutes);
  return (
    <button
      type="button"
      title={`${start} · ${segment.event.title}${segment.event.location ? ` · ${segment.event.location}` : ""}`}
      aria-label={`${segment.event.title}, ${start}${segment.event.location ? `, salle ${segment.event.location}` : ""}${statusLabel(segment.event.status) ? `, ${statusLabel(segment.event.status)}` : ""}`}
      onClick={() => onSelect(segment.event)}
      className={`absolute z-10 overflow-hidden rounded border-l-2 px-1.5 py-1 text-left text-[11px] leading-tight ${
        segment.event.status === "cancelled"
          ? "border-danger bg-danger-bg text-danger line-through"
          : segment.event.status === "tentative"
            ? "border-line-strong bg-sunken text-ink"
            : "border-focus bg-focus/10 text-ink"
      }`}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        left: `calc(${(segment.lane * 100) / segment.laneCount}% + 2px)`,
        width: `calc(${100 / segment.laneCount}% - 4px)`,
      }}
    >
      <span className="block truncate font-semibold">{segment.event.title}</span>
      <span className="block truncate">{start}{segment.event.location ? ` · ${segment.event.location}` : ""}</span>
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

export function CalendarView({ events }: { events: ScheduleEvent[] }) {
  const router = useRouter();
  const [today, setToday] = useState(() => todayKeyInParis());
  const [now, setNow] = useState<Date>();
  const [weekStart, setWeekStart] = useState(() => mondayOfWeek(todayKeyInParis()));
  const [selectedDay, setSelectedDay] = useState(() => todayKeyInParis());
  const [selectedEvent, setSelectedEvent] = useState<ScheduleEvent>();
  const days = useMemo(() => weekDateKeys(weekStart), [weekStart]);
  const hours = useMemo(() => visibleHourRange(events, days), [events, days]);
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

  useEffect(() => {
    const update = () => {
      const current = new Date();
      const day = dateKeyInParis(current);
      setToday(day);
      setNow(current);
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
    if (!selectedEvent) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedEvent(undefined);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedEvent]);

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
        <h2 aria-live="polite" className="text-sm font-semibold capitalize text-ink">
          {weekLabel(days)}
        </h2>
      </div>

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
        <DayAgenda events={events} day={selectedDay} onSelect={setSelectedEvent} />
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
                {allDayEventsForDay(events, day).map((event) => (
                  <button
                    key={`${event.uid}-${event.start}`}
                    type="button"
                    onClick={() => setSelectedEvent(event)}
                    className={`block w-full truncate rounded px-1.5 py-1 text-left text-[11px] font-medium ${
                      event.status === "cancelled" ? "bg-danger-bg text-danger line-through" : "bg-focus/10 text-ink"
                    }`}
                  >
                    {event.title}
                  </button>
                ))}
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
                    <EventBlock key={`${segment.event.uid}-${segment.event.start}`} segment={segment} startHour={hours.start} onSelect={setSelectedEvent} />
                  ))}
                  {showNow && <CurrentTimeLine minute={todayMinute} startHour={hours.start} />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {selectedEvent && <EventDetails event={selectedEvent} onClose={() => setSelectedEvent(undefined)} />}
    </section>
  );
}
