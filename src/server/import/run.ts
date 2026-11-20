import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, type Db } from "../db/client";
import { codeAttempts, documents, exerciseChecks, exercises, importExclusions, posts, progress, threads } from "../db/schema";
import { classify, normalize } from "../classify";
import { createDocument, deleteDocument, type Document } from "../documents";
import { env } from "../env";
import { createExercises, wantsExercises } from "../exercises";
import { extractText } from "../extract/text";
import { splitExercises } from "../extract/exercises";
import { indexExercise, indexThread } from "../search";
import { MAX_UPLOAD_BYTES, resolveStoragePath, saveImported } from "../storage";
import { createSubject, listSubjects, slugify, type Subject } from "../subjects";
import { titleFromFileName } from "../uploads";
import { syncRepo } from "./github";
import { inferTags, inferType, pairCorrections } from "./pairing";
import { expandZips, scanDir } from "./scan";

/** Matière imposée à tout le dépôt du professeur. */
export const PROF_REPO_SUBJECT = "Algorithmique et Prog C";

/** `updated` : fichiers modifiés à la source (même chemin, contenu différent), document remplacé. */
export type ImportStats = { added: number; updated: number; skipped: number; exercises: number; failed: number };

export type ImportTreeOptions = {
  root: string;
  source: "local" | "github";
  storage: string;
  /**
   * `folders` : dossier de 1er niveau = matière (confirmée), fichiers à la racine -> classify() ;
   * `forced` : toute l'arborescence dans `subjectName` (confirmée) ; `classify` : classify() partout.
   */
  mode: "folders" | "forced" | "classify";
  subjectName?: string;
};

const zero = (): ImportStats => ({ added: 0, updated: 0, skipped: 0, exercises: 0, failed: 0 });

/** Longueur max d'un nom de matière (cf. subjectInputSchema). */
const MAX_SUBJECT_NAME = 60;

/**
 * Matière existante de même nom ou slug (accents/casse ignorés ; le nom tronqué à 60 caractères
 * compte aussi, pour retrouver une matière créée depuis un dossier au nom trop long), sinon créée.
 */
export function findOrCreateSubject(db: Db, name: string): Subject {
  const full = name.trim();
  const short = full.slice(0, MAX_SUBJECT_NAME).trim();
  const names = new Set([normalize(full).trim(), normalize(short).trim()]);
  const slugs = new Set([slugify(full), slugify(short)]);
  const found = listSubjects(db).find((s) => names.has(normalize(s.name).trim()) || slugs.has(s.slug));
  if (found) return found;
  return createSubject(db, { name: short, color: "#6b7280", pathPatterns: [], keywords: {} });
}

type Rec = { doc: Document; relPath: string };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function hasExercises(db: Db, documentId: string): boolean {
  return !!db.select({ id: exercises.id }).from(exercises).where(eq(exercises.documentId, documentId)).limit(1).get();
}

/**
 * Remplace `old` (même source et chemin, contenu modifié) par `fresh` : la progression et le
 * dernier code des étudiants passent aux nouveaux exercices de même numéro (titre identique en
 * priorité), les fils de discussion sont re-ciblés (exercice correspondant, sinon le nouveau
 * document), puis l'ancien document est supprimé sans exclusion d'import. Vérification
 * (exercise_checks) : énoncé identique -> ligne recopiée telle quelle (tests validés compris) ;
 * énoncé modifié -> la nouvelle ligne reste `pending` (nouveau pré-calcul, anciens tests écartés).
 * À appeler dans la transaction qui crée `fresh` et ses exercices.
 */
