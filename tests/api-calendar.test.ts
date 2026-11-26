import { describe, expect, it, vi } from "vitest";
import { callCalendar, mergeCalendars } from "@/lib/api/calendar";

describe("callCalendar", () => {
  it("transmet l'action et le lien à la fonction calendar", async () => {
    const invoke = vi.fn(async () => ({ data: { events: [], syncedAt: "2026-11-21T10:00:00Z" }, error: null }));
    const r = await callCalendar({ action: "link", url: "https://planning.example.test/a.ics" }, invoke);
    expect(invoke).toHaveBeenCalledWith("calendar", { body: { action: "link", url: "https://planning.example.test/a.ics" } });
    expect(r).toEqual({ ok: true, calendar: { events: [], syncedAt: new Date("2026-11-21T10:00:00Z"), sources: [] } });
  });

  it("délier : plus de calendrier", async () => {
    const invoke = vi.fn(async () => ({ data: { events: [], syncedAt: null }, error: null }));
    expect(await callCalendar({ action: "unlink" }, invoke)).toEqual({ ok: true, calendar: null });
  });

  it("erreur de la fonction : message et reconnexion demandée", async () => {
    const error = { context: { json: async () => ({ error: "Le lien a expiré.", code: "reauth_required" }) } };
    const invoke = vi.fn(async () => ({ data: null, error }));
    expect(await callCalendar({ action: "sync" }, invoke)).toEqual({ ok: false, error: "Le lien a expiré.", reauth: true });
  });

  it("erreur sans détail : message générique", async () => {
    const invoke = vi.fn(async () => ({ data: null, error: new Error("réseau") }));
    expect(await callCalendar({ action: "sync" }, invoke)).toMatchObject({ ok: false, reauth: false });
  });
});

describe("mergeCalendars", () => {
  const ev = (uid: string) => ({ uid, title: uid, start: "2026-11-23T08:00:00Z", end: "2026-11-23T09:00:00Z", allDay: false });
  it("Boostcamp seulement : un ancien lien Outlook est ignoré (calendrier retiré)", () => {
    const m = mergeCalendars([
      { source: "boostcamp", events: [ev("a")], synced_at: "2026-11-23T10:00:00Z" },
      { source: "outlook", events: [ev("b")], synced_at: "2026-11-23T09:00:00Z" },
    ]);
    expect(m?.events.map((e) => e.uid)).toEqual(["a"]);
    expect(m?.syncedAt).toEqual(new Date("2026-11-23T10:00:00Z"));
    expect(m?.sources.map((s) => s.source)).toEqual(["boostcamp"]);
    expect(mergeCalendars([{ source: "outlook", events: [ev("b")], synced_at: "2026-11-23T09:00:00Z" }])).toBeNull();
  });
  it("aucun calendrier lié : null", () => {
    expect(mergeCalendars([])).toBeNull();
  });
});
