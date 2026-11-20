export type ScheduleEvent = {
  uid: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  status?: "confirmed" | "tentative" | "cancelled";
  categories?: string[];
  location?: string;
  description?: string;
  organizer?: string;
  lastModified?: string;
};

export type CalendarDaySegment = {
  event: ScheduleEvent;
  startMinutes: number;
  endMinutes: number;
  lane: number;
  laneCount: number;
};

const TIME_ZONE = "Europe/Paris";

function zonedParts(date: Date): Record<string, number> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, Number(part.value)]),
  );
}

export function dateKeyInParis(date: Date): string {
  const { year, month, day } = zonedParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function todayKeyInParis(): string {
  return dateKeyInParis(new Date());
}

export function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function dateKeyStartInParis(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  const wallTime = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let result = wallTime;
  for (let i = 0; i < 2; i++) {
    const local = Object.fromEntries(
      formatter.formatToParts(new Date(result)).map((part) => [part.type, Number(part.value)]),
    );
    const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    result = wallTime - (represented - result);
  }
  return result;
}

export function mondayOfWeek(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return shiftDateKey(dateKey, -mondayOffset);
}

export function weekDateKeys(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => shiftDateKey(weekStart, index));
}

export function labelDate(dateKey: string, options: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("fr-FR", {
    ...options,
    timeZone: "UTC",
  });
}

function minutesAtParis(date: Date): number {
  const { hour, minute } = zonedParts(date);
  return hour * 60 + minute;
}

export function allDayEventsForDay(events: ScheduleEvent[], dayKey: string): ScheduleEvent[] {
  return events.filter((event) => {
    if (!event.allDay) return false;
    const startKey = dateKeyInParis(new Date(event.start));
    const endKey = dateKeyInParis(new Date(event.end));
    return startKey <= dayKey && endKey > dayKey;
  });
}

export function timedEventsForDay(events: ScheduleEvent[], dayKey: string): CalendarDaySegment[] {
  const dayStart = dateKeyStartInParis(dayKey);
  const nextDayStart = dateKeyStartInParis(shiftDateKey(dayKey, 1));
  const segments = events.flatMap((event) => {
    if (event.allDay) return [];
    const start = new Date(event.start);
    const end = new Date(event.end);
    const startMs = start.getTime();
    const endMs = end.getTime();
    if (startMs >= nextDayStart || endMs <= dayStart) return [];
    const startMinutes = startMs < dayStart ? 0 : minutesAtParis(start);
    const endMinutes = endMs >= nextDayStart ? 24 * 60 : minutesAtParis(end);
    return [{
      event,
      startMinutes,
      endMinutes: Math.max(endMinutes, startMinutes + 30),
      lane: 0,
      laneCount: 1,
    }];
  }).sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);

  let clusterStart = 0;
  while (clusterStart < segments.length) {
    let clusterEnd = segments[clusterStart].endMinutes;
    let clusterLast = clusterStart + 1;
    while (clusterLast < segments.length && segments[clusterLast].startMinutes < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, segments[clusterLast].endMinutes);
      clusterLast++;
    }

    const laneEnds: number[] = [];
    for (let index = clusterStart; index < clusterLast; index++) {
      const segment = segments[index];
      let lane = laneEnds.findIndex((end) => end <= segment.startMinutes);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = segment.endMinutes;
      segment.lane = lane;
    }
    for (let index = clusterStart; index < clusterLast; index++) {
      segments[index].laneCount = laneEnds.length;
    }
    clusterStart = clusterLast;
  }
  return segments;
}

export function visibleHourRange(events: ScheduleEvent[], days: string[]): { start: number; end: number } {
  let firstMinute = Number.POSITIVE_INFINITY;
  let lastMinute = Number.NEGATIVE_INFINITY;
  for (const day of days) {
    for (const segment of timedEventsForDay(events, day)) {
      firstMinute = Math.min(firstMinute, segment.startMinutes);
      lastMinute = Math.max(lastMinute, segment.endMinutes);
    }
  }
  if (!Number.isFinite(firstMinute) || !Number.isFinite(lastMinute)) return { start: 8, end: 18 };
  return {
    start: Math.max(0, Math.floor(firstMinute / 60) - 1),
    end: Math.min(24, Math.max(18, Math.ceil(lastMinute / 60) + 1)),
  };
}

export function timeLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
