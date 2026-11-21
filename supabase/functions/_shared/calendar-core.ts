// Cœur des calendriers Boostcamp (.ics), sans dépendance à Deno ni à Node : validation du lien,
// lecture protégée (serveur HTTPS public uniquement, taille bornée), analyse ICS et chiffrement
// AES-256-GCM du lien (WebCrypto). Utilisé par l'Edge Function `calendar`, testé par vitest.
// Format du lien chiffré : base64url(iv).base64url(tag).base64url(texte chiffré) — identique à
// l'ancien serveur Node, ce qui permet de migrer les liens existants avec la même clé.

export const MAX_FEED_BYTES = 1_000_000;
export const MAX_EVENTS = 500;
const CALENDAR_ZONE = "Europe/Paris";
const FETCH_TIMEOUT_MS = 8_000;

export type CalendarEvent = {
  uid: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  status?: "confirmed" | "tentative" | "cancelled";
  categories?: string[];
  location?: string;
  description?: string;
  organizer?: string;
  lastModified?: string;
};

export class CalendarError extends Error {
  constructor(message: string, readonly code?: "reauth_required") {
    super(message);
    this.name = "CalendarError";
  }
}

// ---------------------------------------------------------------------------------------------
// Chiffrement du lien (WebCrypto, disponible dans Deno, Node 20+ et les navigateurs)
// ---------------------------------------------------------------------------------------------
const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function fromB64url(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function importKey(keyHex: string): Promise<CryptoKey> {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error("Clé de chiffrement invalide (64 caractères hexadécimaux attendus).");
  const raw = Uint8Array.from(keyHex.match(/../g)!, (h) => parseInt(h, 16));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptUrl(url: string, keyHex: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(keyHex), new TextEncoder().encode(url)),
  );
  // WebCrypto renvoie texte chiffré || tag (16 octets) : on les sépare pour garder l'ancien format.
  return [iv, sealed.slice(-16), sealed.slice(0, -16)].map(b64url).join(".");
}

export async function decryptUrl(value: string, keyHex: string): Promise<string> {
  const [iv, tag, ciphertext, extra] = value.split(".");
  if (!iv || !tag || !ciphertext || extra) {
    throw new CalendarError("Le lien du calendrier enregistré est illisible. Reliez votre calendrier.", "reauth_required");
  }
  try {
    const sealed = new Uint8Array([...fromB64url(ciphertext), ...fromB64url(tag)]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv) }, await importKey(keyHex), sealed);
    return new TextDecoder().decode(plain);
  } catch {
    throw new CalendarError(
      "Le lien du calendrier enregistré ne peut plus être lu (clé du serveur changée). Reliez votre calendrier.",
      "reauth_required",
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Validation et lecture du flux
// ---------------------------------------------------------------------------------------------
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const isIpLiteral = (host: string) => IPV4.test(host) || host.includes(":") || host.startsWith("[");

export function isPublicIpv4(address: string): boolean {
  const m = IPV4.exec(address);
  if (!m) return false;
  const [a, b, c] = m.slice(1, 4).map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

export function validateCalendarFeedUrl(raw: string): URL {
  if (raw.length > 2048) throw new CalendarError("Le lien du calendrier est trop long.");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new CalendarError("Saisissez un lien iCalendar valide.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    isIpLiteral(url.hostname)
  ) {
    throw new CalendarError("Le lien doit être une URL HTTPS publique, sans identifiant intégré.");
  }
  return url;
}

/**
 * Récupère le flux : toutes les adresses du nom doivent être publiques (pas de réseau interne ni
 * d'adresse de métadonnées), pas de redirection suivie, réponse bornée à MAX_FEED_BYTES.
 */
export async function fetchCalendarFeed(
  url: URL,
  deps: { resolveDns: (host: string) => Promise<string[]>; fetchImpl: typeof fetch },
): Promise<string> {
  let addresses: string[];
  try {
    addresses = await deps.resolveDns(url.hostname);
  } catch {
    throw new CalendarError("Le serveur du calendrier est introuvable.");
  }
  if (addresses.length === 0 || !addresses.every(isPublicIpv4)) {
    throw new CalendarError("Le lien doit pointer vers un serveur HTTPS public.");
  }
  let res: Response;
  try {
    res = await deps.fetchImpl(url, {
      headers: { Accept: "text/calendar, text/plain;q=0.9" },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new CalendarError("Impossible de récupérer le calendrier.");
  }
  if (res.status === 401 || res.status === 403 || res.status === 410) {
    throw new CalendarError("Le lien a expiré ou n'est plus autorisé. Collez un nouveau lien iCalendar.", "reauth_required");
  }
  if (res.status !== 200 || !res.body) throw new CalendarError("Le serveur n'a pas fourni le calendrier (réponse HTTP invalide).");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_FEED_BYTES) {
      await reader.cancel();
      throw new CalendarError("Le calendrier dépasse la taille maximale autorisée.");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(all);
}

// ---------------------------------------------------------------------------------------------
// Analyse ICS (reprise de l'ancien serveur)
// ---------------------------------------------------------------------------------------------

/** Supprime le bloc « Contenu pédagogique de cette séance : ... » et son HTML Boostcamp/Hyperplanning. */
export function cleanEventDescription(description: string): string {
  return description.replace(/\n*Contenu pédagogique de cette séance\s*:[\s\S]*$/i, "").trim();
}

function parseIcsDate(value: string, tzid?: string): number {
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date) return Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]));
  const time = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
  if (!time) throw new CalendarError("Le calendrier contient une date non prise en charge.");
  const [year, month, day, hour, minute, second] = time.slice(1, 7).map((part) => Number(part ?? 0));
  const wallTime = Date.UTC(year, month - 1, day, hour, minute, second);
  if (time[7]) return wallTime;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tzid || CALENDAR_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    let result = wallTime;
    for (let i = 0; i < 2; i++) {
      const local = Object.fromEntries(formatter.formatToParts(new Date(result)).map((p) => [p.type, Number(p.value)]));
      const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
      result = wallTime - (represented - result);
    }
    return result;
  } catch {
    throw new CalendarError("Le calendrier utilise un fuseau horaire inconnu.");
  }
}

