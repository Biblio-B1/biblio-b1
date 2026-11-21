// Edge Function `notify` : prévient l'administrateur (ntfy) à chaque connexion et à chaque demande
// de compte. Appelée par le site avec le jeton de l'utilisateur ; le pseudo est lu dans `profiles`
// (on ne fait pas confiance au corps de la requête pour l'identité).
// Secrets : NTFY_TOPIC (obligatoire pour envoyer), NTFY_URL (défaut https://ntfy.sh), APP_URL.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { buildNotification, publishNtfy, type NotifyEvent } from "../_shared/notify-core.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405, origin);

  const authorization = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return json({ error: "Non authentifié" }, 401, origin);

  let event: NotifyEvent;
  try {
    const body = await req.json();
    if (body?.event !== "login" && body?.event !== "signup") throw new Error();
    event = body.event;
  } catch {
    return json({ error: "Corps invalide : { event: 'login' | 'signup' }" }, 400, origin);
  }

  // Le profil est lisible par son propriétaire, même « pending » (RLS).
  const { data: profile } = await supabase.from("profiles").select("name").eq("id", userData.user.id).maybeSingle();
  const name = profile?.name ?? userData.user.email ?? "Quelqu'un";
  const appUrl = Deno.env.get("APP_URL") ?? "https://biblio-b1.github.io/biblio-b1";
  const n = buildNotification(event, name);
  await publishNtfy(
    { ...n, click: event === "signup" ? `${appUrl}/admin/users/` : `${appUrl}/` },
    { topic: Deno.env.get("NTFY_TOPIC"), url: Deno.env.get("NTFY_URL") ?? "https://ntfy.sh", fetchImpl: fetch },
  );
  // Un échec d'envoi n'empêche jamais la connexion : toujours 204.
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
});
