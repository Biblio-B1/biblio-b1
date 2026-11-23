// Edge Function `notify` : prévient l'administrateur sur Telegram à chaque connexion et à chaque
// demande de compte, et à chaque tentative de connexion d'un compte pas encore validé (ces deux
// derniers avec boutons Accepter / Refuser). Appelée par le site avec le jeton de
// l'utilisateur ; le nom est lu dans `profiles` (on ne fait pas confiance au corps de la requête).
// Secrets : TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (conversation de l'admin avec le bot), APP_URL.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { buildTelegramMessage, eventForLogin, sendTelegram } from "../_shared/telegram-core.ts";

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

  let event: "login" | "signup";
  try {
    const body = await req.json();
    if (body?.event !== "login" && body?.event !== "signup") throw new Error();
    event = body.event;
  } catch {
    return json({ error: "Corps invalide : { event: 'login' | 'signup' }" }, 400, origin);
  }

  // Le profil est lisible par son propriétaire, même « pending » (RLS).
  const { data: profile } = await supabase.from("profiles").select("name, status").eq("id", userData.user.id).maybeSingle();
  const message = buildTelegramMessage({
    // Compte pas encore validé qui se connecte : alerte avec boutons Accepter / Refuser.
    event: eventForLogin(event, profile?.status),
    name: profile?.name ?? userData.user.email ?? "Quelqu'un",
    email: userData.user.email ?? "",
    userId: userData.user.id,
    appUrl: Deno.env.get("APP_URL") ?? "https://biblio-b1.github.io/biblio-b1",
  });
  const result = await sendTelegram(message, {
    token: Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "",
    chatId: Deno.env.get("TELEGRAM_CHAT_ID") ?? "",
    fetchImpl: fetch,
  });
  if (!result.ok) console.error("[notify] envoi Telegram impossible", result);
  // Un échec d'envoi n'empêche jamais la connexion : toujours 200 (le site ignore la réponse).
  return json({ sent: result.ok, telegram: { status: result.status, error: result.error } }, 200, origin);
});
