// Session de 15 minutes sans activité : au-delà, déconnexion et retour à la page de connexion.
// L'heure de la dernière activité est gardée dans localStorage (partagée entre onglets, et relue à la
// réouverture du site). Supabase gratuit n'a pas de délai d'inactivité côté serveur : il est appliqué
// ici, côté navigateur.

export const INACTIVITY_MS = 15 * 60_000;
export const LAST_ACTIVITY_KEY = "bb1-last-activity";
/** Fréquence de vérification de l'échéance. */
const CHECK_EVERY_MS = 30_000;

export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type InactivityTracker = {
  /** Enregistre une activité (clic, touche, navigation). */
  touch(): void;
  isExpired(): boolean;
  /** Vérifie tout de suite puis régulièrement ; renvoie la fonction d'arrêt. */
  start(): () => void;
  /** Oublie la dernière activité (déconnexion). */
  clear(): void;
};

export function createInactivityTracker(opts: {
  now: () => number;
  storage: KeyValueStorage;
  onExpire: () => void;
  timeoutMs?: number;
}): InactivityTracker {
  const timeoutMs = opts.timeoutMs ?? INACTIVITY_MS;
  let memory: number | null = null;

  const read = (): number | null => {
    try {
      const raw = opts.storage.getItem(LAST_ACTIVITY_KEY);
      const value = raw === null ? null : Number(raw);
      if (value !== null && Number.isFinite(value)) return Math.max(value, memory ?? value);
    } catch {
      // stockage indisponible : la mémoire de cet onglet fait foi
    }
    return memory;
  };

  const touch = () => {
    memory = opts.now();
    try {
      opts.storage.setItem(LAST_ACTIVITY_KEY, String(memory));
    } catch {
      // idem
    }
  };

  const isExpired = () => {
    const last = read();
    return last !== null && opts.now() - last >= timeoutMs;
  };

  let expired = false;
  const check = () => {
    if (!expired && isExpired()) {
      expired = true;
      opts.onExpire();
    }
  };

  return {
    touch,
    isExpired,
    start() {
      expired = false;
      if (read() === null) touch();
      check();
      const id = setInterval(check, CHECK_EVERY_MS);
      return () => clearInterval(id);
    },
    clear() {
      memory = null;
      try {
        opts.storage.removeItem(LAST_ACTIVITY_KEY);
      } catch {
        // idem
      }
    },
  };
}
