import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import tls from "node:tls";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/server/env";
import type { Db } from "@/server/db/client";
import { boostcampCalendarLinks } from "@/server/db/schema";
import type { ScheduleEvent } from "@/lib/calendar-view";

const MAX_FEED_BYTES = 1_000_000;
const MAX_EVENTS = 500;
const CACHE_MS = 50_000;
const CALENDAR_ZONE = "Europe/Paris";

export type CalendarEvent = ScheduleEvent;

const eventsSchema = z.array(
  z.object({
    uid: z.string(),
    title: z.string(),
    start: z.string().datetime(),
    end: z.string().datetime(),
    allDay: z.boolean(),
    status: z.enum(["confirmed", "tentative", "cancelled"]).default("confirmed"),
    categories: z.array(z.string()).default([]),
    location: z.string().optional(),
    description: z.string().optional(),
    organizer: z.string().optional(),
    lastModified: z.string().datetime().optional(),
  }),
);

export class CalendarError extends Error {
  constructor(message: string, readonly code?: "reauth_required") {
    super(message);
    this.name = "CalendarError";
  }
}

function encryptionKey(): Buffer {
  const key = env.CALENDAR_ENCRYPTION_KEY;
  if (!key) throw new CalendarError("La synchronisation du calendrier n’est pas configurée par l’administrateur.");
  return Buffer.from(key, "hex");
}

export function encryptCalendarUrl(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptCalendarUrl(value: string): string {
  const [iv, tag, ciphertext, extra] = value.split(".");
  if (!iv || !tag || !ciphertext || extra) {
    throw new CalendarError("Le lien du calendrier enregistré est illisible. Supprimez-le puis reliez-le à nouveau.");
  }
  const key = encryptionKey();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new CalendarError("Impossible de déchiffrer le lien du calendrier. Vérifiez CALENDAR_ENCRYPTION_KEY.");
  }
}

function isPublicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a === 255) return false;
  return true;
}

export function validateCalendarFeedUrl(raw: string): URL {
  if (raw.length > 2048) throw new CalendarError("Le lien du calendrier est trop long.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CalendarError("Saisissez un lien iCalendar valide.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    isIP(url.hostname)
  ) {
    throw new CalendarError("Le lien doit être une URL HTTPS publique, sans identifiant intégré.");
  }
  return url;
}

async function fetchCalendar(url: URL): Promise<string> {
  let addresses: import("node:dns").LookupAddress[];
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new CalendarError("Le serveur du calendrier est introuvable.");
  }
  const publicAddresses = addresses.filter((entry) => isPublicIpv4(entry.address));
  if (publicAddresses.length === 0) {
    throw new CalendarError("Le lien doit pointer vers un serveur HTTPS public.");
  }

  const address = publicAddresses[0].address;
  return new Promise((resolve, reject) => {
    const request = https.get(
      {
        hostname: address,
        port: 443,
        path: `${url.pathname}${url.search}`,
        servername: url.hostname,
        checkServerIdentity: (_hostname, certificate) => tls.checkServerIdentity(url.hostname, certificate),
        headers: {
          Host: url.host,
          Accept: "text/calendar, text/plain;q=0.9",
        },
        timeout: 8_000,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          if (response.statusCode === 401 || response.statusCode === 403 || response.statusCode === 410) {
            reject(new CalendarError("Le lien du proxy a expiré ou n’est plus autorisé. Collez un nouveau lien iCalendar.", "reauth_required"));
            return;
          }
          reject(new CalendarError("Boostcamp n’a pas fourni le calendrier (réponse HTTP invalide)."));
          return;
        }
        const chunks: Buffer[] = [];
        let length = 0;
        response.on("data", (chunk: Buffer | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          length += bytes.length;
          if (length > MAX_FEED_BYTES) {
            request.destroy(new CalendarError("Le calendrier dépasse la taille maximale autorisée."));
            return;
          }
          chunks.push(bytes);
        });
        response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        response.on("error", () => reject(new CalendarError("La lecture du calendrier a échoué.")));
      },
    );
    request.on("timeout", () => request.destroy(new CalendarError("Le serveur du calendrier ne répond pas à temps.")));
    request.on("error", (error) => {
      reject(error instanceof CalendarError ? error : new CalendarError("Impossible de récupérer le calendrier."));
    });
  });
}

function parseIcsDate(value: string, tzid?: string): number {
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date) return Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]));
  const time = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
  if (!time) throw new CalendarError("Le calendrier contient une date non prise en charge.");
  const parts = time.slice(1, 7).map((part) => Number(part ?? 0));
  const [year, month, day, hour, minute, second] = parts;
  const wallTime = Date.UTC(year, month - 1, day, hour, minute, second);
  if (time[7]) return wallTime;

  const zone = tzid || CALENDAR_ZONE;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
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
      const local = Object.fromEntries(
        formatter.formatToParts(new Date(result)).map((part) => [part.type, Number(part.value)]),
      );
      const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
      result = wallTime - (represented - result);
    }
    return result;
  } catch {
    throw new CalendarError("Le calendrier utilise un fuseau horaire inconnu.");
  }
}

