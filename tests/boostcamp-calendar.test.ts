import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptCalendarUrl,
  encryptCalendarUrl,
  parseCalendar,
  validateCalendarFeedUrl,
} from "@/server/boostcamp/calendar";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseCalendar", () => {
  it("déplie les lignes ICS, convertit les dates et ignore les événements annulés", () => {
    const events = parseCalendar([
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:class-1",
      "DTSTART;TZID=Europe/Paris:20261123T090000",
      "DTEND;TZID=Europe/Paris:20261123T103000",
      "SUMMARY:Cours de programmation qui continue",
      "  sur la ligne suivante",
      "CATEGORIES:Programmation",
      "LOCATION:Salle B12",
      "ORGANIZER;CN=Alex Martin:mailto:alex@example.org",
      "DESCRIPTION:Apporter le TP\\nGroupe B",
      "LAST-MODIFIED:20261122T150000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:cancelled",
      "DTSTART:20261124T090000Z",
      "STATUS:CANCELLED",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n"));

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      uid: "class-1",
      title: "Cours de programmation qui continue sur la ligne suivante",
      start: "2026-11-23T08:00:00.000Z",
      end: "2026-11-23T09:30:00.000Z",
      allDay: false,
      categories: ["Programmation"],
      location: "Salle B12",
      organizer: "Alex Martin",
      description: "Apporter le TP\nGroupe B",
      lastModified: "2026-11-22T15:00:00.000Z",
    });
    expect(events[1]).toMatchObject({ uid: "cancelled", status: "cancelled" });
  });

  it("gère les événements sur une journée entière", () => {
    const events = parseCalendar([
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:day-1",
      "DTSTART;VALUE=DATE:20261123",
      "DTEND;VALUE=DATE:20261124",
      "SUMMARY:Jour de révision",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n"));

    expect(events[0]).toMatchObject({
      start: "2026-11-23T00:00:00.000Z",
      end: "2026-11-24T00:00:00.000Z",
      allDay: true,
    });
  });

  it("supprime le bloc HTML 'Contenu pédagogique de cette séance' des descriptions", () => {
    const events = parseCalendar([
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:clean-1",
      "DTSTART:20261124T083000Z",
      "DTEND:20261124T103000Z",
      "SUMMARY:Data",
      "DESCRIPTION:Matière : Infrastructures et Systèmes pour la Data\\nSalle : EM215\\n\\nContenu pédagogique de cette séance : \\n<span style=\"font-weight:bold;\">contenu</span><br /><div class=\"teams\"></div><div class=\"sws\">SoWeSign</div><div class=\"hp\">Svp, ajoutez vos documents ici...</div>\\n",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n"));

    expect(events[0].description).toBe("Matière : Infrastructures et Systèmes pour la Data\nSalle : EM215");
  });

  it("refuse les réponses qui ne sont pas un calendrier", () => {
    expect(() => parseCalendar("<html>login required</html>")).toThrow(/iCalendar valide/);
  });

  it("n’accepte que les liens HTTPS publics sans identifiant intégré", () => {
    expect(validateCalendarFeedUrl("https://calendar.example.test/private.ics").protocol).toBe("https:");
    expect(() => validateCalendarFeedUrl("http://calendar.example.test/private.ics")).toThrow(/HTTPS publique/);
    expect(() => validateCalendarFeedUrl("https://user:pass@calendar.example.test/feed.ics")).toThrow(/HTTPS publique/);
    expect(() => validateCalendarFeedUrl("https://127.0.0.1/feed.ics")).toThrow(/HTTPS publique/);
    expect(() => validateCalendarFeedUrl("https://calendar.example.test:8443/feed.ics")).toThrow(/HTTPS publique/);
  });
});

describe("calendar URL encryption", () => {
  it("chiffre le lien et détecte toute altération", () => {
    vi.stubEnv("CALENDAR_ENCRYPTION_KEY", "a".repeat(64));
    const url = "https://calendar.example.test/private?token=secret";
    const encrypted = encryptCalendarUrl(url);
    expect(encrypted).not.toContain("secret");
    expect(decryptCalendarUrl(encrypted)).toBe(url);

    const [iv, tag, ciphertext] = encrypted.split(".");
    const changedCiphertext = `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
    const changed = `${iv}.${tag}.${changedCiphertext}`;
    expect(() => decryptCalendarUrl(changed)).toThrow(/ne peut plus être lu/);
  });
});

describe("clé de chiffrement sans configuration", () => {
  it("génère une clé dans STORAGE_PATH/calendar.key, la réutilise et permet de relire les liens", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb1-calkey-"));
    try {
      vi.stubEnv("CALENDAR_ENCRYPTION_KEY", "");
      vi.stubEnv("STORAGE_PATH", dir);
      vi.resetModules();
      const first = await import("@/server/boostcamp/calendar");
      const url = "https://calendar.example.test/private?token=secret";
      const encrypted = first.encryptCalendarUrl(url);
      const file = path.join(dir, "calendar.key");
      expect(fs.readFileSync(file, "utf8")).toMatch(/^[0-9a-f]{64}$/);

      // Redémarrage du serveur : nouvelle instance du module, même fichier → lien toujours lisible.
      vi.resetModules();
      const second = await import("@/server/boostcamp/calendar");
      expect(second.decryptCalendarUrl(encrypted)).toBe(url);
    } finally {
      vi.resetModules();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