const unescapeIcsText = (value: string) => value.replace(/\\[nN]/g, "\n").replace(/\\([\\,;])/g, "$1");

export function parseCalendar(ics: string): CalendarEvent[] {
  if (new TextEncoder().encode(ics).length > MAX_FEED_BYTES) {
    throw new CalendarError("Le calendrier dépasse la taille maximale autorisée.");
  }
  const lines = ics.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const unfolded: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) unfolded[unfolded.length - 1] += line.slice(1);
    else unfolded.push(line);
  }
  if (!unfolded.includes("BEGIN:VCALENDAR") || !unfolded.includes("END:VCALENDAR")) {
    throw new CalendarError("La réponse n'est pas un calendrier iCalendar valide.");
  }

  const events: CalendarEvent[] = [];
  let current: Map<string, { value: string; params: Map<string, string> }> | null = null;
  for (const line of unfolded) {
    if (line === "BEGIN:VEVENT") {
      current = new Map();
      continue;
    }
    if (line === "END:VEVENT") {
      if (!current) continue;
      const startProp = current.get("DTSTART");
      if (!startProp) {
        current = null;
        continue;
      }
      if (current.has("RRULE") || current.has("RDATE")) {
        throw new CalendarError("Le flux contient des événements récurrents. Utilisez un export qui fournit leurs occurrences.");
      }
      const allDay = startProp.params.get("VALUE")?.toUpperCase() === "DATE" || /^\d{8}$/.test(startProp.value);
      const startMs = parseIcsDate(startProp.value, startProp.params.get("TZID"));
      const endProp = current.get("DTEND");
      const endMs = endProp
        ? parseIcsDate(endProp.value, endProp.params.get("TZID"))
        : allDay
          ? startMs + 24 * 60 * 60 * 1000
          : startMs;
      if (endMs < startMs) throw new CalendarError("Le calendrier contient une durée invalide.");
      const uid = current.get("UID")?.value ?? `event-${events.length}`;
      const title = unescapeIcsText(current.get("SUMMARY")?.value ?? "Événement sans titre").slice(0, 300);
      const categories = unescapeIcsText(current.get("CATEGORIES")?.value ?? "")
        .split(",")
        .map((category) => category.trim())
        .filter(Boolean)
        .slice(0, 10);
      const location = unescapeIcsText(current.get("LOCATION")?.value ?? "").slice(0, 300);
      const description = cleanEventDescription(unescapeIcsText(current.get("DESCRIPTION")?.value ?? "")).slice(0, 4000);
      const organizerProp = current.get("ORGANIZER");
      const organizer = unescapeIcsText(
        organizerProp?.params.get("CN") ?? organizerProp?.value.replace(/^mailto:/i, "") ?? "",
      ).slice(0, 200);
      const modifiedProp = current.get("LAST-MODIFIED");
      const lastModified = modifiedProp
        ? new Date(parseIcsDate(modifiedProp.value, modifiedProp.params.get("TZID"))).toISOString()
        : undefined;
      const rawStatus = current.get("STATUS")?.value.toUpperCase();
      const status = rawStatus === "CANCELLED" ? "cancelled" : rawStatus === "TENTATIVE" ? "tentative" : "confirmed";
      events.push({
        uid: uid.slice(0, 300),
        title,
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
        allDay,
        status,
        categories,
        ...(location ? { location } : {}),
        ...(description ? { description } : {}),
        ...(organizer ? { organizer } : {}),
        ...(lastModified ? { lastModified } : {}),
      });
      if (events.length > MAX_EVENTS) throw new CalendarError("Le calendrier contient trop d'événements.");
      current = null;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const [property, ...rawParams] = line.slice(0, colon).split(";");
    const params = new Map<string, string>();
    for (const item of rawParams) {
      const separator = item.indexOf("=");
      if (separator > 0) params.set(item.slice(0, separator).toUpperCase(), item.slice(separator + 1).replace(/^"|"$/g, ""));
    }
    current.set(property.toUpperCase(), { value: line.slice(colon + 1), params });
  }
  if (current) throw new CalendarError("Le calendrier contient un événement incomplet.");
  return events.sort((a, b) => a.start.localeCompare(b.start));
}
