// Edge Function `telegram` : webhook du bot. Applique les boutons « Accepter » / « Refuser » d'une
// demande de compte. Appelée par Telegram (pas de jeton Supabase : verify_jwt = false), elle exige :
//  - l'en-tête X-Telegram-Bot-Api-Secret-Token = TELEGRAM_WEBHOOK_SECRET (défini à setWebhook) ;
//  - un clic venant de la conversation de l'administrateur (TELEGRAM_CHAT_ID).
// Accepter = profil « active » ; Refuser = suppression du compte, seulement s'il est encore en attente.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  channelChoiceKeyboard,
  escapeHtml,
  isAdminChat,
  parseChannelChoice,
  parseDecision,
  statusKeyboard,
  telegramApi,
} from "../_shared/telegram-core.ts";

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
    message?: { chat?: { id?: number; type?: string; title?: string }; text?: string };
    channel_post?: { chat: { id: number; type: string; title?: string }; text?: string };
    my_chat_member?: { chat: { id: number; type: string; title?: string }; new_chat_member?: { status?: string } };
  };
  try {
    update = await req.json();
  } catch {
    return ok();
  }

  /** Propose à l'administrateur (conversation privée) de publier dans ce canal ou ce groupe. */
  const offerChannel = async (chat: { id: number; type: string; title?: string }) => {
    if (!adminChat) return;
    const kind = chat.type === "channel" ? "canal" : "groupe";
    await api("sendMessage", {
      chat_id: adminChat,
      parse_mode: "HTML",
      text: `📢 Le bot peut publier dans le ${kind} <b>${escapeHtml(chat.title ?? String(chat.id))}</b>.\nY envoyer les notifications de la classe (documents, devoirs, contrôles, emploi du temps) ?`,
      reply_markup: channelChoiceKeyboard(chat.id),
    });
  };
  const isRoom = (type: string | undefined) => type === "channel" || type === "group" || type === "supergroup";

  // Le bot vient d'être ajouté à un canal ou un groupe (ou y change de droits).
  const member = update.my_chat_member;
  if (member) {
    const status = member.new_chat_member?.status ?? "";
    // Trace du dernier événement (diagnostic de la configuration, sans contenu de message).
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await db.from("app_settings").upsert({
      key: "telegram_last_chat_member",
      value: { type: member.chat.type, status, at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    });
    if (isRoom(member.chat.type) && (status === "administrator" || (member.chat.type !== "channel" && status === "member"))) {
      await offerChannel(member.chat);
    }
    return ok();
  }

  // Secours : « /relier » écrit dans le canal ou le groupe renvoie le bouton à l'administrateur.
  const post = update.channel_post ?? (isRoom(update.message?.chat?.type) ? update.message : undefined);
  if (post?.chat && isRoom(post.chat.type)) {
    if (/^\/relier(@\w+)?\b/i.test(post.text ?? "")) await offerChannel(post.chat as { id: number; type: string; title?: string });
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
  if (cb.data === "done") {
    await api("answerCallbackQuery", { callback_query_id: cb.id, text: "Demande déjà traitée." });
    return ok();
  }
  const channelId = parseChannelChoice(cb.data);
  if (channelId) {
    if (!isAdminChat(cb, adminChat)) {
      await api("answerCallbackQuery", { callback_query_id: cb.id, text: "Action non autorisée." });
      return ok();
    }
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error } = await db
      .from("app_settings")
      .upsert({ key: "telegram_channel_id", value: channelId, updated_at: new Date().toISOString() });
    const welcome = error
      ? { ok: false }
      : await api("sendMessage", {
          chat_id: channelId,
          parse_mode: "HTML",
          text: "👋 <b>Biblio B1</b> publiera ici les nouveaux documents, les devoirs, les alertes de contrôle et les changements d'emploi du temps.",
        });
    await api("answerCallbackQuery", {
      callback_query_id: cb.id,
      text: error ? "Enregistrement impossible, réessayez." : welcome.ok ? "Canal relié." : "Canal enregistré, mais le bot ne peut pas y écrire : vérifiez son droit de publier.",
    });
    if (!error && cb.message) {
      await api("editMessageReplyMarkup", {
        chat_id: cb.message.chat?.id,
        message_id: cb.message.message_id,
        reply_markup: statusKeyboard("✅ Canal relié"),
      });
    }
    return ok();
  }

  const decision = parseDecision(cb.data);
  if (!decision || !isAdminChat(cb, adminChat)) {
    await api("answerCallbackQuery", { callback_query_id: cb.id, text: "Action non autorisée." });
    return ok();
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: target } = await admin.from("profiles").select("name, status").eq("id", decision.userId).maybeSingle();
  let outcome: string;
  let status: string | null = null; // libellé du bouton d'état ; null = boutons gardés (erreur)
  if (!target) {
    outcome = "Compte introuvable (déjà refusé ?).";
    status = "Demande déjà traitée";
  } else if (target.status !== "pending") {
    outcome = `${target.name} est déjà validé.`;
    status = "✅ Accepté";
  } else if (decision.action === "approve") {
    const { error } = await admin.from("profiles").update({ status: "active" }).eq("id", decision.userId).eq("status", "pending");
    outcome = error ? "Validation impossible, réessayez." : `✅ ${target.name} a accès au site.`;
    if (!error) status = "✅ Accepté";
  } else {
    const { error } = await admin.auth.admin.deleteUser(decision.userId);
    outcome = error ? "Refus impossible, réessayez." : `❌ Demande de ${target.name} refusée.`;
    if (!error) status = "❌ Refusé";
  }

  await api("answerCallbackQuery", { callback_query_id: cb.id, text: outcome });
  if (cb.message && status) {
    // Le message garde sa mise en forme ; les boutons laissent place à l'état de la demande.
    await api("editMessageReplyMarkup", {
      chat_id: cb.message.chat?.id,
      message_id: cb.message.message_id,
      reply_markup: statusKeyboard(status),
    });
  }
  return ok();
});
