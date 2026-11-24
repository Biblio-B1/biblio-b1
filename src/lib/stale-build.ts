// Après une mise en ligne, un onglet resté ouvert demande des fichiers de l'ancienne version, qui
// n'existent plus : la navigation échoue (ChunkLoadError). Un rechargement complet suffit.

const KEY = "bb1-stale-reload";
const MIN_INTERVAL_MS = 30_000;

/** Erreur de chargement d'un morceau du site (version périmée). */
export function isStaleBuildError(error: { name?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.name === "ChunkLoadError") return true;
  return /loading (css )?chunk [\w-]+ failed|failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i.test(
    error.message ?? "",
  );
}

/**
 * Recharge la page une fois. Renvoie false si un rechargement vient déjà d'avoir lieu (moins de
 * 30 s) : l'erreur ne vient alors pas d'une version périmée, on n'insiste pas (pas de boucle).
 */
export function reloadOnce(now = Date.now(), storage: Pick<Storage, "getItem" | "setItem"> | null = safeSession()): boolean {
  const last = storage?.getItem(KEY);
  if (last && now - Number(last) < MIN_INTERVAL_MS) return false;
  try {
    storage?.setItem(KEY, String(now));
  } catch {
    // stockage indisponible : on recharge quand même
  }
  return true;
}

function safeSession(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
