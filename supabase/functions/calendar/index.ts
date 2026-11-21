// Edge Function `calendar` : lier, synchroniser ou délier le calendrier Boostcamp (.ics) d'un membre.
// Le navigateur ne peut pas lire le flux lui-même (CORS) et le lien contient un jeton personnel :
// la fonction le récupère côté serveur et ne stocke que sa version chiffrée.
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
  const { data: profile } = await userClient.from("profiles").select("status").eq("id", user.id).maybeSingle();
  if (profile?.status !== "active") return json({ error: "Compte en attente de validation" }, 403, origin);

  const key = Deno.env.get("CALENDAR_ENCRYPTION_KEY") ?? "";
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: { action?: string; url?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corps invalide" }, 400, origin);
  }

  try {
    if (body.action === "unlink") {
      await admin.from("calendar_links").delete().eq("user_id", user.id);
      return json({ events: [], syncedAt: null }, 200, origin);
    }

    let feedUrl: URL;
    let encryptedUrl: string;
    if (body.action === "link") {
      feedUrl = validateCalendarFeedUrl(String(body.url ?? ""));
      encryptedUrl = await encryptUrl(feedUrl.toString(), key);
    } else if (body.action === "sync") {
      const { data: row } = await admin.from("calendar_links").select("encrypted_url").eq("user_id", user.id).maybeSingle();
      if (!row) return json({ error: "Aucun calendrier lié." }, 404, origin);
      encryptedUrl = row.encrypted_url;
      feedUrl = validateCalendarFeedUrl(await decryptUrl(encryptedUrl, key));
    } else {
      return json({ error: "Action inconnue : link, sync ou unlink" }, 400, origin);
    }

    const events = parseCalendar(await fetchCalendarFeed(feedUrl, deps));
    const syncedAt = new Date().toISOString();
    const { error } = await admin
      .from("calendar_links")
      .upsert({ user_id: user.id, encrypted_url: encryptedUrl, events, synced_at: syncedAt });
    if (error) throw new Error(error.message);
    return json({ events, syncedAt }, 200, origin);
  } catch (e) {
    if (e instanceof CalendarError) return json({ error: e.message, code: e.code }, 422, origin);
    console.error(e);
    return json({ error: "Erreur interne du calendrier." }, 500, origin);
  }
});
