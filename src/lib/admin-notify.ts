// Alertes « nouvelle demande de compte » sur le site (administrateur) : notifications du navigateur
// activées par l'administrateur, et mémoire des demandes déjà signalées (pas de doublon).
const ENABLED_KEY = "bb1-admin-notify";
const SEEN_KEY = "bb1-seen-requests";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function browserNotificationsOn(): boolean {
  return notificationsSupported() && Notification.permission === "granted" && storage()?.getItem(ENABLED_KEY) === "1";
}

export async function enableBrowserNotifications(): Promise<"granted" | "denied" | "default" | "unsupported"> {
  if (!notificationsSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission === "granted") storage()?.setItem(ENABLED_KEY, "1");
  return permission;
}

export function disableBrowserNotifications(): void {
  storage()?.removeItem(ENABLED_KEY);
}

/**
 * Demandes à signaler : celles absentes de la liste mémorisée. Au tout premier passage (rien en
 * mémoire), rien n'est signalé en notification : la bannière suffit pour l'existant.
 */
export function newRequests<T extends { id: string }>(requests: T[], seen: string[] | null): T[] {
  if (seen === null) return [];
  return requests.filter((r) => !seen.includes(r.id));
}

export function loadSeen(): string[] | null {
  const raw = storage()?.getItem(SEEN_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

export function saveSeen(ids: string[]): void {
  storage()?.setItem(SEEN_KEY, JSON.stringify(ids.slice(-200)));
}
