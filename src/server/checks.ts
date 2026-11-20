import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client";
import {
  CHECK_LANGUAGES as LANGUAGES,
  checkReports,
  codeAttempts,
  exerciseChecks,
  exercises,
  type CHECK_LANGUAGES,
  type CHECK_STATUSES,
  type REFERENCE_SOURCES,
} from "./db/schema";
import { getProgress, setStatus } from "./progress";

export type CheckTest = { input: string; expected: string; visible: boolean };
export type CheckStatus = (typeof CHECK_STATUSES)[number];
export type CheckLanguage = (typeof CHECK_LANGUAGES)[number];
export type ReferenceSource = (typeof REFERENCE_SOURCES)[number];
export type ExerciseCheck = typeof exerciseChecks.$inferSelect;
export type CodeAttempt = typeof codeAttempts.$inferSelect;

export type CheckActor = { id: string; role: "admin" | "member" };

const testsSchema = z
  .array(
    z.object({
      input: z.string().max(10_000, "Entrée trop longue (10 000 caractères max)"),
      expected: z.string().max(100_000, "Sortie attendue trop longue (100 000 caractères max)"),
      visible: z.boolean(),
    }),
  )
  .min(1, "Au moins un test est requis")
  .max(20, "20 tests maximum")
  .refine((t) => t.some((x) => x.visible), "Au moins un test doit être visible");

/** Met l'exercice en file (`pending`) s'il n'a pas encore de ligne ; idempotent. */
export function enqueueCheck(db: Db, exerciseId: string): void {
  db.insert(exerciseChecks).values({ exerciseId }).onConflictDoNothing().run();
}

/** Met en file tous les exercices sans ligne ; renvoie le nombre ajouté. */
export function enqueueAllMissing(db: Db): number {
  return db.$client
    .prepare(
      `INSERT INTO exercise_checks (exercise_id) SELECT id FROM exercises
       WHERE id NOT IN (SELECT exercise_id FROM exercise_checks)`,
    )
    .run().changes;
}

export function getCheck(db: Db, exerciseId: string): ExerciseCheck | null {
  return db.select().from(exerciseChecks).where(eq(exerciseChecks.exerciseId, exerciseId)).get() ?? null;
}

/**
 * Prend le plus ancien `pending` et le passe `running`. Un seul UPDATE gardé par
 * `status = 'pending'` : sûr aussi entre processus (solveur séparé du serveur web).
 */
export function claimNextPending(db: Db): ExerciseCheck | null {
  const row = db.$client
    .prepare(
      `UPDATE exercise_checks
         SET status = 'running', attempts = attempts + 1, updated_at = unixepoch('subsec') * 1000
       WHERE status = 'pending' AND exercise_id = (
         SELECT exercise_id FROM exercise_checks WHERE status = 'pending'
         ORDER BY created_at ASC, rowid ASC LIMIT 1)
       RETURNING exercise_id AS id`,
    )
    .get() as { id: string } | undefined;
  return row ? getCheck(db, row.id) : null;
}

/** Remet en `pending` les `running` inactifs depuis plus de `olderThanMs` ; renvoie leur nombre. */
export function releaseStale(db: Db, olderThanMs: number): number {
  const limit = new Date(Date.now() - olderThanMs);
  return db
    .update(exerciseChecks)
    .set({ status: "pending", updatedAt: new Date() })
    .where(and(eq(exerciseChecks.status, "running"), lt(exerciseChecks.updatedAt, limit)))
    .run().changes;
}

export type CheckResult = {
  status: CheckStatus;
  language?: CheckLanguage | null;
  referenceCode?: string | null;
  referenceSource?: ReferenceSource | null;
  tests?: CheckTest[];
  model?: string | null;
  error?: string | null;
};

