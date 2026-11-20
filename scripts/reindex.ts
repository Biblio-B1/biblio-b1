/**
 * `npm run reindex` : reconstruit entièrement l'index de recherche (FTS5) depuis la base.
 * Utile après un import fait avant l'index, ou pour réparer l'index. Idempotent.
 */
import fs from "node:fs";
import { getDb } from "../src/server/db/client";
import { reindexAll } from "../src/server/search";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const db = getDb();
const t0 = Date.now();
const r = reindexAll(db);
console.log(`Index reconstruit en ${Date.now() - t0} ms : ${r.documents} documents, ${r.exercises} exercices, ${r.threads} fils.`);
