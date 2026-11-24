// Edge Function `channel` : publie dans le canal Telegram de la classe. Appelée toutes les 5 minutes
// par pg_cron (en-tête x-cron-secret = CHANNEL_CRON_SECRET ; verify_jwt = false). À chaque passage :
//  1. documents et devoirs ajoutés (channel_outbox) : un message par devoir, un récapitulatif des documents ;
//  2. toutes les 30 minutes : relit les emplois du temps Boostcamp des membres, compare avec l'état
//     connu (timetable_watch) et annonce salle, visio/présentiel, horaire, ajout, suppression, annulation ;
//  3. alertes de contrôle (table exams : ajouts du site et séances EVALUATION recopiées au relevé ;
//     devoirs « contrôle/DS/partiel… ») et de projet final (devoirs cochés « projet final ») : 3, 2 et 1 semaine(s) avant, puis la
//     veille ; rappel des autres devoirs la veille. Le palier en cours à l'annonce n'est pas répété.
// Le canal est choisi par l'administrateur depuis Telegram (fonction `telegram`, app_settings).
// Secrets : TELEGRAM_BOT_TOKEN, CHANNEL_CRON_SECRET, CALENDAR_ENCRYPTION_KEY, APP_URL (facultatif).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { decryptUrl, fetchCalendarFeed, parseCalendar, validateCalendarFeedUrl } from "../_shared/calendar-core.ts";
import {
  diffTimetable,
  alertStage,
  examAlerts,
  examFromRow,
  examRowFromSnapshot,
  formatExamAnnounce,
  formatDocuments,
  formatHomework,
  formatTimetableChanges,
  homeworkReminders,
  isExamTitle,
  parisDay,
  snapshot,
  type Exam,
  type ExamDbRow,
  type NewDocument,
  type NewHomework,
  type Snapshot,
} from "../_shared/channel-core.ts";
import { telegramApi } from "../_shared/telegram-core.ts";

const SWEEP_EVERY_MS = 25 * 60_000;
const HORIZON_DAYS = 21;
const deps = { resolveDns: (host: string) => Deno.resolveDns(host, "A"), fetchImpl: fetch };
type Db = ReturnType<typeof createClient>;

