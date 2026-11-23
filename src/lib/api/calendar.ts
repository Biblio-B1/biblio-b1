// Emploi du temps : lecture de ses propres calendriers (RLS), liaison/synchronisation par l'Edge
// Function `calendar` (qui seule voit les liens en clair et peut lire les flux .ics).
// Deux calendriers possibles par membre, affichés ensemble : Boostcamp et Outlook.
import type { ScheduleEvent } from "@/lib/calendar-view";
import { getSupabase } from "@/lib/supabase/client";

export type CalendarSource = "boostcamp" | "outlook";
export const CALENDAR_SOURCES: CalendarSource[] = ["boostcamp", "outlook"];
export type LinkedSource = { source: CalendarSource; syncedAt: Date };
/** syncedAt : synchronisation la plus ancienne des calendriers liés. */
export type StoredCalendar = { events: ScheduleEvent[]; syncedAt: Date; sources: LinkedSource[] };
export type CalendarResult = { ok: true; calendar: StoredCalendar | null } | { ok: false; error: string; reauth: boolean };

type Row = { source: CalendarSource; events: ScheduleEvent[] | null; synced_at: string };

export function mergeCalendars(rows: Row[]): StoredCalendar | null {
  if (rows.length === 0) return null;
  const sources = rows.map((r) => ({ source: r.source, syncedAt: new Date(r.synced_at) }));
  return {
    events: rows.flatMap((r) => r.events ?? []),
    syncedAt: new Date(Math.min(...sources.map((s) => s.syncedAt.getTime()))),
    sources,
  };
}

export async function getMyCalendar(): Promise<StoredCalendar | null> {
  const supabase = getSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return null;
  const { data, error } = await supabase.from("calendar_links").select("source, events, synced_at").eq("user_id", user.user.id);
  if (error) throw new Error(`Emploi du temps : ${error.message}`);
  return mergeCalendars((data ?? []) as Row[]);
}

type Invoke = (name: string, opts: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>;

/** Appelle la fonction `calendar` et traduit sa réponse (y compris les erreurs métier en 422). */
export async function callCalendar(
  body:
    | { action: "link"; url: string; source?: CalendarSource }
    | { action: "sync"; source?: CalendarSource }
    | { action: "unlink"; source?: CalendarSource },
  invoke: Invoke = (name, opts) => getSupabase().functions.invoke(name, opts),
): Promise<CalendarResult> {
  const { data, error } = await invoke("calendar", { body });
  if (error) {
    // supabase-js range la réponse d'erreur HTTP dans error.context (Response).
    const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
    const payload = (await ctx?.json?.().catch(() => null)) as { error?: string; code?: string } | null;
    return {
      ok: false,
      error: payload?.error ?? "Le calendrier n'a pas pu être lu. Réessayez plus tard.",
      reauth: payload?.code === "reauth_required",
    };
  }
  const d = data as { events: ScheduleEvent[]; syncedAt: string | null; sources?: { source: CalendarSource; syncedAt: string }[] };
  if (!d.syncedAt) return { ok: true, calendar: null };
  return {
    ok: true,
    calendar: {
      events: d.events,
      syncedAt: new Date(d.syncedAt),
      sources: (d.sources ?? []).map((s) => ({ source: s.source, syncedAt: new Date(s.syncedAt) })),
    },
  };
}
