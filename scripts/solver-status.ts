/** `npm run solver:status` : nombre d'exercices par statut de vérification (lecture seule). */
import fs from "node:fs";
import { getDb } from "../src/server/db/client";
import { countChecksByStatus } from "../src/server/checks";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const c = countChecksByStatus(getDb());
const done = c.ready + c.no_code + c.unsupported + c.failed;
console.log(`Exercices : ${c.total}`);
console.log(
  `  prêts (ready) : ${c.ready}   sans code (no_code) : ${c.no_code}   non pris en charge (unsupported) : ${c.unsupported}`,
);
console.log(`  en échec (failed) : ${c.failed}   en cours (running) : ${c.running}   en file (pending) : ${c.pending}`);
console.log(`  pas encore en file : ${c.missing}`);
console.log(`Traités : ${done} / ${c.total}`);
