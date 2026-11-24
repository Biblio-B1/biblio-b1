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

export type CalendarSubject = {
  id: string;
  name: string;
  slug: string;
  color: string;
  rules?: unknown;
};

export type CalendarHomework = {
  id: string;
  subjectId: string;
  subjectName: string;
  title: string;
  dueDate: string;
  englishGroup?: string | null;
  /** Projet final : signalé à part sur le cours (badge rouge). */
  isFinalProject?: boolean;
  attachmentPath?: string | null;
  attachmentName?: string | null;
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

/** Séance d'évaluation Boostcamp (« Type : EVALUATION ») ou contrôle / projet ajouté sur le site. */
export function isExamEvent(event: Pick<ScheduleEvent, "uid" | "description" | "categories">): boolean {
  return (
    event.uid.startsWith("exam:") ||
    /^type\s*:\s*evaluation\s*$/im.test(event.description ?? "") ||
    (event.categories ?? []).some((c) => c.toUpperCase() === "EVALUATION")
  );
}

/** « 2026-12-01 » + « 14:30 » (heure de Paris) → instant ISO. */
export function parisWallTimeToIso(dateKey: string, time: string): string {
  const [h, m] = time.split(":").map(Number);
  return new Date(dateKeyStartInParis(dateKey) + (h * 60 + m) * 60_000).toISOString();
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
      endMinutes: Math.min(24 * 60, Math.max(endMinutes, startMinutes + 30)),
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
  let start = 8;
  let end = 18;
  for (const day of days) {
    for (const segment of timedEventsForDay(events, day)) {
      start = Math.min(start, Math.floor(segment.startMinutes / 60) - 1);
      end = Math.max(end, Math.ceil(segment.endMinutes / 60) + 1);
    }
  }
  return { start: Math.max(0, start), end: Math.min(24, end) };
}

export function timeLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeCalendarText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[-_'’/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSubjectLine(event: Pick<ScheduleEvent, "title" | "description">): string {
  const desc = event.description ?? "";
  const match = /(?:^|\n)\s*Mati[eè]re\s*:\s*([^\n]+)/i.exec(desc);
  if (match?.[1]) return match[1].trim();
  return event.title;
}

const STOP_WORDS = new Set([
  "et", "de", "des", "du", "la", "le", "les", "pour", "en", "a", "l", "b1", "n1", "gr1", "gr2",
]);

function significantTokens(text: string): string[] {
  return normalizeCalendarText(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

function isRuleObject(r: unknown): r is { pathPatterns?: string[] } {
  return !!r && typeof r === "object" && "pathPatterns" in r && Array.isArray((r as { pathPatterns: unknown }).pathPatterns);
}

/**
 * Associe un événement d'emploi du temps (Boostcamp) à sa matière pour appliquer
 * la couleur correspondante et afficher les devoirs associés.
 */
export function matchEventSubject(
  event: Pick<ScheduleEvent, "title" | "categories" | "description">,
  subjects: CalendarSubject[],
): CalendarSubject | undefined {
  if (!subjects.length) return undefined;
  const primaryRaw = extractSubjectLine(event);
  const primary = normalizeCalendarText(primaryRaw);
  const titleNorm = normalizeCalendarText(event.title);
  const texts = [primary, titleNorm, ...(event.categories ?? []).map(normalizeCalendarText)].filter(Boolean);
  const combined = texts.join(" ");

  let best: CalendarSubject | undefined;
  let bestScore = 0;

  for (const s of subjects) {
    let score = 0;
    const sName = normalizeCalendarText(s.name);
    const sSlug = normalizeCalendarText(s.slug);

    if (primary && (primary === sName || primary === sSlug)) score += 100;
    else if (sName && (primary.includes(sName) || titleNorm.includes(sName))) score += 50;

    if (isRuleObject(s.rules) && s.rules.pathPatterns) {
      for (const pattern of s.rules.pathPatterns) {
        try {
          const re = new RegExp(pattern, "i");
          if (re.test(primaryRaw) || re.test(event.title) || re.test(primary)) {
            score += 25;
          }
        } catch {
          // ignore invalid regex
        }
      }
    }

    // Règles explicites pour les intitulés Boostcamp qui abrègent ou modifient le nom du dossier
    if (s.slug === "infra-data" || (sName.includes("infra") && sName.includes("data"))) {
      if (
        /\binfrastructures?\b.*\bdata\b/.test(combined) ||
        /\bpour la data\b/.test(combined) ||
        /\binfra\s+data\b/.test(combined) ||
        (/\bdata\b/.test(combined) && !/\bdataanalysis\b|\btechaway\b/.test(combined))
      ) {
        score += 35;
      }
    }
    if (s.slug === "techaway-dataanalysis" || sName.includes("techaway")) {
      if (/\btechaway\b|\bdataanalysis\b/.test(combined)) score += 45;
    }
    if (s.slug === "algorithmique-et-prog-c" || sName.includes("prog c")) {
      if (/\bprog(rammation)?\s+c\b|\balgorithmique\b/.test(combined)) score += 30;
    }
    if (s.slug === "developpement-web-front-end" || sName.includes("front end")) {
      if (/\bfront\s*end\b|\bdeveloppement web\b/.test(combined)) score += 30;
    }
    if (s.slug === "anglais-professionnel-technique-avance" || sName.includes("anglais")) {
      if (/\banglais\b|\benglish\b/.test(combined)) score += 30;
    }
    if (s.slug === "comm-posture-professionnelle" || sName.includes("posture")) {
      if (/\bposture professionnelle\b|\bcommunication\b/.test(combined)) score += 30;
    }
    if (s.slug === "linux-environnement-ia" || sName.includes("linux")) {
      if (/\blinux\b|\benvironnement.*ia\b/.test(combined)) score += 30;
    }
    if (s.slug === "mathematiques-pour-info" || sName.includes("mathematiques")) {
      if (/\bmathematiques?\b|\bmaths?\b/.test(combined)) score += 30;
    }
    if (s.slug === "presentations-b1" || sName.includes("presentations")) {
      if (/\bpresentations?\b/.test(combined)) score += 25;
    }

    // Repli par chevauchement de mots-clés pour toute matière ajoutée par l'administrateur
    const sTokens = significantTokens(`${s.name} ${s.slug}`);
    const eTokens = significantTokens(primary || titleNorm);
    if (sTokens.length > 0 && eTokens.length > 0) {
      let matched = 0;
      for (const st of sTokens) {
        if (eTokens.some((et) => et === st || (st.length >= 4 && et.startsWith(st)) || (et.length >= 4 && st.startsWith(et)))) {
          matched++;
        }
      }
      if (matched >= 2 || (sTokens.length === 1 && matched === 1)) {
        score += matched * 10;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }

  return bestScore >= 20 ? best : undefined;
}

/** Devoirs prévus à la date `dayKey` pour la matière du cours `event`. */
export function homeworksForEvent(
  event: Pick<ScheduleEvent, "title" | "categories" | "description">,
  dayKey: string,
  subjects: CalendarSubject[],
  homeworks: CalendarHomework[],
): CalendarHomework[] {
  if (!homeworks.length || !subjects.length) return [];
  const subject = matchEventSubject(event, subjects);
  if (!subject) return [];
  return homeworks.filter((hw) => hw.subjectId === subject.id && hw.dueDate === dayKey);
}

// Partagé avec l'Edge Function `calendar` (une seule définition).
export { cleanEventDescription } from "../../supabase/functions/_shared/calendar-core";

/** Devoirs à rendre au cours de la semaine prochaine (lundi à dimanche suivants). */
export function homeworksForNextWeek<T extends { dueDate: string }>(homeworks: T[], todayKey: string): T[] {
  const nextMonday = shiftDateKey(mondayOfWeek(todayKey), 7);
  const nextSunday = shiftDateKey(nextMonday, 6);
  return homeworks.filter((hw) => hw.dueDate >= nextMonday && hw.dueDate <= nextSunday);
}