function replaceDocument(db: Db, old: Document, fresh: Document, storage: string): void {
  const oldEx = db.select().from(exercises).where(eq(exercises.documentId, old.id)).orderBy(asc(exercises.number), asc(exercises.groupKey)).all();
  const pool = db.select().from(exercises).where(eq(exercises.documentId, fresh.id)).orderBy(asc(exercises.number), asc(exercises.groupKey)).all();
  const statements = new Map<string, string>([...oldEx, ...pool].map((e) => [e.id, e.statement]));
  const match = new Map<string, string>(); // ancien id -> nouvel id
  // Deux passes : même numéro + même titre, puis même numéro seul.
  for (const sameTitle of [true, false]) {
    for (const e of oldEx) {
      if (match.has(e.id)) continue;
      const i = pool.findIndex((n) => n.number === e.number && (!sameTitle || n.title === e.title));
      if (i >= 0) match.set(e.id, pool.splice(i, 1)[0].id);
    }
  }
  for (const [oldId, newId] of match) {
    const rows = db.select().from(progress).where(eq(progress.exerciseId, oldId)).all();
    for (const r of rows) {
      db.insert(progress).values({ ...r, exerciseId: newId }).onConflictDoNothing().run();
    }
    for (const { id: _id, ...a } of db.select().from(codeAttempts).where(eq(codeAttempts.exerciseId, oldId)).all()) {
      db.insert(codeAttempts).values({ ...a, exerciseId: newId }).onConflictDoNothing().run();
    }
    const check = db.select().from(exerciseChecks).where(eq(exerciseChecks.exerciseId, oldId)).get();
    if (check) {
      if (statements.get(oldId) === statements.get(newId)) {
        // Un calcul en cours visait l'ancien exercice (supprimé) : la copie repart en file.
        const status = check.status === "running" ? "pending" : check.status;
        db.delete(exerciseChecks).where(eq(exerciseChecks.exerciseId, newId)).run();
        db.insert(exerciseChecks).values({ ...check, exerciseId: newId, status }).run();
      } else if (check.status !== "pending") {
        console.log(
          `[import] énoncé modifié (${fresh.title}, exercice ${check.exerciseId} -> ${newId}) : vérification recalculée` +
            (check.verified ? " (les tests validés par un admin sont écartés)" : ""),
        );
      }
    }
  }
  const moved: string[] = [];
  for (const t of db.select().from(threads).where(and(eq(threads.targetType, "document"), eq(threads.targetId, old.id))).all()) {
    db.update(threads).set({ targetId: fresh.id }).where(eq(threads.id, t.id)).run();
    moved.push(t.id);
  }
  const oldIds = oldEx.map((e) => e.id);
  const exThreads = oldIds.length
    ? db.select().from(threads).where(and(eq(threads.targetType, "exercise"), inArray(threads.targetId, oldIds))).all()
    : [];
  for (const t of exThreads) {
    const to = match.get(t.targetId);
    db.update(threads)
      .set(to ? { targetId: to } : { targetType: "document", targetId: fresh.id })
      .where(eq(threads.id, t.id))
      .run();
    moved.push(t.id);
  }
  deleteDocument(db, old.id, { id: null, role: "admin" }, storage, { recordExclusion: false });
  for (const id of moved) {
    const t = db.select().from(threads).where(eq(threads.id, id)).get()!;
    indexThread(db, t, db.select().from(posts).where(eq(posts.threadId, id)).orderBy(asc(posts.createdAt)).all());
  }
}

/**
 * Un exercice reçoit la correction du prof après son pré-calcul : on le remet en file pour que la
 * référence du prof (si c'est du C qui compile) soit utilisée. Jamais pour des tests validés par
 * un admin, un calcul en cours ou déjà en file, ni s'il a déjà été calculé avec la référence du prof.
 */
function requeueForProfSolution(db: Db, exerciseId: string): void {
  db.$client
    .prepare(
      `UPDATE exercise_checks
         SET status = 'pending', attempts = 0, error = NULL, updated_at = unixepoch('subsec') * 1000
       WHERE exercise_id = ? AND verified = 0
         AND status IN ('ready', 'failed', 'no_code', 'unsupported')
         AND coalesce(reference_source, '') != 'prof'`,
    )
    .run(exerciseId);
}

/** Exécute `fn` dans une transaction SQLite (better-sqlite3 : synchrone, annulée si `fn` lève). */
function inTransaction<T>(db: Db, fn: () => T): T {
  return db.$client.transaction(fn)();
}

/**
 * Importe une arborescence (lecture seule) ; idempotent grâce au sha256 unique. Un fichier dont le
 * chemin est déjà connu (même source) mais dont le contenu a changé remplace l'ancien document
 * (progression et fils conservés, cf. replaceDocument) : compté dans `updated`.
 * Chaque nouveau document est créé avec ses exercices dans une même transaction ; un document
 * déjà présent sans exercices (import interrompu) les reçoit au passage suivant.
 */
