// Liste d'entraînement calculée dans le navigateur (≈ 400 exercices : tout est chargé une fois).
import type { ProgressStatus } from "@/lib/check-rules";

export type Lang = "fr" | "en";

export type ExerciseLite = {
  id: string;
  documentId: string;
  number: number;
  title: string;
  statement: string;
  lang: Lang;
  groupKey: string;
  subjectId: string | null;
};

export type ExerciseRow = ExerciseLite & { status: ProgressStatus };
export type Summary = { todo: number; doing: number; mastered: number; total: number };
export type ExerciseFilter = { subjectId?: string; status?: ProgressStatus; lang?: Lang; q?: string };

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Statut de l'utilisateur sur chaque exercice ; « à faire » s'il n'a jamais été suivi. */
export function withStatus(exercises: ExerciseLite[], progress: Map<string, ProgressStatus>): ExerciseRow[] {
  return exercises.map((e) => ({ ...e, status: progress.get(e.id) ?? "todo" }));
}

export function filterExercises(rows: ExerciseRow[], f: ExerciseFilter): ExerciseRow[] {
  const q = f.q ? norm(f.q.trim()) : "";
  return rows.filter(
    (r) =>
      (!f.subjectId || r.subjectId === f.subjectId) &&
      (!f.status || r.status === f.status) &&
      (!f.lang || r.lang === f.lang) &&
      (!q || norm(r.title).includes(q) || norm(r.statement).includes(q)),
  );
}

export function summarizeBySubject(rows: ExerciseRow[]): Map<string | null, Summary> {
  const m = new Map<string | null, Summary>();
  for (const r of rows) {
    const s = m.get(r.subjectId) ?? { todo: 0, doing: 0, mastered: 0, total: 0 };
    s[r.status] += 1;
    s.total += 1;
    m.set(r.subjectId, s);
  }
  return m;
}
