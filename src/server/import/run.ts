import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, type Db } from "../db/client";
import { documents, exercises, importExclusions } from "../db/schema";
import { classify, normalize } from "../classify";
import { createDocument, type Document } from "../documents";
import { env } from "../env";
import { extractText } from "../extract/text";
import { splitExercises } from "../extract/exercises";
import { indexExercise } from "../search";
import { MAX_UPLOAD_BYTES, resolveStoragePath, saveImported } from "../storage";
import { createSubject, listSubjects, slugify, type Subject } from "../subjects";
import { titleFromFileName } from "../uploads";
import { syncRepo } from "./github";
import { detectLang, groupKey, inferTags, inferType, isCorrection, pairCorrections } from "./pairing";
import { expandZips, scanDir } from "./scan";

/** Matière imposée à tout le dépôt du professeur. */
export const PROF_REPO_SUBJECT = "Algorithmique et Prog C";

export type ImportStats = { added: number; skipped: number; exercises: number; failed: number };

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

const zero = (): ImportStats => ({ added: 0, skipped: 0, exercises: 0, failed: 0 });

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

/** Énoncé dont on extrait les exercices : type exercice/annale, pas un corrigé. */
function wantsExercises(doc: Document, relPath: string): boolean {
  return (doc.type === "exercise" || doc.type === "exam") && !isCorrection(relPath);
}

function hasExercises(db: Db, documentId: string): boolean {
  return !!db.select({ id: exercises.id }).from(exercises).where(eq(exercises.documentId, documentId)).limit(1).get();
}

/** Insère les exercices découpés dans le texte du document ; renvoie leur nombre. */
function createExercises(db: Db, doc: Document, relPath: string): number {
  const parts = splitExercises(doc.text);
  if (!parts.length) return 0;
  const lang = detectLang(path.posix.basename(relPath), doc.text);
  const base = groupKey(relPath);
  const seen = new Map<number, number>();
  for (const ex of parts) {
    const k = (seen.get(ex.number) ?? 0) + 1;
    seen.set(ex.number, k);
    const row = db
      .insert(exercises)
      .values({
        documentId: doc.id,
        number: ex.number,
        title: ex.title.slice(0, 300),
        statement: ex.body || ex.title,
        lang,
        groupKey: `${base}#${ex.number}${k > 1 ? `-${k}` : ""}`,
        subjectId: doc.subjectId,
      })
      .returning()
      .get();
    indexExercise(db, row);
  }
  return parts.length;
}

/** Exécute `fn` dans une transaction SQLite (better-sqlite3 : synchrone, annulée si `fn` lève). */
function inTransaction<T>(db: Db, fn: () => T): T {
  return db.$client.transaction(fn)();
}

/**
 * Importe une arborescence (lecture seule) ; idempotent grâce au sha256 unique.
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
          return {
            doc: created,
            count: wantsExercises(created, f.relPath) ? createExercises(db, created, f.relPath) : 0,
          };
        });
        stats.added++;
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
            for (const row of updated) indexExercise(db, row); // la solution fait partie du corps indexé
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
    skipped: github.skipped + local.skipped,
    exercises: github.exercises + local.exercises,
    github,
    local,
    errors,
  };
}
