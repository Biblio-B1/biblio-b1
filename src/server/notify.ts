// Notifications vers l'administrateur via ntfy (https://ntfy.sh) : application gratuite
// (Android, iPhone, navigateur) abonnée à un « topic ». Le nom du topic fait office de secret :
// quiconque le connaît peut lire les messages, d'où un nom long et aléatoire (NTFY_TOPIC).
// Sans NTFY_TOPIC, rien n'est envoyé. Un échec d'envoi n'interrompt jamais l'action en cours.
import { env } from "./env";

export type AdminNotification = {
  title: string;
  message: string;
  /** Lien ouvert en touchant la notification. */
  click?: string;
  tags?: string[];
};

const TIMEOUT_MS = 5000;

export async function notifyAdmin(n: AdminNotification, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const topic = env.NTFY_TOPIC;
  if (!topic) return false;
  try {
    // Publication JSON (et non par en-têtes HTTP) : accents permis dans le titre.
    const res = await fetchImpl(env.NTFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, title: n.title, message: n.message, click: n.click, tags: n.tags }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) console.warn(`[ntfy] envoi refusé : HTTP ${res.status}`);
    return res.ok;
  } catch (e) {
    console.warn(`[ntfy] envoi impossible : ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
