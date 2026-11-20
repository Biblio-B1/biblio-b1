// Lecture seule de l'avancement du pré-calcul (`npm run solver:status`).
import fs from "node:fs";
import Database from "better-sqlite3";
import { countChecksByStatus } from "../checks";
import type { Db } from "../db/client";

export type SolverStatus =
  | { ok: true; counts: ReturnType<typeof countChecksByStatus> }
  | { ok: false; message: string };

/**
 * Ouvre `file` en lecture seule (`readonly`, `fileMustExist`) et compte les exercices par statut
 * (requêtes COUNT brutes). Ne crée, ne migre ni ne modifie jamais la base.
 */
export function readSolverStatus(file: string): SolverStatus {
  if (!fs.existsSync(file)) {
    return { ok: false, message: `Base introuvable : ${file} (lancez d'abord npm run import, ou vérifiez STORAGE_PATH).` };
  }
  let sqlite: Database.Database | null = null;
  try {
    sqlite = new Database(file, { readonly: true, fileMustExist: true });
    // countChecksByStatus n'utilise que des requêtes SQL brutes sur $client.
    const counts = countChecksByStatus({ $client: sqlite } as unknown as Db);
    return { ok: true, counts };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: /no such table/i.test(m)
        ? `Base sans tables de vérification (${file}) : démarrez le site ou le solveur une fois pour appliquer les migrations.`
        : `Lecture de la base impossible (${file}) : ${m}`,
    };
  } finally {
    sqlite?.close();
  }
}
