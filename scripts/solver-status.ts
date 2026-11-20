/**
 * `npm run solver:status` : nombre d'exercices par statut de vérification.
 * Strictement en lecture seule : la base est ouverte `readonly` (ni création, ni migration,
 * ni amorçage), sans passer par getDb().
 */
import fs from "node:fs";
import path from "node:path";
import { readSolverStatus } from "../src/server/solver/status";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const file = path.resolve(process.env.STORAGE_PATH || "./storage", "data.db");
const r = readSolverStatus(file);
if (!r.ok) {
  console.error(r.message);
  process.exit(1);
}
const c = r.counts;
const done = c.ready + c.no_code + c.unsupported + c.failed;
console.log(`Exercices : ${c.total}`);
console.log(
  `  prêts (ready) : ${c.ready}   sans code (no_code) : ${c.no_code}   non pris en charge (unsupported) : ${c.unsupported}`,
);
console.log(`  en échec (failed) : ${c.failed}   en cours (running) : ${c.running}   en file (pending) : ${c.pending}`);
console.log(`  pas encore en file : ${c.missing}`);
console.log(`Traités : ${done} / ${c.total}`);
