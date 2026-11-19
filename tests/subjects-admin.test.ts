import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/server/db/client";
import {
  createSubject,
  formatKeywordLines,
  listSubjects,
  parseKeywordLines,
  seedSubjects,
  updateSubject,
} from "@/server/subjects";

let db: Db;
beforeEach(() => {
  db = createTestDb();
  seedSubjects(db);
});

describe("parseKeywordLines", () => {
  it("lit « mot: poids » par ligne, poids 1 par défaut, normalise", () => {
    expect(parseKeywordLines("malloc: 3\n  Pointeur \n\nint main : 2\n#include:1")).toEqual({
      malloc: 3,
      pointeur: 1,
      "int main": 2,
      "#include": 1,
    });
  });

  it("refuse un poids invalide", () => {
    expect(() => parseKeywordLines("malloc: x")).toThrow(/poids/i);
    expect(() => parseKeywordLines("malloc: 0")).toThrow(/poids/i);
    expect(() => parseKeywordLines("malloc: 99")).toThrow(/poids/i);
  });

  it("aller-retour avec formatKeywordLines", () => {
    const k = { malloc: 3, "stdio.h": 2 };
    expect(parseKeywordLines(formatKeywordLines(k))).toEqual(k);
  });
});

describe("updateSubject", () => {
  it("met à jour nom, couleur, motifs et mots-clés", () => {
    const s = listSubjects(db)[0];
    const u = updateSubject(db, s.id, {
      name: "Prog C",
      color: "#112233",
      pathPatterns: ["\\bprog\\b"],
      keywords: { malloc: 3 },
    });
    expect(u.name).toBe("Prog C");
    expect(u.color).toBe("#112233");
    expect(u.slug).toBe(s.slug);
    expect(u.rules).toEqual({ pathPatterns: ["\\bprog\\b"], keywords: { malloc: 3 } });
  });

  it("refuse une regex invalide, une couleur invalide, un nom vide, un id inconnu", () => {
    const s = listSubjects(db)[0];
    const base = { name: "X", color: "#112233", pathPatterns: [], keywords: {} };
    expect(() => updateSubject(db, s.id, { ...base, pathPatterns: ["(abc"] })).toThrow(/Motif invalide/);
    expect(() => updateSubject(db, s.id, { ...base, color: "red" })).toThrow();
    expect(() => updateSubject(db, s.id, { ...base, name: " " })).toThrow();
    expect(() => updateSubject(db, "nope", base)).toThrow(/introuvable/);
  });
});

describe("createSubject", () => {
  it("crée une matière avec un slug unique", () => {
    const a = createSubject(db, { name: "Réseaux & Télécoms", color: "#0ea5e9", pathPatterns: [], keywords: {} });
    expect(a.slug).toBe("reseaux-telecoms");
    const b = createSubject(db, { name: "Réseaux  Télécoms", color: "#0ea5e9", pathPatterns: [], keywords: {} });
    expect(b.slug).toBe("reseaux-telecoms-2");
    expect(listSubjects(db)).toHaveLength(7);
  });
});
