// Cœur des notifications ntfy, sans dépendance à Deno ni à Node (fetch injecté) : utilisé par
// l'Edge Function `notify` et testé par vitest. Le topic ntfy est un secret (quiconque le connaît
// lit les messages) : il ne vit que dans les secrets de la fonction, jamais dans le site.

export type NotifyEvent = "login" | "signup";

export type Notification = {
  title: string;
  message: string;
  tags: string[];
  /** Lien ouvert en touchant la notification. */
  click?: string;
};

const TIMEOUT_MS = 5000;

export function buildNotification(event: NotifyEvent, name: string): Notification {
  if (event === "signup") {
    return {
      title: "Biblio B1 : nouvelle demande de compte",
      message: `${name} demande un accès. Validez-le dans Administration → Demandes de compte.`,
      tags: ["bust_in_silhouette"],
    };
  }
  return { title: `Biblio B1 : ${name} s'est connecté`, message: `${name} vient de se connecter.`, tags: ["key"] };
}

export async function publishNtfy(
  n: Notification,
  opts: { topic?: string; url: string; fetchImpl: typeof fetch },
): Promise<boolean> {
  if (!opts.topic) return false;
  try {
    // Publication JSON (et non par en-têtes HTTP) : accents permis dans le titre.
    const res = await opts.fetchImpl(opts.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: opts.topic, title: n.title, message: n.message, tags: n.tags, click: n.click }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}
