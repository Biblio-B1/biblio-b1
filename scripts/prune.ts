/**
 * `npm run prune [-- --dry-run]` : retire de la base (et du disque) les documents importés dont le
 * chemin est maintenant exclu (cf. src/server/import/exclusions.ts), puis les matières vides qui ne
 * sont pas des matières par défaut. Idempotent. Affiche exactement ce qui est retiré.
 */
import fs from "node:fs";
import { getDb } from "../src/server/db/client";
import { env } from "../src/server/env";
import { pruneImported } from "../src/server/import/prune";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const dryRun = process.argv.includes("--dry-run");
const db = getDb();
const r = pruneImported(db, env.STORAGE_PATH, { dryRun });
const verb = dryRun ? "à retirer" : "retirés";

console.log(`Documents ${verb} : ${r.documents.length}`);
for (const d of r.documents) console.log(`  - ${d.title}  [${d.sourcePath}]`);
console.log(`Matières ${verb} : ${r.subjects.length}`);
for (const s of r.subjects) console.log(`  - ${s}`);
if (dryRun) console.log("\n(simulation : rien n'a été modifié)");
