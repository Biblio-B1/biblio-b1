import { describe, expect, it } from "vitest";
import { createTestDb } from "@/server/db/client";
import { documents, exerciseChecks, exercises, subjects } from "@/server/db/schema";
import { fromPg, pullPlan, toPg } from "@/server/sync/mapping";

describe("conversion SQLite ↔ Supabase", () => {
  it("toPg : snake_case, dates ISO, JSON gardé tel quel", () => {
    expect(
      toPg({ id: "x", subjectId: null, subjectConfirmed: true, createdAt: new Date("2026-11-20T10:00:00.000Z"), tags: ["c"], tests: [{ input: "1", expected: "1", visible: true }] }),
    ).toEqual({
      id: "x",
      subject_id: null,
      subject_confirmed: true,
      created_at: "2026-11-20T10:00:00.000Z",
      tags: ["c"],
      tests: [{ input: "1", expected: "1", visible: true }],
    });
  });

  it("toPg retire les caractères nuls, refusés par Postgres (texte extrait de certains PDF)", () => {
    expect(toPg({ text: "a\u0000b", tags: ["x\u0000"] })).toEqual({ text: "ab", tags: ["x"] });
  });

  it("fromPg : camelCase, colonnes de date en Date, colonne search ignorée", () => {
    const r = fromPg({ exercise_id: "e", updated_at: "2026-11-20T10:00:00+00:00", created_at: "2026-11-19T00:00:00Z", verified: false, search: "'x':1" });
    expect(r).toEqual({ exerciseId: "e", updatedAt: new Date("2026-11-20T10:00:00Z"), createdAt: new Date("2026-11-19T00:00:00Z"), verified: false });
  });

  it("aller-retour d'une ligne SQLite réelle (insérable telle quelle par drizzle)", () => {
    const db = createTestDb();
    const s = db.insert(subjects).values({ name: "Algo", slug: "algo" }).returning().get();
    const back = fromPg(toPg(s));
    expect(back).toMatchObject({ id: s.id, slug: s.slug, name: s.name });
    expect((back.createdAt as Date).getTime()).toBe(s.createdAt.getTime());
  });
});

describe("pullPlan : ce que le PC rapatrie", () => {
  const remote = (id: string, status: string, verified = false, updatedAt = "2026-11-21T10:00:00Z") => ({ exerciseId: id, status, verified, updatedAt: new Date(updatedAt) });

  it("exercice inconnu en local (déposé sur le site) → à rapatrier", () => {
    expect(pullPlan([remote("new", "pending")], new Map())).toEqual({ fetch: ["new"], requeue: [] });
  });

  it("relancé sur le site (pending en ligne, terminé en local) → remis en file", () => {
    const local = new Map([["e1", { status: "ready", updatedAt: new Date("2026-11-20T10:00:00Z") }]]);
    expect(pullPlan([remote("e1", "pending")], local)).toEqual({ fetch: [], requeue: ["e1"] });
  });

  it("déjà en file ou en cours en local : rien à faire", () => {
    const local = new Map([
      ["e1", { status: "pending", updatedAt: new Date() }],
      ["e2", { status: "running", updatedAt: new Date() }],
    ]);
    expect(pullPlan([remote("e1", "pending"), remote("e2", "pending")], local)).toEqual({ fetch: [], requeue: [] });
  });

  it("résultat local plus récent que la relance en ligne : on garde le résultat local", () => {
    const local = new Map([["e1", { status: "ready", updatedAt: new Date("2026-11-22T10:00:00Z") }]]);
    expect(pullPlan([remote("e1", "pending", false, "2026-11-21T10:00:00Z")], local)).toEqual({ fetch: [], requeue: [] });
  });
});

// Garde-fou : les tables synchronisées existent bien côté SQLite (noms de colonnes drizzle).
it("tables synchronisées disponibles", () => {
  expect([subjects, documents, exercises, exerciseChecks].every(Boolean)).toBe(true);
});
