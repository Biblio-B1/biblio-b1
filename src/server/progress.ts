import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client";
import { exercises, LANGS, PROGRESS_STATUSES, progress } from "./db/schema";

export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];
export type Lang = (typeof LANGS)[number];

export const STATUS_LABELS: Record<ProgressStatus, string> = {
  todo: "À faire",
  doing: "En cours",
  mastered: "Maîtrisé",
};

const statusSchema = z.enum(PROGRESS_STATUSES);

/** Définit le statut d'un exercice pour un utilisateur (upsert). */
export function setStatus(db: Db, userId: string, exerciseId: string, status: ProgressStatus): void {
  const s = statusSchema.parse(status);
  if (!db.select({ id: exercises.id }).from(exercises).where(eq(exercises.id, exerciseId)).get()) {
    throw new Error("Exercice introuvable");
  }
  db.insert(progress)
    .values({ userId, exerciseId, status: s })
    .onConflictDoUpdate({
      target: [progress.userId, progress.exerciseId],
      set: { status: s, updatedAt: new Date() },
    })
    .run();
}

/** Statuts explicitement enregistrés ; l'absence d'entrée vaut « todo ». */
export function getProgress(db: Db, userId: string): Map<string, ProgressStatus> {
  const rows = db
    .select({ id: progress.exerciseId, status: progress.status })
    .from(progress)
    .where(eq(progress.userId, userId))
    .all();
  return new Map(rows.map((r) => [r.id, r.status]));
}

export type ExerciseFilter = {
  userId: string;
  subjectId?: string;
  status?: ProgressStatus;
  lang?: Lang;
  q?: string;
  limit?: number;
  offset?: number;
};

const escapeLike = (s: string) => s.replace(/[!%_]/g, (c) => `!${c}`);

function conditions(f: Pick<ExerciseFilter, "subjectId" | "lang" | "q">): SQL[] {
  const c: SQL[] = [];
  if (f.subjectId) c.push(eq(exercises.subjectId, f.subjectId));
  if (f.lang) c.push(eq(exercises.lang, f.lang));
  const q = f.q?.trim();
  if (q) {
    const pat = `%${escapeLike(q)}%`;
    c.push(
      or(
        sql`${exercises.title} like ${pat} escape '!'`,
        sql`${exercises.statement} like ${pat} escape '!'`,
      )!,
    );
  }
  return c;
}

export type ExerciseRow = {
  id: string;
  documentId: string;
  number: number;
  title: string;
  lang: Lang;
  groupKey: string;
  subjectId: string | null;
  status: ProgressStatus;
};

/** Exercices avec le statut de l'utilisateur ; `todo` inclut les exercices jamais suivis. */
export function listExercises(db: Db, f: ExerciseFilter): ExerciseRow[] {
  const where = [...conditions(f)];
  if (f.status) {
    const st = sql`coalesce(${progress.status}, 'todo')`;
    where.push(sql`${st} = ${f.status}`);
  }
  let query = db
    .select({
      id: exercises.id,
      documentId: exercises.documentId,
      number: exercises.number,
      title: exercises.title,
      lang: exercises.lang,
      groupKey: exercises.groupKey,
      subjectId: exercises.subjectId,
      status: sql<ProgressStatus>`coalesce(${progress.status}, 'todo')`,
    })
    .from(exercises)
    .leftJoin(progress, and(eq(progress.exerciseId, exercises.id), eq(progress.userId, f.userId)))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(exercises.subjectId), asc(exercises.documentId), asc(exercises.number), asc(exercises.id))
    .$dynamic();
  if (f.limit !== undefined) query = query.limit(f.limit).offset(f.offset ?? 0);
  return query.all();
}

export type Summary = { todo: number; doing: number; mastered: number; total: number };

export function progressSummary(db: Db, userId: string, subjectId?: string): Summary {
  const rows = db
    .select({ status: sql<ProgressStatus>`coalesce(${progress.status}, 'todo')`, n: sql<number>`count(*)` })
    .from(exercises)
    .leftJoin(progress, and(eq(progress.exerciseId, exercises.id), eq(progress.userId, userId)))
    .where(subjectId ? eq(exercises.subjectId, subjectId) : undefined)
    .groupBy(sql`coalesce(${progress.status}, 'todo')`)
    .all();
  const s: Summary = { todo: 0, doing: 0, mastered: 0, total: 0 };
  for (const r of rows) {
    s[r.status] = r.n;
    s.total += r.n;
  }
  return s;
}

/** Résumé par matière en une requête (barres de progression). */
export function progressBySubject(db: Db, userId: string): Map<string | null, Summary> {
  const rows = db
    .select({
      subjectId: exercises.subjectId,
      status: sql<ProgressStatus>`coalesce(${progress.status}, 'todo')`,
      n: sql<number>`count(*)`,
    })
    .from(exercises)
    .leftJoin(progress, and(eq(progress.exerciseId, exercises.id), eq(progress.userId, userId)))
    .groupBy(exercises.subjectId, sql`coalesce(${progress.status}, 'todo')`)
    .all();
  const m = new Map<string | null, Summary>();
  for (const r of rows) {
    const s = m.get(r.subjectId) ?? { todo: 0, doing: 0, mastered: 0, total: 0 };
    s[r.status] = r.n;
    s.total += r.n;
    m.set(r.subjectId, s);
  }
  return m;
}

export type ExerciseDetail = typeof exercises.$inferSelect;

export function getExercise(db: Db, id: string): ExerciseDetail | undefined {
  return db.select().from(exercises).where(eq(exercises.id, id)).get();
}

/** Autres versions (autre langue) du même exercice. */
export function getVariants(db: Db, ex: ExerciseDetail): { id: string; lang: Lang }[] {
  return db
    .select({ id: exercises.id, lang: exercises.lang })
    .from(exercises)
    .where(and(eq(exercises.groupKey, ex.groupKey), inArray(exercises.lang, [...LANGS])))
    .all()
    .filter((v) => v.id !== ex.id && v.lang !== ex.lang);
}
