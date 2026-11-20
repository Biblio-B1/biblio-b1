import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { env } from "../env";
import * as schema from "./schema";
import { seedSubjects } from "../subjects";
import { ensureIndex } from "../search";

export type Db = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

// Table virtuelle FTS5 : hors du schéma Drizzle, créée en SQL brut.
const FTS_SQL = `CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  kind,
  ref_id UNINDEXED,
  title,
  body,
  subject_id UNINDEXED,
  author_id UNINDEXED,
  created_at UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
)`;

function open(sqlite: Database.Database): Db {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  sqlite.exec(FTS_SQL);
  return db;
}

// Mis en cache sur globalThis : le HMR de `next dev` recharge les modules
// et ouvrirait sinon une connexion SQLite supplémentaire à chaque rechargement.
const globalForDb = globalThis as unknown as { __bb1Db?: Db };

/** Base applicative (fichier `data.db` sous STORAGE_PATH), migrée et amorcée (matières) au premier appel. */
export function getDb(): Db {
  if (!globalForDb.__bb1Db) {
    const storage = path.resolve(env.STORAGE_PATH);
    fs.mkdirSync(storage, { recursive: true });
    const db = open(new Database(path.join(storage, "data.db")));
    seedSubjects(db); // matières par défaut, idempotent (slug unique)
    ensureIndex(db); // rattrapage : index de recherche vide alors que des documents existent
    globalForDb.__bb1Db = db;
  }
  return globalForDb.__bb1Db;
}

/** Base `:memory:` migrée, pour les tests. */
export function createTestDb(): Db {
  return open(new Database(":memory:"));
}
