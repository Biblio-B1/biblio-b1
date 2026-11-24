// Canal Telegram de la classe : logique pure (sans réseau ni base), partagée par l'Edge Function
// `channel` et les tests. Messages HTML Telegram (<b>, <a>), dates en heure de Paris.
import type { CalendarEvent } from "./calendar-core.ts";
import { escapeHtml } from "./telegram-core.ts";

const TZ = "Europe/Paris";
const MAX_TELEGRAM = 4000;

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------
const dayFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const keyFmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ });
const hourFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: TZ });

/** « 2026-11-24 » (jour à Paris). */
export function parisDay(d: Date): string {
  return keyFmt.format(d);
}
export function parisHour(d: Date): number {
  return Number(hourFmt.format(d));
}
/** Nombre de jours (calendaires, Paris) entre aujourd'hui et `day` (« AAAA-MM-JJ »). */
export function daysUntil(day: string, now: Date): number {
  const a = Date.parse(`${parisDay(now)}T00:00:00Z`);
  const b = Date.parse(`${day}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
function slot(start: string, end: string): string {
  const s = new Date(start);
  return `${dayFmt.format(s)}, ${timeFmt.format(s)}–${timeFmt.format(new Date(end))}`;
}
function dayLabel(day: string): string {
  return dayFmt.format(new Date(`${day}T12:00:00Z`));
}

// ---------------------------------------------------------------------------------------------
// Emploi du temps : instantané comparable d'une séance Boostcamp
// ---------------------------------------------------------------------------------------------
export type Snapshot = {
  uid: string;
  subject: string;
  type: string;
  groups: string;
  start: string;
  end: string;
  location: string;
  visio: boolean;
  cancelled: boolean;
};

function line(description: string | undefined, label: string): string {
  const m = description?.match(new RegExp(`^${label}\\s*:\\s*(.+)$`, "im"));
  return m ? m[1].trim() : "";
}

/** Créneaux sans intérêt pour la classe : travail en autonomie, e-learning, jours fériés. */
const IGNORED_TYPES = /^(ELEARNING|AUTONOMIE)$/i;

export function snapshot(e: CalendarEvent): Snapshot | null {
  const type = line(e.description, "Type").toUpperCase();
  const title = e.title.replace(/^ferm[ée]\s*-\s*/i, "").trim();
  if (IGNORED_TYPES.test(type) || /^f[ée]ri[ée]$/i.test(title)) return null;
  const subject = line(e.description, "Matière") || title.split(" - ")[0] || title;
  const groups = line(e.description, "TD")
    .replace(/Bch B1 Intelligence Artificielle\s*/gi, "IA ")
    .replace(/\s*\(fr\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const location = (e.location ?? "").trim();
  // Visio : type « …-CV » (cours virtuel) ou lien de réunion ; « (Meet-up) » est un nom de salle.
  const visio = /-CV$/.test(type) || /\b(teams|zoom|visio|distanciel|meet\.google)\b/i.test(location);
  return {
    uid: e.uid,
    subject,
    type,
    groups,
    start: e.start,
    end: e.end,
    location,
    visio,
    cancelled: e.status === "cancelled",
  };
}

export type Change =
  | { kind: "added"; now: Snapshot }
  | { kind: "removed"; before: Snapshot }
  | { kind: "cancelled"; now: Snapshot }
  | { kind: "moved"; before: Snapshot; now: Snapshot }
  | { kind: "room"; before: Snapshot; now: Snapshot }
  | { kind: "toVisio"; before: Snapshot; now: Snapshot }
  | { kind: "toPresentiel"; before: Snapshot; now: Snapshot };

function compare(before: Snapshot, now: Snapshot): Change[] {
  if (now.cancelled && !before.cancelled) return [{ kind: "cancelled", now }];
  if (now.cancelled) return [];
  const out: Change[] = [];
  if (before.start !== now.start || before.end !== now.end) out.push({ kind: "moved", before, now });
  if (!before.visio && now.visio) out.push({ kind: "toVisio", before, now });
  else if (before.visio && !now.visio) out.push({ kind: "toPresentiel", before, now });
  else if (!now.visio && before.location !== now.location) out.push({ kind: "room", before, now });
  return out;
}

/**
 * Changements à annoncer entre deux relevés. `before` : séances futures déjà connues ; `after` :
 * relevé actuel (toutes sources réunies). Seules les séances des `horizonDays` prochains jours sont
 * annoncées. Une séance disparue n'est annoncée que si le relevé est complet (tous les calendriers
 * lus). Un identifiant changé (même matière, même début) compte comme une modification.
 */
export function diffTimetable(
  before: Snapshot[],
  after: Snapshot[],
  opts: { now: Date; horizonDays: number; complete: boolean },
): Change[] {
  const from = opts.now.getTime();
  const to = from + opts.horizonDays * 86_400_000;
  const inWindow = (s: Snapshot) => {
    const t = Date.parse(s.start);
    return t >= from && t < to;
  };
  const prev = new Map(before.map((s) => [s.uid, s]));
  const next = new Map(after.map((s) => [s.uid, s]));
  const changes: Change[] = [];
  const added: Snapshot[] = [];
  for (const s of next.values()) {
    const old = prev.get(s.uid);
    if (old) {
      if (inWindow(s) || inWindow(old)) changes.push(...compare(old, s));
    } else if (inWindow(s) && !s.cancelled) {
      added.push(s);
    }
  }
  const removed = opts.complete ? [...prev.values()].filter((s) => !next.has(s.uid) && inWindow(s) && !s.cancelled) : [];
  for (const r of removed) {
    const twin = added.findIndex((a) => a.subject === r.subject && a.start === r.start && a.groups === r.groups);
    if (twin >= 0) {
      changes.push(...compare(r, added[twin]));
      added.splice(twin, 1);
    } else {
      changes.push({ kind: "removed", before: r });
    }
  }
  for (const a of added) changes.push({ kind: "added", now: a });
  return changes.sort((x, y) => Date.parse(snap(x).start) - Date.parse(snap(y).start));
}

function snap(c: Change): Snapshot {
  return "now" in c ? c.now : c.before;
}

function where(s: Snapshot): string {
  return s.visio ? "en visio" : s.location ? escapeHtml(s.location) : "salle non précisée";
}

/** Lignes communes : matière (et groupe), date, horaire. */
function subjectLine(s: Snapshot): string {
  const g = s.groups && !/,/.test(s.groups) ? ` (${escapeHtml(s.groups)})` : "";
  return `📚 Matière : <b>${escapeHtml(s.subject)}</b>${g}`;
}
function dateLines(s: Snapshot, bold = false): string[] {
  const b = (t: string) => (bold ? `<b>${t}</b>` : t);
  return [`📅 Date : ${b(dayFmt.format(new Date(s.start)))}`, `🕒 Horaire : ${b(`${timeFmt.format(new Date(s.start))}–${timeFmt.format(new Date(s.end))}`)}`];
}

export function describeChange(c: Change): string {
  switch (c.kind) {
    case "added":
      return ["➕ <b>Cours ajouté</b>", subjectLine(c.now), ...dateLines(c.now), `📍 Lieu : ${where(c.now)}`].join("\n");
    case "removed":
      return ["❌ <b>Cours supprimé</b>", subjectLine(c.before), ...dateLines(c.before)].join("\n");
    case "cancelled":
      return ["❌ <b>Cours annulé</b>", subjectLine(c.now), ...dateLines(c.now)].join("\n");
    case "moved":
      return [
        "🕒 <b>Horaire modifié</b>",
        subjectLine(c.now),
        `⬅️ Avant : ${slot(c.before.start, c.before.end)}`,
        `➡️ Maintenant : <b>${slot(c.now.start, c.now.end)}</b>`,
        `📍 Lieu : ${where(c.now)}`,
      ].join("\n");
    case "room":
      return [
        "🚪 <b>Changement de salle</b>",
        subjectLine(c.now),
        ...dateLines(c.now),
        `📍 Salle : ${escapeHtml(c.before.location || "?")} → <b>${escapeHtml(c.now.location || "?")}</b>`,
      ].join("\n");
    case "toVisio":
      return [
        "💻 <b>Cours en visio</b>",
        subjectLine(c.now),
        ...dateLines(c.now, true),
        `📍 Lieu : <b>en visio</b> (au lieu de ${escapeHtml(c.before.location || "présentiel")})`,
      ].join("\n");
    case "toPresentiel":
      return [
        "🏫 <b>Cours en présentiel</b>",
        subjectLine(c.now),
        ...dateLines(c.now, true),
        `📍 Salle : <b>${escapeHtml(c.now.location || "salle non précisée")}</b> (au lieu de la visio)`,
      ].join("\n");
  }
}

/** Un message (ou plusieurs si trop long) pour une liste de changements. */
export function formatTimetableChanges(changes: Change[], appUrl: string): string[] {
  if (changes.length === 0) return [];
  const header = "🗓️ <b>Emploi du temps modifié</b>";
  const footer = `\n<a href="${appUrl}/timetable/">Voir l'emploi du temps</a>`;
  return chunk(header, changes.map(describeChange), footer);
}

function chunk(header: string, items: string[], footer: string): string[] {
  const messages: string[] = [];
  let current = header;
  for (const item of items) {
    if ((current + "\n\n" + item + footer).length > MAX_TELEGRAM) {
      messages.push(current + footer);
      current = `${header} (suite)`;
    }
    current += "\n\n" + item;
  }
  messages.push(current + footer);
  return messages;
}

// ---------------------------------------------------------------------------------------------
// Documents et devoirs
// ---------------------------------------------------------------------------------------------
export type NewDocument = { id: string; title: string; type: string; subject: string | null };
export type NewHomework = {
  id: string;
  title: string;
  subject: string;
  dueDate: string;
  englishGroup?: string | null;
  attachmentName?: string | null;
};

export const DOC_TYPES: Record<string, string> = {
  course: "Cours",
  exercise: "Exercices",
  exam: "Sujet d'examen",
  photo: "Photo",
  note: "Fiche",
};
const docType = (t: string) => DOC_TYPES[t] ?? "Document";

export function formatDocuments(docs: NewDocument[], appUrl: string): string[] {
  if (docs.length === 0) return [];
  if (docs.length === 1) {
    const d = docs[0];
    return [
      [
        `📄 <b>Nouveau document : ${escapeHtml(docType(d.type).toLowerCase())}</b>`,
        "",
        `<b>${escapeHtml(d.title)}</b>`,
        `📚 ${escapeHtml(d.subject ?? "Sans matière")}`,
        "",
        `<a href="${appUrl}/doc/?id=${d.id}">Ouvrir le document</a>`,
      ].join("\n"),
    ];
  }
  const bySubject = new Map<string, NewDocument[]>();
  for (const d of docs) {
    const k = d.subject ?? "Sans matière";
    bySubject.set(k, [...(bySubject.get(k) ?? []), d]);
  }
  const items = [...bySubject.entries()].map(
    ([subject, list]) =>
      `📚 <b>${escapeHtml(subject)}</b>\n` +
      list.map((d) => `  • ${escapeHtml(docType(d.type))} : <a href="${appUrl}/doc/?id=${d.id}">${escapeHtml(d.title)}</a>`).join("\n"),
  );
  return chunk(`📄 <b>${docs.length} nouveaux documents</b>`, items, `\n<a href="${appUrl}/library/">Ouvrir la bibliothèque</a>`);
}

// Limites de mot Unicode (\b ignore les lettres accentuées comme « É »).
const EXAM_WORDS = /(?<![\p{L}\d])(contr[ôo]les?|ds|partiels?|examens?|[ée]valuations?|interros?|interrogations?|qcm|tests?)(?![\p{L}\d])/iu;
export function isExamTitle(title: string): boolean {
  return EXAM_WORDS.test(title);
}

export function formatHomework(h: NewHomework, appUrl: string): string {
  const exam = isExamTitle(h.title);
  return [
    exam ? "📣 <b>Contrôle annoncé</b>" : "📝 <b>Nouveau devoir</b>",
    "",
    `📚 Matière : <b>${escapeHtml(h.subject)}</b>${h.englishGroup ? ` (groupe ${escapeHtml(h.englishGroup)})` : ""}`,
    `📝 ${exam ? "Contrôle" : "Devoir"} : ${escapeHtml(h.title)}`,
    `📅 ${exam ? "Date" : "À rendre le"} : <b>${dayLabel(h.dueDate)}</b>`,
    ...(h.attachmentName ? [`📎 Pièce jointe : ${escapeHtml(h.attachmentName)}`] : []),
    "",
    `<a href="${appUrl}/devoirs/">Voir les devoirs</a>`,
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Alertes de contrôle : une semaine avant (ou dès qu'il reste 2 à 7 jours), puis la veille à 17 h.
// ---------------------------------------------------------------------------------------------
/** subject : matière ; title : intitulé (titre du devoir) s'il dit autre chose ; time / place : horaire et lieu (HTML échappé). */
export type ExamKind = "controle" | "projet";
export type Exam = { key: string; subject: string; title?: string; day: string; time?: string; place?: string; kind?: ExamKind };
export type ExamAlert = { key: string; text: string };

function examText(head: string, e: Exam, footer: string): string {
  return [
    head,
    "",
    `📚 Matière : <b>${escapeHtml(e.subject)}</b>`,
    ...(e.title && e.title !== e.subject ? [`📝 ${escapeHtml(e.title)}`] : []),
    `📅 Date : <b>${dayLabel(e.day)}</b>`,
    ...(e.time ? [`🕒 Horaire : <b>${e.time}</b>`] : []),
    ...(e.place ? [`📍 Lieu : ${e.place}`] : []),
    "",
    footer,
  ].join("\n");
}

export function examAlerts(exams: Exam[], sent: Set<string>, now: Date, appUrl: string): ExamAlert[] {
  const out: ExamAlert[] = [];
  const revise = `<a href="${appUrl}/controles/">Voir les contrôles</a>`;
  for (const e of exams) {
    const n = daysUntil(e.day, now);
    const projet = e.kind === "projet";
    if (n === 1 && parisHour(now) >= 17 && !sent.has(`${e.key}:veille`)) {
      const head = projet ? "⚠️ <b>Projet final à rendre demain</b>" : "⚠️ <b>Contrôle demain</b>";
      out.push({ key: `${e.key}:veille`, text: examText(head, e, `Bon courage ! ${revise}`) });
    } else if (n >= 2 && n <= 7 && !sent.has(`${e.key}:semaine`)) {
      const head = projet ? `📣 <b>Projet final à rendre dans ${n} jours</b>` : `📣 <b>Contrôle dans ${n} jours</b>`;
      out.push({ key: `${e.key}:semaine`, text: examText(head, e, revise) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Table « exams » (onglet Contrôles du site)
// ---------------------------------------------------------------------------------------------
export type ExamDbRow = {
  id: string;
  kind: ExamKind;
  title: string;
  exam_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  details?: string | null;
  source: "manual" | "edt";
  edt_uid: string | null;
  subject_label: string | null;
  subjects?: { name: string } | null;
};

const hm = (t: string | null) => (t ? t.slice(0, 5) : "");

/** Ligne de la table → contrôle pour les alertes (clé « edt:<uid> » pour l'emploi du temps). */
export function examFromRow(r: ExamDbRow): Exam {
  const time = r.start_time ? (r.end_time ? `${hm(r.start_time)}–${hm(r.end_time)}` : hm(r.start_time)) : undefined;
  return {
    key: r.source === "edt" && r.edt_uid ? `edt:${r.edt_uid}` : `exam:${r.id}`,
    subject: r.subjects?.name ?? r.subject_label ?? "Sans matière",
    title: r.title || undefined,
    day: r.exam_date,
    time: time ? escapeHtml(time) : undefined,
    place: r.location ? escapeHtml(r.location) : undefined,
    kind: r.kind,
  };
}

const hmFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });

/** Séance EVALUATION de l'emploi du temps → ligne « exams » (source edt). Null si sans intérêt. */
export function examRowFromSnapshot(s: Snapshot) {
  if (s.type !== "EVALUATION" || s.cancelled) return null;
  const start = new Date(s.start);
  const end = new Date(s.end);
  const sameDay = parisDay(start) === parisDay(end);
  return {
    source: "edt" as const,
    edt_uid: s.uid,
    kind: "controle" as const,
    subject_label: s.subject.slice(0, 200) || "Sans matière",
    title: "",
    exam_date: parisDay(start),
    start_time: hmFmt.format(start),
    end_time: sameDay && end > start ? hmFmt.format(end) : null,
    location: (s.visio ? "Visio" : s.location || "").slice(0, 200) || null,
  };
}

/** Message « contrôle / projet annoncé » quand un élève l'ajoute sur le site. */
export function formatExamAnnounce(e: Exam & { details?: string | null }, appUrl: string): string {
  const projet = e.kind === "projet";
  return [
    projet ? "📣 <b>Projet final annoncé</b>" : "📣 <b>Contrôle annoncé</b>",
    "",
    `📚 Matière : <b>${escapeHtml(e.subject)}</b>`,
    ...(e.title && e.title !== e.subject ? [`📝 ${escapeHtml(e.title)}`] : []),
    `📅 ${projet ? "À rendre le" : "Date"} : <b>${dayLabel(e.day)}</b>`,
    ...(e.time ? [`🕒 Horaire : <b>${e.time}</b>`] : []),
    ...(e.place ? [`📍 Lieu : ${e.place}`] : []),
    ...(e.details ? ["", escapeHtml(e.details)] : []),
    "",
    `<a href="${appUrl}/controles/">Voir les contrôles</a>`,
  ].join("\n");
}

/** Contrôles de l'emploi du temps (séances « EVALUATION »). */
export function examsFromTimetable(snaps: Snapshot[]): Exam[] {
  return snaps
    .filter((s) => s.type === "EVALUATION" && !s.cancelled)
    .map((s) => ({
      key: `edt:${s.uid}`,
      subject: s.subject,
      day: parisDay(new Date(s.start)),
      time: `${timeFmt.format(new Date(s.start))}–${timeFmt.format(new Date(s.end))}`,
      place: where(s),
    }));
}
