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

/** Nombre de lignes par statut (tous les statuts présents, 0 inclus) + exercices sans ligne. */
export function countChecksByStatus(db: Db): Record<CheckStatus | "missing" | "total", number> {
  const out = { pending: 0, running: 0, ready: 0, no_code: 0, unsupported: 0, failed: 0, missing: 0, total: 0 };
  const rows = db.$client.prepare("SELECT status, COUNT(*) AS n FROM exercise_checks GROUP BY status").all() as {
    status: CheckStatus;
    n: number;
  }[];
  for (const r of rows) if (r.status in out) out[r.status] = r.n;
  out.total = (db.$client.prepare("SELECT COUNT(*) AS n FROM exercises").get() as { n: number }).n;
  out.missing = (
    db.$client.prepare("SELECT COUNT(*) AS n FROM exercises WHERE id NOT IN (SELECT exercise_id FROM exercise_checks)").get() as {
      n: number;
    }
  ).n;
  return out;
}

export function getCheck(db: Db, exerciseId: string): ExerciseCheck | null {
  return db.select().from(exerciseChecks).where(eq(exerciseChecks.exerciseId, exerciseId)).get() ?? null;
}

/**
 * Prend le plus ancien `pending`, le passe `running` (attempts + 1) et renvoie son id.
 * Un seul UPDATE gardé par `status = 'pending'` : sûr aussi entre processus (solveur séparé
 * du serveur web). Ne relit pas la ligne : utilisable même si elle est corrompue.
 */
export function claimNextPendingId(db: Db): string | null {
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
  return row?.id ?? null;
}

/** Prend le plus ancien `pending` et le passe `running` (voir `claimNextPendingId`). */
export function claimNextPending(db: Db): ExerciseCheck | null {
  const id = claimNextPendingId(db);
  return id ? getCheck(db, id) : null;
}

/** Passe un exercice précis de `pending` à `running` (attempts + 1) ; false s'il n'était pas `pending`. */
export function claimCheck(db: Db, exerciseId: string): boolean {
  return (
    db.$client
      .prepare(
        `UPDATE exercise_checks
           SET status = 'running', attempts = attempts + 1, updated_at = unixepoch('subsec') * 1000
         WHERE exercise_id = ? AND status = 'pending'`,
      )
      .run(exerciseId).changes > 0
  );
}

/**
 * Rend un `running` à la file (`pending`).
 * - par défaut, la prise n'est pas comptée (attempts - 1) : Ollama injoignable, arrêt du solveur,
 *   erreur de configuration — l'exercice n'y est pour rien ;
 * - `counted: true` : la prise reste comptée et `error` est conservée (délai du modèle dépassé,
 *   erreur 5xx) : au-delà du plafond de prises, la ligne passera `failed` avec cette raison.
 */
export function releaseCheck(db: Db, exerciseId: string, opts: { counted?: boolean; error?: string } = {}): void {
  db.$client
    .prepare(
      `UPDATE exercise_checks
         SET status = 'pending',
             attempts = CASE WHEN ? THEN attempts ELSE max(attempts - 1, 0) END,
             error = coalesce(?, error),
             updated_at = unixepoch('subsec') * 1000
       WHERE exercise_id = ? AND status = 'running'`,
    )
    .run(opts.counted ? 1 : 0, opts.error ?? null, exerciseId);
}

/** Signe de vie d'un `running` (évite que `releaseStale` le reprenne pendant un long calcul). */
export function touchCheck(db: Db, exerciseId: string): void {
  db.$client
    .prepare(
      `UPDATE exercise_checks SET updated_at = unixepoch('subsec') * 1000
       WHERE exercise_id = ? AND status = 'running'`,
    )
    .run(exerciseId);
}

/**
 * Remet un exercice en file pour un nouveau calcul (`pending`, attempts = 0, erreur effacée),
 * en le créant au besoin. `verified` : tests validés par un admin (inchangés) ; `busy` : calcul
 * en cours (`running`), inchangé.
 */
export function requeueCheck(db: Db, exerciseId: string): "ok" | "verified" | "busy" {
  enqueueCheck(db, exerciseId);
  const changed = db.$client
    .prepare(
      `UPDATE exercise_checks
         SET status = 'pending', attempts = 0, error = NULL, updated_at = unixepoch('subsec') * 1000
       WHERE exercise_id = ? AND verified = 0 AND status != 'running'`,
    )
    .run(exerciseId).changes;
  if (changed > 0) return "ok";
  const row = db.$client
    .prepare(`SELECT status, verified FROM exercise_checks WHERE exercise_id = ?`)
    .get(exerciseId) as { status: string; verified: number } | undefined;
  return row?.verified ? "verified" : "busy";
}

/** Remet en file tous les `failed` (attempts = 0) ; renvoie leur nombre. */
export function requeueFailed(db: Db): number {
  return db.$client
    .prepare(
      `UPDATE exercise_checks
         SET status = 'pending', attempts = 0, error = NULL, updated_at = unixepoch('subsec') * 1000
       WHERE status = 'failed' AND verified = 0`,
    )
    .run().changes;
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

/**
 * Enregistre le résultat du solveur ; sans effet (renvoie false) si l'exercice a été supprimé
 * entre-temps, n'est plus `running` ou a des tests validés par un admin.
 */
export function saveCheckResult(db: Db, exerciseId: string, result: CheckResult): boolean {
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
  return (
    db
      .update(exerciseChecks)
      .set(set)
      .where(
        and(
          eq(exerciseChecks.exerciseId, exerciseId),
          eq(exerciseChecks.status, "running"),
          eq(exerciseChecks.verified, false),
        ),
      )
      .run().changes > 0
  );
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