export async function importTree(db: Db, opts: ImportTreeOptions): Promise<ImportStats> {
  const stats = zero();
  if (!fs.existsSync(opts.root)) return stats;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb1-import-"));
  try {
    const files = expandZips(scanDir(opts.root), tmpDir);
    const forced = opts.mode === "forced" ? findOrCreateSubject(db, opts.subjectName ?? PROF_REPO_SUBJECT) : null;
    const folderSubjects = new Map<string, Subject>();
    const recs = new Map<string, Rec>(); // par id de document

    for (const f of files) {
      try {
        const buf = fs.readFileSync(f.absPath);
        if (buf.length === 0 || buf.length > MAX_UPLOAD_BYTES) {
          stats.skipped++;
          continue;
        }
        const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
        if (db.select({ s: importExclusions.sha256 }).from(importExclusions).where(eq(importExclusions.sha256, sha256)).get()) {
          stats.skipped++; // supprimé à la main : ne pas ré-importer
          continue;
        }
        const existing = db.select().from(documents).where(eq(documents.sha256, sha256)).get();
        if (existing) {
          stats.skipped++;
          if (!recs.has(existing.id)) {
            recs.set(existing.id, { doc: existing, relPath: f.relPath });
            // Rattrapage : énoncé importé lors d'un passage interrompu, resté sans exercices.
            if (wantsExercises(existing, f.relPath) && !hasExercises(db, existing.id)) {
              stats.exercises += inTransaction(db, () => createExercises(db, existing, f.relPath));
            }
          }
          continue;
        }
        // Copie du fichier et extraction hors transaction (I/O, asynchrone).
        const saved = saveImported(buf, f.ext, opts.storage);
        const text = await extractText(resolveStoragePath(saved.filePath, opts.storage), saved.mime);
        const fileName = path.posix.basename(f.relPath);
        let subjectId: string | null = null;
        let subjectConfirmed = false;
        const top = f.relPath.includes("/") ? f.relPath.split("/")[0] : null;
        if (forced) {
          subjectId = forced.id;
          subjectConfirmed = true;
        } else if (opts.mode === "folders" && top) {
          let s = folderSubjects.get(top);
          if (!s) folderSubjects.set(top, (s = findOrCreateSubject(db, top)));
          subjectId = s.id;
          subjectConfirmed = true;
        } else {
          subjectId = classify({ fileName, path: f.relPath, text }, listSubjects(db)).subjectId;
        }
        const previous = db
          .select()
          .from(documents)
          .where(and(eq(documents.source, opts.source), eq(documents.sourcePath, f.relPath)))
          .get();
        const { doc, count } = inTransaction(db, () => {
          const created = createDocument(db, {
            title: titleFromFileName(fileName),
            type: inferType(f.relPath),
            subjectId,
            subjectConfirmed,
            filePath: saved.filePath,
            mime: saved.mime,
            sha256: saved.sha256,
            text,
            source: opts.source,
            sourcePath: f.relPath,
            tags: inferTags(f.relPath),
          });
          const count = wantsExercises(created, f.relPath) ? createExercises(db, created, f.relPath) : 0;
          if (previous) replaceDocument(db, previous, created, opts.storage);
          return { doc: created, count };
        });
        if (previous) {
          stats.updated++;
          recs.delete(previous.id);
        } else stats.added++;
        stats.exercises += count;
        recs.set(doc.id, { doc, relPath: f.relPath });
      } catch (e) {
        stats.failed++;
        console.warn(`[import] échec (${f.relPath}) :`, errMsg(e));
      }
    }

    // Corrigés -> énoncés (re-calculé à chaque passage : les liens restent cohérents),
    // puis solutions : exercice de même numéro du corrigé apparié (seulement si encore vide).
    const pairs = pairCorrections([...recs.values()].map((r) => ({ id: r.doc.id, relPath: r.relPath })));
    for (const [statementId, correctionId] of pairs) {
      const corr = recs.get(correctionId)!;
      try {
        inTransaction(db, () => {
          if (corr.doc.correctionOfId !== statementId) {
            db.update(documents).set({ correctionOfId: statementId }).where(eq(documents.id, correctionId)).run();
          }
          const solutions = new Map<number, string>();
          for (const ex of splitExercises(corr.doc.text)) {
            if (ex.body && !solutions.has(ex.number)) solutions.set(ex.number, ex.body);
          }
          for (const [number, solution] of solutions) {
            const updated = db
              .update(exercises)
              .set({ solution })
              .where(and(eq(exercises.documentId, statementId), eq(exercises.number, number), isNull(exercises.solution)))
              .returning()
              .all();
            for (const row of updated) {
              indexExercise(db, row); // la solution fait partie du corps indexé
              requeueForProfSolution(db, row.id);
            }
          }
        });
      } catch (e) {
        stats.failed++;
        console.warn(`[import] échec de l'appariement (${corr.relPath}) :`, errMsg(e));
      }
    }
    return stats;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export type RunImportOptions = {
  /** Dossier local de cours (un sous-dossier = une matière). */
  localRoot?: string | null;
  /** Dépôt du professeur, cloné dans `<storage>/sources/c_courses`. */
  repoUrl?: string | null;
  storage?: string;
  db?: Db;
};

export type RunImportResult = {
  added: number;
  updated: number;
  skipped: number;
  exercises: number;
  github: ImportStats;
  local: ImportStats;
  errors: string[];
};

/** Import complet : dépôt du professeur (matière forcée) puis dossier local (matière = dossier). */
export async function runImport(opts: RunImportOptions): Promise<RunImportResult> {
  const storage = opts.storage ?? env.STORAGE_PATH;
  const db = opts.db ?? getDb();
  const errors: string[] = [];
  let github = zero();
  if (opts.repoUrl) {
    const dest = path.join(storage, "sources", "c_courses");
    try {
      await syncRepo(opts.repoUrl, dest);
    } catch (e) {
      errors.push(`Synchronisation du dépôt impossible (${opts.repoUrl}) : ${e instanceof Error ? e.message : e}`);
    }
    if (fs.existsSync(path.join(dest, ".git"))) {
      github = await importTree(db, { root: dest, source: "github", storage, mode: "forced", subjectName: PROF_REPO_SUBJECT });
    }
  }
  let local = zero();
  if (opts.localRoot) {
    local = await importTree(db, { root: opts.localRoot, source: "local", storage, mode: "folders" });
  }
  return {
    added: github.added + local.added,
    updated: github.updated + local.updated,
    skipped: github.skipped + local.skipped,
    exercises: github.exercises + local.exercises,
    github,
    local,
    errors,
  };
}
