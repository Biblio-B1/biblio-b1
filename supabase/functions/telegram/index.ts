// Edge Function `telegram` : webhook du bot. Applique les boutons « Accepter » / « Refuser » d'une
// demande de compte. Appelée par Telegram (pas de jeton Supabase : verify_jwt = false), elle exige :
//  - l'en-tête X-Telegram-Bot-Api-Secret-Token = TELEGRAM_WEBHOOK_SECRET (défini à setWebhook) ;
//  - un clic venant de la conversation de l'administrateur (TELEGRAM_CHAT_ID).
// Accepter = profil « active » ; Refuser = suppression du compte, seulement s'il est encore en attente.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { escapeHtml, isAdminChat, parseDecision, telegramApi } from "../_shared/telegram-core.ts";

const ok = () => new Response("ok", { status: 200 });

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Méthode non autorisée", { status: 405 });
  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
  if (!secret || req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) {
    return new Response("Non autorisé", { status: 401 });
  }
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  const adminChat = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";
  const api = (method: string, body: Record<string, unknown>) => telegramApi(method, body, { token, fetchImpl: fetch });

  let update: {
    callback_query?: { id: string; data?: string; message?: { message_id: number; chat?: { id?: number }; text?: string } };
    message?: { chat?: { id?: number }; text?: string };
  };
  try {
    update = await req.json();
  } catch {
    return ok();
  }

  // Message direct au bot : rappelle l'identifiant de la conversation (configuration).
  if (update.message?.chat?.id !== undefined && !update.callback_query) {
    await api("sendMessage", {
      chat_id: update.message.chat.id,
      text: `Biblio B1 : identifiant de cette conversation = ${update.message.chat.id}`,
    });
    return ok();
  }

  const cb = update.callback_query;
  if (!cb) return ok();
  const decision = parseDecision(cb.data);
  if (!decision || !isAdminChat(cb, adminChat)) {
    await api("answerCallbackQuery", { callback_query_id: cb.id, text: "Action non autorisée." });
    return ok();
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: target } = await admin.from("profiles").select("name, status").eq("id", decision.userId).maybeSingle();
  let outcome: string;
  if (!target) {
    outcome = "Compte introuvable (déjà refusé ?).";
  } else if (target.status !== "pending") {
    outcome = `${target.name} est déjà validé.`;
  } else if (decision.action === "approve") {
    const { error } = await admin.from("profiles").update({ status: "active" }).eq("id", decision.userId).eq("status", "pending");
    outcome = error ? "Validation impossible." : `✅ ${target.name} a accès au site.`;
  } else {
    const { error } = await admin.auth.admin.deleteUser(decision.userId);
    outcome = error ? "Refus impossible." : `❌ Demande de ${target.name} refusée.`;
  }

  await api("answerCallbackQuery", { callback_query_id: cb.id, text: outcome });
  if (cb.message) {
    // Le message garde son texte, sans les boutons, avec la décision prise.
    await api("editMessageText", {
      chat_id: cb.message.chat?.id,
      message_id: cb.message.message_id,
      text: `${escapeHtml(cb.message.text ?? "")}\n\n${escapeHtml(outcome)}`,
      parse_mode: "HTML",
    });
  }
  return ok();
});