/** Enregistre le résultat du solveur ; sans effet si l'exercice a été supprimé entre-temps. */
export function saveCheckResult(db: Db, exerciseId: string, result: CheckResult): void {
  const set: Partial<typeof exerciseChecks.$inferInsert> = {
    status: result.status,
    error: result.error ?? null,
    updatedAt: new Date(),
  };
  if (result.language !== undefined) set.language = result.language;
  if (result.referenceCode !== undefined) set.referenceCode = result.referenceCode;
  if (result.referenceSource !== undefined) set.referenceSource = result.referenceSource;
  if (result.tests !== undefined) set.tests = result.tests;
  if (result.model !== undefined) set.model = result.model;
  // Garde : un résultat tardif n'écrase ni des tests vérifiés par un admin, ni une ligne
  // qui n'est plus `running` (libérée puis reprise, ou supprimée).
  db.update(exerciseChecks)
    .set(set)
    .where(
      and(
        eq(exerciseChecks.exerciseId, exerciseId),
        eq(exerciseChecks.status, "running"),
        eq(exerciseChecks.verified, false),
      ),
    )
    .run();
}

function requireAdmin(actor: CheckActor): string {
  if (actor.role !== "admin") throw new Error("forbidden");
  return actor.id;
}

/** L'admin valide les tests tels quels. Erreurs : `forbidden`, `not_found`. */
export function verifyCheck(db: Db, exerciseId: string, admin: CheckActor): void {
  const adminId = requireAdmin(admin);
  if (!getCheck(db, exerciseId)) throw new Error("not_found");
  db.update(exerciseChecks)
    .set({ verified: true, verifiedBy: adminId, updatedAt: new Date() })
    .where(eq(exerciseChecks.exerciseId, exerciseId))
    .run();
}

/** L'admin remplace les tests (validés par zod) ; ils sont alors marqués vérifiés. */
export function updateTests(db: Db, exerciseId: string, tests: CheckTest[], admin: CheckActor): void {
  const adminId = requireAdmin(admin);
  const parsed = testsSchema.parse(tests);
  if (!getCheck(db, exerciseId)) throw new Error("not_found");
  db.update(exerciseChecks)
    .set({ tests: parsed, verified: true, verifiedBy: adminId, updatedAt: new Date() })
    .where(eq(exerciseChecks.exerciseId, exerciseId))
    .run();
}

/** Signale un test faux. Erreurs : `not_found`, `invalid`. */
export function reportCheck(db: Db, exerciseId: string, userId: string, message: string): void {
  const r = z.string().trim().min(1, "Message vide").max(2000, "Message trop long").safeParse(message);
  if (!r.success) throw new Error("invalid");
  const m = r.data;
  if (!getCheck(db, exerciseId) && !db.select({ id: exercises.id }).from(exercises).where(eq(exercises.id, exerciseId)).get()) {
    throw new Error("not_found");
  }
  db.insert(checkReports).values({ userId, exerciseId, message: m }).run();
}

/** Enregistre le dernier code ; progression `doing`, ou `mastered` si réussi (jamais de rétrogradation). */
export function saveAttempt(
  db: Db,
  userId: string,
  exerciseId: string,
  language: CheckLanguage,
  code: string,
  passed: boolean,
): void {
  if (
    typeof code !== "string" ||
    code.length > 100_000 ||
    !(LANGUAGES as readonly string[]).includes(language)
  ) {
    throw new Error("invalid");
  }
  if (!db.select({ id: exercises.id }).from(exercises).where(eq(exercises.id, exerciseId)).get()) {
    throw new Error("not_found");
  }
  db.transaction((tx) => {
    const t = tx as unknown as Db;
    t.insert(codeAttempts)
      .values({ userId, exerciseId, language, code, passed })
      .onConflictDoUpdate({
        target: [codeAttempts.userId, codeAttempts.exerciseId],
        set: { language, code, passed, updatedAt: new Date() },
      })
      .run();
    if (passed) setStatus(t, userId, exerciseId, "mastered");
    else if (getProgress(t, userId).get(exerciseId) !== "mastered") setStatus(t, userId, exerciseId, "doing");
  });
}

export function getAttempt(db: Db, userId: string, exerciseId: string): CodeAttempt | null {
  return (
    db
      .select()
      .from(codeAttempts)
      .where(and(eq(codeAttempts.userId, userId), eq(codeAttempts.exerciseId, exerciseId)))
      .get() ?? null
  );
}
