/**
 * `npm run import` : synchronise le dépôt du professeur (storage/sources/c_courses), l'importe
 * (matière « Algorithmique et Prog C »), puis importe LOCAL_COURSES_PATH (un dossier = une matière).
 * Idempotent : un second passage n'ajoute rien (sha256).
 */
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../src/server/db/client";
import { env } from "../src/server/env";
import { runImport } from "../src/server/import/run";
import { seedSubjects } from "../src/server/subjects";

// `env` est lu paresseusement : charger .env ici suffit.
if (fs.existsSync(".env")) process.loadEnvFile(".env");

const started = Date.now();
const db = getDb();
seedSubjects(db);

const localRoot = path.resolve(env.LOCAL_COURSES_PATH);
console.log(`Dépôt du professeur : ${env.C_PROF_REPO_URL}`);
console.log(`Dossier local       : ${localRoot}${fs.existsSync(localRoot) ? "" : " (absent, ignoré)"}`);

const r = await runImport({ db, repoUrl: env.C_PROF_REPO_URL, localRoot, storage: env.STORAGE_PATH });

const line = (label: string, s: { added: number; skipped: number; exercises: number; failed: number }) =>
  console.log(`  ${label.padEnd(8)} ajoutés ${s.added}, déjà présents/ignorés ${s.skipped}, exercices ${s.exercises}, échecs ${s.failed}`);
console.log("\nRésumé de l'import");
line("github", r.github);
line("local", r.local);
console.log(`  total    ajoutés ${r.added}, ignorés ${r.skipped}, exercices ${r.exercises}`);

const perSubject = db.$client
  .prepare(
    `select s.name,
            (select count(*) from documents d where d.subject_id = s.id) as docs,
            (select count(*) from exercises e where e.subject_id = s.id) as ex
       from subjects s order by s.name`,
  )
  .all() as { name: string; docs: number; ex: number }[];
const unclassified = db.$client.prepare("select count(*) as n from documents where subject_id is null").get() as { n: number };
console.log("\nPar matière (documents / exercices)");
for (const s of perSubject) console.log(`  ${s.name.padEnd(45)} ${String(s.docs).padStart(4)} / ${s.ex}`);
console.log(`  ${"(sans matière)".padEnd(45)} ${String(unclassified.n).padStart(4)}`);

for (const e of r.errors) console.error(`\nErreur : ${e}`);
console.log(`\nDurée : ${((Date.now() - started) / 1000).toFixed(1)} s`);
const failed = r.github.failed + r.local.failed;
if (failed) console.error(`\n${failed} fichier(s) en échec (voir les avertissements [import] ci-dessus).`);
process.exit(r.errors.length || failed ? 1 : 0);