function unescapeIcsText(value: string): string {
  return value.replace(/\\[nN]/g, "\n").replace(/\\([\\,;])/g, "$1");
}

export function parseCalendar(ics: string): CalendarEvent[] {
  if (Buffer.byteLength(ics, "utf8") > MAX_FEED_BYTES) {
    throw new CalendarError("Le calendrier dépasse la taille maximale autorisée.");
  }
  const lines = ics.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const unfolded: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) unfolded[unfolded.length - 1] += line.slice(1);
    else unfolded.push(line);
  }
  if (!unfolded.includes("BEGIN:VCALENDAR") || !unfolded.includes("END:VCALENDAR")) {
    throw new CalendarError("La réponse n’est pas un calendrier iCalendar valide.");
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
      const description = unescapeIcsText(current.get("DESCRIPTION")?.value ?? "").slice(0, 4000);
      const organizerProp = current.get("ORGANIZER");
      const organizer = unescapeIcsText(
        organizerProp?.params.get("CN") ?? organizerProp?.value.replace(/^mailto:/i, "") ?? "",
      ).slice(0, 200);
      const modifiedProp = current.get("LAST-MODIFIED");
      const lastModified = modifiedProp
        ? new Date(parseIcsDate(modifiedProp.value, modifiedProp.params.get("TZID"))).toISOString()
        : undefined;
      const status = current.get("STATUS")?.value.toUpperCase() === "CANCELLED"
        ? "cancelled"
        : current.get("STATUS")?.value.toUpperCase() === "TENTATIVE"
          ? "tentative"
          : "confirmed";
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
      if (events.length > MAX_EVENTS) throw new CalendarError("Le calendrier contient trop d’événements.");
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
      if (separator > 0) {
        params.set(item.slice(0, separator).toUpperCase(), item.slice(separator + 1).replace(/^"|"$/g, ""));
      }
    }
    current.set(property.toUpperCase(), { value: line.slice(colon + 1), params });
  }
  if (current) throw new CalendarError("Le calendrier contient un événement incomplet.");
  return events.sort((a, b) => a.start.localeCompare(b.start));
}

function readStoredEvents(raw: string): CalendarEvent[] {
  const parsed = eventsSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new CalendarError("Les événements enregistrés sont invalides. Synchronisez à nouveau.");
  return parsed.data;
}

async function readAndStore(db: Db, userId: string, encryptedUrl: string): Promise<CalendarEvent[]> {
  const url = validateCalendarFeedUrl(decryptCalendarUrl(encryptedUrl));
  const events = parseCalendar(await fetchCalendar(url));
  db.update(boostcampCalendarLinks)
    .set({ eventsJson: JSON.stringify(events), syncedAt: new Date() })
    .where(eq(boostcampCalendarLinks.userId, userId))
    .run();
  return events;
}

export async function linkCalendar(db: Db, userId: string, rawUrl: string): Promise<CalendarEvent[]> {
  const url = validateCalendarFeedUrl(rawUrl);
  encryptionKey();
  const events = parseCalendar(await fetchCalendar(url));
  const encryptedUrl = encryptCalendarUrl(url.toString());
  db.insert(boostcampCalendarLinks)
    .values({
      userId,
      encryptedUrl,
      eventsJson: JSON.stringify(events),
      syncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: boostcampCalendarLinks.userId,
      set: {
        encryptedUrl,
        eventsJson: JSON.stringify(events),
        syncedAt: new Date(),
      },
    })
    .run();
  return events;
}

export async function getCalendar(
  db: Db,
  userId: string,
  forceSync = false,
): Promise<{ events: CalendarEvent[]; syncedAt: Date } | null> {
  const row = db
    .select({
      encryptedUrl: boostcampCalendarLinks.encryptedUrl,
      eventsJson: boostcampCalendarLinks.eventsJson,
      syncedAt: boostcampCalendarLinks.syncedAt,
    })
    .from(boostcampCalendarLinks)
    .where(eq(boostcampCalendarLinks.userId, userId))
    .get();
  if (!row) return null;

  const events = readStoredEvents(row.eventsJson);
  if (!forceSync && Date.now() - row.syncedAt.getTime() < CACHE_MS) {
    return { events, syncedAt: row.syncedAt };
  }
  const fresh = await readAndStore(db, userId, row.encryptedUrl);
  return { events: fresh, syncedAt: new Date() };
}

export function getStoredCalendar(
  db: Db,
  userId: string,
): { events: CalendarEvent[]; syncedAt: Date } | null {
  const row = db
    .select({
      eventsJson: boostcampCalendarLinks.eventsJson,
      syncedAt: boostcampCalendarLinks.syncedAt,
    })
    .from(boostcampCalendarLinks)
    .where(eq(boostcampCalendarLinks.userId, userId))
    .get();
  return row ? { events: readStoredEvents(row.eventsJson), syncedAt: row.syncedAt } : null;
}

export function unlinkCalendar(db: Db, userId: string): void {
  db.delete(boostcampCalendarLinks)
    .where(eq(boostcampCalendarLinks.userId, userId))
    .run();
}
