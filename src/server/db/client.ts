import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { env } from "../env";
import * as schema from "./schema";

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

let instance: Db | undefined;

/** Base applicative (fichier `data.db` sous STORAGE_PATH), migrée au premier appel. */
export function getDb(): Db {
  if (!instance) {
    const storage = path.resolve(env.STORAGE_PATH);
    fs.mkdirSync(storage, { recursive: true });
    instance = open(new Database(path.join(storage, "data.db")));
  }
  return instance;
}

/** Base `:memory:` migrée, pour les tests. */
export function createTestDb(): Db {
  return open(new Database(":memory:"));
}