async function getSetting<T>(db: Db, key: string): Promise<T | null> {
  const { data } = await db.from("app_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? null;
}
async function setSetting(db: Db, key: string, value: unknown) {
  await db.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() });
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CHANNEL_CRON_SECRET") ?? "";
  if (req.method !== "POST" || !secret || req.headers.get("x-cron-secret") !== secret) {
    return new Response("Non autorisé", { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { force?: boolean; test?: boolean };
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const appUrl = Deno.env.get("APP_URL") ?? "https://biblio-b1.github.io/biblio-b1";
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  const channel = await getSetting<string>(db, "telegram_channel_id");
  const now = new Date();
  const report: Record<string, unknown> = { channel: Boolean(channel) };

  const post = async (text: string) =>
    channel
      ? (await telegramApi("sendMessage", { chat_id: channel, text, parse_mode: "HTML", disable_web_page_preview: true }, { token, fetchImpl: fetch })).ok
      : false;

  if (body.test) {
    report.test = await post("✅ <b>Biblio B1</b> : le canal est bien relié. Vous recevrez ici les nouveaux documents, devoirs, contrôles et changements d'emploi du temps.");
    return Response.json(report);
  }

  // 1. File d'envoi : documents et devoirs ajoutés.
  const { data: queue } = await db.from("channel_outbox").select("id, kind, ref, created_at").is("sent_at", null).order("id").limit(1000);
  const rows = (queue ?? []) as { id: number; kind: string; ref: string; created_at: string }[];
  const done: number[] = [];
  // Palier d'alerte en cours au moment de l'annonce : déjà couvert par l'annonce, pas de second message.
  const covered: string[] = [];
  const stale = (r: { created_at: string }) => now.getTime() - Date.parse(r.created_at) > 86_400_000;
  if (rows.length) {
    const docIds = rows.filter((r) => r.kind === "document").map((r) => r.ref);
    const hwIds = rows.filter((r) => r.kind === "homework").map((r) => r.ref);
    const examIds = rows.filter((r) => r.kind === "exam").map((r) => r.ref);
    const { data: docs } = docIds.length
      ? await db.from("documents").select("id, title, type, subjects(name)").in("id", docIds)
      : { data: [] };
    const { data: hws } = hwIds.length
      ? await db.from("homeworks").select("id, title, due_date, english_group, attachment_name, is_final_project, subjects(name)").in("id", hwIds)
      : { data: [] };
    const newDocs: NewDocument[] = ((docs ?? []) as { id: string; title: string; type: string; subjects: { name: string } | null }[]).map((d) => ({
      id: d.id,
      title: d.title,
      type: d.type,
      subject: d.subjects?.name ?? null,
    }));
    let docsOk = true;
    for (const m of formatDocuments(newDocs, appUrl)) docsOk = (await post(m)) && docsOk;
    for (const r of rows.filter((x) => x.kind === "document")) if (docsOk || stale(r)) done.push(r.id);
    const byId = new Map(((hws ?? []) as { id: string; title: string; due_date: string; english_group: string | null; attachment_name: string | null; is_final_project: boolean; subjects: { name: string } | null }[]).map((h) => [h.id, h]));
    for (const r of rows.filter((x) => x.kind === "homework")) {
      const h = byId.get(r.ref);
      const ok = h
        ? await post(formatHomework({ id: h.id, title: h.title, subject: h.subjects?.name ?? "Sans matière", dueDate: h.due_date, englishGroup: h.english_group, attachmentName: h.attachment_name, finalProject: h.is_final_project }, appUrl))
        : true; // supprimé entre-temps
      if (ok || stale(r)) done.push(r.id);
      const stage = h && ok ? alertStage(h.due_date, now) : null;
      if (h && stage) covered.push(h.is_final_project || isExamTitle(h.title) ? `hw:${h.id}:${stage}` : `hwr:${h.id}:${stage}`);
    }
    const { data: exs } = examIds.length
      ? await db.from("exams").select("*, subjects(name), exam_attachments(name, created_at)").in("id", examIds)
      : { data: [] };
    const examById = new Map(((exs ?? []) as ExamDbRow[]).map((x) => [x.id, x]));
    for (const r of rows.filter((x) => x.kind === "exam")) {
      const x = examById.get(r.ref);
      const ok = x ? await post(formatExamAnnounce({ ...examFromRow(x), details: x.details, attachments: (x.exam_attachments ?? []).map((a) => a.name) }, appUrl)) : true;
      if (ok || stale(r)) done.push(r.id);
      const stage = x && ok ? alertStage(x.exam_date, now) : null;
      if (x && stage) covered.push(`${examFromRow(x).key}:${stage}`);
    }
    if (done.length) await db.from("channel_outbox").update({ sent_at: now.toISOString() }).in("id", done);
    if (covered.length) await db.from("channel_alerts").upsert(covered.map((key) => ({ key })), { onConflict: "key", ignoreDuplicates: true });
    report.outbox = { pending: rows.length, sent: done.length };
  }

  // 2. Emploi du temps (toutes les 30 minutes).
  const sweep = await getSetting<{ at: string; owners: string[] }>(db, "timetable_sweep");
  if (body.force || !sweep || now.getTime() - Date.parse(sweep.at) > SWEEP_EVERY_MS) {
    const key = Deno.env.get("CALENDAR_ENCRYPTION_KEY") ?? "";
    const { data: links } = await db.from("calendar_links").select("user_id, encrypted_url").eq("source", "boostcamp");
    const owners: string[] = [];
    const current = new Map<string, Snapshot>();
    let failures = 0;
    for (const l of (links ?? []) as { user_id: string; encrypted_url: string }[]) {
      try {
        const events = parseCalendar(await fetchCalendarFeed(validateCalendarFeedUrl(await decryptUrl(l.encrypted_url, key)), deps));
        await db.from("calendar_links").update({ events, synced_at: now.toISOString() }).eq("user_id", l.user_id).eq("source", "boostcamp");
        owners.push(l.user_id);
        for (const e of events) {
          const s = snapshot(e);
          if (s && Date.parse(s.end) >= now.getTime()) current.set(s.uid, s);
        }
      } catch (e) {
        failures++;
        console.error("relevé", l.user_id, e instanceof Error ? e.message : e);
      }
    }
    owners.sort();
    const { data: watched } = await db.from("timetable_watch").select("snap").gte("start_at", new Date(now.getTime() - 86_400_000).toISOString());
    const before = ((watched ?? []) as { snap: Snapshot }[]).map((w) => w.snap);
    // Premier relevé, ou membres différents (nouveau groupe, calendrier délié) : état de référence, sans annonce.
    const sameOwners = sweep && JSON.stringify(sweep.owners) === JSON.stringify(owners);
    const baseline = before.length === 0 || !sameOwners;
    const complete = failures === 0 && owners.length > 0;
    const changes = baseline || owners.length === 0 ? [] : diffTimetable(before, [...current.values()], { now, horizonDays: HORIZON_DAYS, complete });
    let sent = true;
    for (const m of formatTimetableChanges(changes, appUrl)) sent = (await post(m)) && sent;
    if (owners.length > 0 && (sent || !channel)) {
      const snaps = [...current.values()];
      for (let i = 0; i < snaps.length; i += 200) {
        await db.from("timetable_watch").upsert(
          snaps.slice(i, i + 200).map((s) => ({ uid: s.uid, snap: s, start_at: s.start, last_seen: now.toISOString() })),
        );
      }
      if (complete) {
        const gone = before.filter((s) => !current.has(s.uid)).map((s) => s.uid);
        if (gone.length) await db.from("timetable_watch").delete().in("uid", gone);
      }
      await db.from("timetable_watch").delete().lt("start_at", new Date(now.getTime() - 86_400_000).toISOString());
      await setSetting(db, "timetable_sweep", { at: now.toISOString(), owners });
    }
    // Séances EVALUATION → onglet Contrôles (table exams, source edt).
    if (owners.length > 0) {
      const examRows = [...current.values()].map(examRowFromSnapshot).filter((x) => x !== null);
      if (examRows.length) await db.from("exams").upsert(examRows, { onConflict: "edt_uid" });
      if (complete) {
        const keep = new Set(examRows.map((x) => x.edt_uid));
        const { data: known } = await db.from("exams").select("id, edt_uid").eq("source", "edt").gte("exam_date", parisDay(now));
        const gone = ((known ?? []) as { id: string; edt_uid: string }[]).filter((x) => !keep.has(x.edt_uid)).map((x) => x.id);
        if (gone.length) await db.from("exams").delete().in("id", gone);
      }
      report.exams = examRows.length;
    }
    report.timetable = { calendars: owners.length, failures, events: current.size, baseline, changes: changes.length };
  }

  // 3. Alertes de contrôle.
  if (channel) {
    const today = parisDay(now);
    const in22 = parisDay(new Date(now.getTime() + 22 * 86_400_000));
    const { data: examTable } = await db.from("exams").select("*, subjects(name)").gte("exam_date", today).lte("exam_date", in22);
    const exams: Exam[] = ((examTable ?? []) as ExamDbRow[]).map(examFromRow);
    const { data: hws } = await db.from("homeworks").select("id, title, due_date, english_group, is_final_project, subjects(name)").gte("due_date", today).lte("due_date", in22);
    const homeworks: NewHomework[] = [];
    for (const h of (hws ?? []) as { id: string; title: string; due_date: string; english_group: string | null; is_final_project: boolean; subjects: { name: string } | null }[]) {
      const subject = h.subjects?.name ?? "Sans matière";
      if (h.is_final_project) exams.push({ key: `hw:${h.id}`, subject, title: h.title, day: h.due_date, kind: "projet" });
      else if (isExamTitle(h.title)) exams.push({ key: `hw:${h.id}`, subject, title: h.title, day: h.due_date });
      else homeworks.push({ id: h.id, title: h.title, subject, dueDate: h.due_date, englishGroup: h.english_group });
    }
    const { data: sentRows } = await db.from("channel_alerts").select("key");
    const sentKeys = new Set(((sentRows ?? []) as { key: string }[]).map((r) => r.key));
    const alerts = [...examAlerts(exams, sentKeys, now, appUrl), ...homeworkReminders(homeworks, sentKeys, now, appUrl)];
    for (const a of alerts) if (await post(a.text)) await db.from("channel_alerts").insert({ key: a.key });
    report.alerts = alerts.length;
  }

  return Response.json(report);
});
