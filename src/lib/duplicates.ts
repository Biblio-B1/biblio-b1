// Doublons possibles : avant de publier un devoir, un projet final ou un contrôle, on cherche ce qui
// est déjà prévu pour la même matière le même jour (quel que soit le type). La personne voit la liste
// et confirme si ce n'est pas la même chose.

export type DueItem = {
  id: string;
  kind: "devoir" | "projet" | "controle";
  subjectId: string | null;
  subjectName: string;
  date: string;
  title: string;
  authorName?: string | null;
  /** Groupe d'anglais (deux groupes différents ne sont pas un doublon). */
  group?: string | null;
};

export const DUE_KIND_LABEL: Record<DueItem["kind"], string> = { devoir: "Devoir", projet: "Projet final", controle: "Contrôle" };

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Éléments déjà prévus pour la même matière (même identifiant, ou même nom : les contrôles venus de
 * Boostcamp n'ont que le nom) à la même date.
 */
export function findDuplicates(
  draft: { subjectId: string; subjectName: string; date: string; group?: string | null },
  existing: DueItem[],
): DueItem[] {
  if (!draft.date) return [];
  const name = norm(draft.subjectName);
  const group = norm(draft.group ?? "");
  return existing.filter(
    (e) =>
      e.date === draft.date &&
      ((e.subjectId !== null && e.subjectId === draft.subjectId) || (name !== "" && norm(e.subjectName) === name)) &&
      // Anglais : deux groupes précisés et différents, ce n'est pas la même chose.
      !(group && e.group && norm(e.group) !== group),
  );
}

/** Devoirs (et projets finaux) → éléments comparables. */
export function homeworkItems(
  hws: { id: string; subjectId: string; subjectName: string; dueDate: string; title: string; isFinalProject: boolean; authorName: string | null; englishGroup?: string | null }[],
): DueItem[] {
  return hws.map((h) => ({
    id: h.id,
    kind: h.isFinalProject ? "projet" : "devoir",
    subjectId: h.subjectId,
    subjectName: h.subjectName,
    date: h.dueDate,
    title: h.title,
    authorName: h.authorName,
    group: h.englishGroup ?? null,
  }));
}

/** Contrôles → éléments comparables. */
export function examItems(
  exams: { id: string; subjectId: string | null; subjectName: string; date: string; title: string; startTime: string | null; authorName: string | null; source: string; englishGroup?: string | null }[],
): DueItem[] {
  return exams.map((e) => ({
    id: e.id,
    kind: "controle",
    subjectId: e.subjectId,
    subjectName: e.subjectName,
    date: e.date,
    title: [e.title, e.startTime ? `à ${e.startTime.replace(":", "h")}` : "", e.source === "edt" ? "(emploi du temps Boostcamp)" : ""]
      .filter(Boolean)
      .join(" "),
    authorName: e.authorName,
    group: e.englishGroup ?? null,
  }));
}
