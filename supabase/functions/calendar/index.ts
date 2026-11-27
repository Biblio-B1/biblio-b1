// Edge Function `calendar` : lier, synchroniser ou délier les calendriers (.ics) d'un membre :
// Boostcamp (emploi du temps de l'école) et Outlook (calendrier publié). Le navigateur ne peut pas
// lire le flux lui-même (CORS) et le lien contient un jeton personnel : la fonction le récupère
// côté serveur et ne stocke que sa version chiffrée.
// Réponse : tous les calendriers du membre réunis ({ events, syncedAt, sources }).
// Secrets : CALENDAR_ENCRYPTION_KEY (64 caractères hexadécimaux). SUPABASE_URL, SUPABASE_ANON_KEY et
// SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import {
  CalendarError,
  decryptUrl,
  encryptUrl,
  fetchCalendarFeed,
  parseCalendar,
  validateCalendarFeedUrl,
} from "../_shared/calendar-core.ts";

const deps = {
  resolveDns: (host: string) => Deno.resolveDns(host, "A"),
  fetchImpl: fetch,
};

// Le calendrier Outlook a été retiré : seuls les liens Boostcamp sont lus (les anciens liens Outlook sont ignorés).
const SOURCES = ["boostcamp"] as const;
type Source = (typeof SOURCES)[number];
type Row = { source: Source; encrypted_url: string; events: unknown[]; synced_at: string };

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405, origin);

  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: userData } = await userClient.auth.getUser();
  const user = userData.user;
  if (!user) return json({ error: "Non authentifié" }, 401, origin);
  const { data: profile } = await userClient.from("profiles").select("status, role").eq("id", user.id).maybeSingle();
  if (profile?.status !== "active") return json({ error: "Compte en attente de validation" }, 403, origin);
  if (profile.role === "guest" || user.is_anonymous) return json({ error: "Mode invité : consultation uniquement" }, 403, origin);

  const key = Deno.env.get("CALENDAR_ENCRYPTION_KEY") ?? "";
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: { action?: string; url?: string; source?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corps invalide" }, 400, origin);
  }
  const source = (body.source ?? "boostcamp") as Source;
  if (!SOURCES.includes(source)) return json({ error: "Calendrier inconnu : seul l'emploi du temps Boostcamp est pris en charge" }, 400, origin);

  async function state() {
    const { data } = await admin
      .from("calendar_links")
      .select("source, encrypted_url, events, synced_at")
      .eq("user_id", user!.id)
      .in("source", SOURCES);
    const rows = (data ?? []) as Row[];
    return {
      events: rows.flatMap((r) => r.events),
      // La plus ancienne synchronisation : la page relance une synchronisation quand elle vieillit.
      syncedAt: rows.length ? rows.map((r) => r.synced_at).sort()[0] : null,
      sources: rows.map((r) => ({ source: r.source, syncedAt: r.synced_at })),
    };
  }

  async function refresh(src: Source, encryptedUrl: string, feedUrl: URL) {
    const events = parseCalendar(await fetchCalendarFeed(feedUrl, deps));
    const { error } = await admin
      .from("calendar_links")
      .upsert({ user_id: user!.id, source: src, encrypted_url: encryptedUrl, events, synced_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
  }

  try {
    if (body.action === "unlink") {
      await admin.from("calendar_links").delete().eq("user_id", user.id).eq("source", source);
    } else if (body.action === "link") {
      const feedUrl = validateCalendarFeedUrl(String(body.url ?? ""));
      await refresh(source, await encryptUrl(feedUrl.toString(), key), feedUrl);
    } else if (body.action === "sync") {
      // Sans « source » : tous les calendriers liés ; la première erreur est renvoyée après coup.
      const { data } = await admin.from("calendar_links").select("source, encrypted_url").eq("user_id", user.id).in("source", SOURCES);
      const rows = ((data ?? []) as Pick<Row, "source" | "encrypted_url">[]).filter((r) => !body.source || r.source === source);
      if (rows.length === 0) return json({ error: "Aucun calendrier lié." }, 404, origin);
      let failure: CalendarError | null = null;
      for (const r of rows) {
        try {
          await refresh(r.source, r.encrypted_url, validateCalendarFeedUrl(await decryptUrl(r.encrypted_url, key)));
        } catch (e) {
          if (!(e instanceof CalendarError)) throw e;
          failure ??= new CalendarError(`Boostcamp : ${e.message}`, e.code);
        }
      }
      if (failure) throw failure;
    } else {
      return json({ error: "Action inconnue : link, sync ou unlink" }, 400, origin);
    }
    return json(await state(), 200, origin);
  } catch (e) {
    if (e instanceof CalendarError) return json({ error: e.message, code: e.code }, 422, origin);
    console.error(e);
    return json({ error: "Erreur interne du calendrier." }, 500, origin);
  }
});
