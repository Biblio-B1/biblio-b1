import path from "node:path";
import type { Db } from "./db/client";
import { exercises } from "./db/schema";
import type { Document } from "./documents";
import { splitExercises } from "./extract/exercises";
import { detectLang, groupKey, isCorrection } from "./import/pairing";
import { enqueueCheck } from "./checks";
import { indexExercise } from "./search";

/** Énoncé dont on extrait les exercices : type exercice/annale, pas un corrigé. */
export function wantsExercises(doc: Pick<Document, "type">, relPath: string): boolean {
  return (doc.type === "exercise" || doc.type === "exam") && !isCorrection(relPath);
}

/**
 * Insère et indexe les exercices découpés dans le texte du document ; renvoie leur nombre.
 * `relPath` : chemin dans la source (import) ou nom du fichier déposé (upload).
 * À appeler dans la transaction qui crée le document.
 */
export function createExercises(db: Db, doc: Document, relPath: string): number {
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
    enqueueCheck(db, row.id);
  }
  return parts.length;
}
