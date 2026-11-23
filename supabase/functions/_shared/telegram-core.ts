// Notifications de l'administrateur par un bot Telegram (sans dépendance Deno ni Node, fetch injecté).
// Pourquoi Telegram : ntfy.sh limite par adresse IP et les fonctions Supabase sortent par des IP
// partagées (quota épuisé, erreur 429). L'API des bots Telegram n'a pas ce problème.
// Une demande de compte arrive avec des boutons « Accepter » / « Refuser » : la fonction `telegram`
// (webhook du bot) applique la décision, seulement si elle vient de la conversation de l'admin.

export type TelegramEvent = "login" | "signup";

export type TelegramMessage = {
  text: string;
  reply_markup?: { inline_keyboard: ({ text: string; callback_data: string } | { text: string; url: string })[][] };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 5000;

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** « lundi 23 novembre à 14:05 », heure de Paris. */
export function formatWhen(at: Date): string {
  const day = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long" }).format(at);
  const time = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(at);
  return `${day} à ${time}`;
}

export function buildTelegramMessage(p: {
  event: TelegramEvent;
  name: string;
  email: string;
  userId: string;
  appUrl: string;
  at?: Date;
}): TelegramMessage {
  // Fiche lisible d'un coup d'œil : titre, nom en gras, e-mail, date et heure.
  const card = [`👤 <b>${escapeHtml(p.name)}</b>`, `✉️ ${escapeHtml(p.email)}`, `🕒 ${formatWhen(p.at ?? new Date())}`];
  if (p.event === "login") return { text: ["🟢 <b>Connexion à Biblio B1</b>", "", ...card].join("\n") };
  return {
    text: ["🆕 <b>Nouvelle demande de compte</b>", "", ...card, "", "Accepter ou refuser ?"].join("\n"),
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Accepter", callback_data: `approve:${p.userId}` },
          { text: "❌ Refuser", callback_data: `reject:${p.userId}` },
        ],
        [{ text: "Ouvrir les demandes", url: `${p.appUrl}/admin/users/` }],
      ],
    },
  };
}

/** Décision lue dans un bouton : `approve:<uuid>` ou `reject:<uuid>`, rien d'autre. */
export function parseDecision(data: string | undefined): { action: "approve" | "reject"; userId: string } | null {
  const m = /^(approve|reject):(.+)$/.exec(data ?? "");
  if (!m || !UUID.test(m[2])) return null;
  return { action: m[1] as "approve" | "reject", userId: m[2] };
}

/** La décision vient-elle de la conversation de l'administrateur (TELEGRAM_CHAT_ID) ? */
export function isAdminChat(callback: { message?: { chat?: { id?: number | string } } }, adminChatId: string): boolean {
  const id = callback.message?.chat?.id;
  return !!adminChatId && id !== undefined && String(id) === adminChatId;
}

export async function telegramApi(
  method: string,
  body: Record<string, unknown>,
  opts: { token: string; fetchImpl: typeof fetch },
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await opts.fetchImpl(`https://api.telegram.org/bot${opts.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendTelegram(
  m: TelegramMessage,
  opts: { token: string; chatId: string; fetchImpl: typeof fetch },
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!opts.token || !opts.chatId) return { ok: false, error: "TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID absent" };
  return telegramApi("sendMessage", { chat_id: opts.chatId, text: m.text, parse_mode: "HTML", reply_markup: m.reply_markup }, opts);
}
