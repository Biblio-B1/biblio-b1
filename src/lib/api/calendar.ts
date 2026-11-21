// Emploi du temps : lecture de son propre calendrier (RLS), liaison/synchronisation par l'Edge
// Function `calendar` (qui seule voit le lien en clair et peut lire le flux .ics).
import type { ScheduleEvent } from "@/lib/calendar-view";
import { getSupabase } from "@/lib/supabase/client";

export type StoredCalendar = { events: ScheduleEvent[]; syncedAt: Date };
export type CalendarResult = { ok: true; calendar: StoredCalendar | null } | { ok: false; error: string; reauth: boolean };

export async function getMyCalendar(): Promise<StoredCalendar | null> {
  const supabase = getSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return null;
  const { data, error } = await supabase.from("calendar_links").select("events, synced_at").eq("user_id", user.user.id).maybeSingle();
  if (error) throw new Error(`Emploi du temps : ${error.message}`);
  return data ? { events: (data.events as ScheduleEvent[]) ?? [], syncedAt: new Date(String(data.synced_at)) } : null;
}

type Invoke = (name: string, opts: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>;

/** Appelle la fonction `calendar` et traduit sa réponse (y compris les erreurs métier en 422). */
export async function callCalendar(
  body: { action: "link"; url: string } | { action: "sync" } | { action: "unlink" },
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
  const d = data as { events: ScheduleEvent[]; syncedAt: string | null };
  return { ok: true, calendar: d.syncedAt ? { events: d.events, syncedAt: new Date(d.syncedAt) } : null };
}
