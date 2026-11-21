import { describe, expect, it } from "vitest";
import { filterExercises, summarizeBySubject, withStatus } from "@/lib/api/training-core";

const ex = (id: string, subjectId: string | null, lang: "fr" | "en", title: string, statement = "") => ({
  id,
  documentId: "d",
  number: Number(id.slice(1)),
  title,
  statement,
  lang,
  groupKey: id,
  subjectId,
});

const all = withStatus(
  [ex("e1", "s1", "fr", "Échanger deux valeurs", "swap"), ex("e2", "s1", "en", "Sum of two"), ex("e3", null, "fr", "Pointeurs")],
  new Map([
    ["e1", "mastered"],
    ["e2", "doing"],
  ]),
);

describe("exercices de l'entraînement", () => {
  it("un exercice jamais suivi est « à faire »", () => {
    expect(all.map((e) => e.status)).toEqual(["mastered", "doing", "todo"]);
  });

  it("filtres matière, statut, langue et texte (sans accents ni casse, titre ou énoncé)", () => {
    expect(filterExercises(all, { subjectId: "s1" }).map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(filterExercises(all, { status: "todo" }).map((e) => e.id)).toEqual(["e3"]);
    expect(filterExercises(all, { lang: "en" }).map((e) => e.id)).toEqual(["e2"]);
    expect(filterExercises(all, { q: "echanger" }).map((e) => e.id)).toEqual(["e1"]);
    expect(filterExercises(all, { q: "SWAP" }).map((e) => e.id)).toEqual(["e1"]);
  });

  it("résumé de progression par matière", () => {
    const m = summarizeBySubject(all);
    expect(m.get("s1")).toEqual({ todo: 0, doing: 1, mastered: 1, total: 2 });
    expect(m.get(null)).toEqual({ todo: 1, doing: 0, mastered: 0, total: 1 });
  });
});
