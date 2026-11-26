// Groupes d'anglais : chaque élève a le sien, lu dans son propre emploi du temps Boostcamp
// (ligne « TD : B1 Anglais avancé Gr2 » des séances d'anglais). Un contrôle d'anglais n'est montré
// qu'aux élèves de son groupe.
import type { ScheduleEvent } from "@/lib/calendar-view";

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** « B1 Anglais avancé Gr2 », « B1Anglais avancé Groupe 2 » → « anglaisavancegr2 ». */
export function englishGroupKey(label: string): string {
  return fold(label)
    .replace(/\bb1\s*/g, "")
    .replace(/\bgroupe\b/g, "gr")
    .replace(/[^a-z0-9]/g, "");
}

function line(description: string | undefined, label: string): string {
  const m = description?.match(new RegExp(`^${label}\\s*:\\s*(.+)$`, "im"));
  return m ? m[1].trim() : "";
}

/** Groupes d'anglais de l'élève (clés), d'après les séances d'anglais de son emploi du temps. */
export function myEnglishGroups(events: ScheduleEvent[]): string[] {
  const keys = new Set<string>();
  for (const e of events) {
    const subject = line(e.description, "Matière") || e.title;
    if (!/anglais|english/.test(fold(subject))) continue;
    for (const part of line(e.description, "TD").split(",")) {
      const k = englishGroupKey(part);
      if (k) keys.add(k);
    }
  }
  return [...keys];
}

/** Le groupe du contrôle correspond-il à l'un de ceux de l'élève ? (« Anglais avancé Gr2 » ~ « B1 Anglais avancé Gr2 ») */
export function inMyEnglishGroup(group: string, mine: string[]): boolean {
  const k = englishGroupKey(group);
  if (!k) return true;
  return mine.some((m) => m === k || m.includes(k) || k.includes(m));
}

/**
 * Contrôles visibles par l'élève : tous, sauf ceux d'anglais d'un autre groupe. Sans emploi du temps
 * lié (groupe inconnu), on montre tout ; l'auteur voit toujours ce qu'il a ajouté.
 */
export function visibleForMe<T extends { englishGroup: string | null; authorId: string | null }>(
  items: T[],
  events: ScheduleEvent[] | null | undefined,
  userId: string | null | undefined,
): T[] {
  const mine = events ? myEnglishGroups(events) : [];
  if (mine.length === 0) return items;
  return items.filter((x) => !x.englishGroup || (userId && x.authorId === userId) || inMyEnglishGroup(x.englishGroup, mine));
}
