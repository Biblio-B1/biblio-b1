import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CalendarError,
  decryptUrl,
  encryptUrl,
  fetchCalendarFeed,
  validateCalendarFeedUrl,
} from "../../supabase/functions/_shared/calendar-core";

const KEY = "a".repeat(64);
const ICS = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART:20261120T083000Z\r\nDTEND:20261120T103000Z\r\nSUMMARY:Cours\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

describe("chiffrement du lien (WebCrypto)", () => {
  it("aller-retour, sans le jeton en clair", async () => {
    const url = "https://planning.example.test/Edt.ics?icalsecurise=SECRET";
    const enc = await encryptUrl(url, KEY);
    expect(enc).not.toContain("SECRET");
    expect(enc.split(".")).toHaveLength(3);
    expect(await decryptUrl(enc, KEY)).toBe(url);
  });

  it("une valeur altérée est refusée", async () => {
    const [iv, tag, ct] = (await encryptUrl("https://x.example.test/a.ics", KEY)).split(".");
    const changed = `${iv}.${tag}.${ct[0] === "A" ? "B" : "A"}${ct.slice(1)}`;
    await expect(decryptUrl(changed, KEY)).rejects.toThrow(CalendarError);
  });

  it("relit un lien chiffré par l'ancien serveur Node (même format, même clé)", async () => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(KEY, "hex"), iv);
    const ct = Buffer.concat([cipher.update("https://old.example.test/a.ics", "utf8"), cipher.final()]);
    const legacy = [iv, cipher.getAuthTag(), ct].map((p) => p.toString("base64url")).join(".");
    expect(await decryptUrl(legacy, KEY)).toBe("https://old.example.test/a.ics");
  });
});

describe("validateCalendarFeedUrl", () => {
  it("refuse les adresses IP, http, identifiants et ports non standard", () => {
    for (const bad of [
      "https://127.0.0.1/x.ics",
      "https://10.0.0.2/x.ics",
      "http://planning.example.test/x.ics",
      "https://user:pw@planning.example.test/x.ics",
      "https://planning.example.test:8443/x.ics",
    ]) {
      expect(() => validateCalendarFeedUrl(bad), bad).toThrow(/HTTPS publique/);
    }
    expect(validateCalendarFeedUrl("https://planning.example.test/x.ics").hostname).toBe("planning.example.test");
  });
});

describe("fetchCalendarFeed", () => {
  const url = new URL("https://planning.example.test/x.ics");
  const ok = async () => new Response(ICS, { status: 200 });

  it("refuse un nom qui pointe vers une adresse privée", async () => {
    await expect(
      fetchCalendarFeed(url, { resolveDns: async () => ["10.0.0.2"], fetchImpl: ok as unknown as typeof fetch }),
    ).rejects.toThrow(/serveur HTTPS public/);
    await expect(
      fetchCalendarFeed(url, { resolveDns: async () => ["93.184.216.34", "169.254.169.254"], fetchImpl: ok as unknown as typeof fetch }),
    ).rejects.toThrow(/serveur HTTPS public/);
  });

  it("lit le flux d'un serveur public", async () => {
    const text = await fetchCalendarFeed(url, { resolveDns: async () => ["93.184.216.34"], fetchImpl: ok as unknown as typeof fetch });
    expect(text).toContain("BEGIN:VCALENDAR");
  });

  it("401/403/410 : reconnexion demandée", async () => {
    const denied = async () => new Response("", { status: 403 });
    await expect(
      fetchCalendarFeed(url, { resolveDns: async () => ["93.184.216.34"], fetchImpl: denied as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: "reauth_required" });
  });

  it("réponse trop grosse : refusée", async () => {
    const huge = async () => new Response("x".repeat(1_000_001), { status: 200 });
    await expect(
      fetchCalendarFeed(url, { resolveDns: async () => ["93.184.216.34"], fetchImpl: huge as unknown as typeof fetch }),
    ).rejects.toThrow(/taille maximale/);
  });
});
