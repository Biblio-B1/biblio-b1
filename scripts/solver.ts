/**
 * `npm run solver` : service de pré-calcul des vérifications d'exercices (Ollama + moteurs WASM).
 *
 *   --once               traite un exercice puis s'arrête
 *   --limit N            traite au plus N exercices puis s'arrête
 *   --exercise <id>      (re)calcule cet exercice seulement, puis s'arrête
 *   --retry-failed       remet en file les exercices `failed` avant de commencer
 *   --enqueue-missing    met en file les exercices sans ligne (fait aussi à chaque démarrage)
 *
 * Sans option : boucle longue (service systemd). Ollama injoignable → l'exercice reste
 * `pending`, attente (60 s, doublée jusqu'à 15 min) puis nouvel essai. Modèle introuvable
 * (HTTP 404/400) : message clair et sortie 1 (le service systemd passe en échec). Délai du
 * modèle dépassé ou erreur 5xx : prise comptée, l'exercice finit `failed` après 3 prises.
 * SIGINT/SIGTERM :
 * la ligne en cours est rendue à la file, les moteurs sont arrêtés, sortie 0.
 */
import fs from "node:fs";
import { parseArgs } from "node:util";
import { getDb } from "../src/server/db/client";
import { enqueueAllMissing, claimCheck, getCheck, releaseStale, requeueCheck, requeueFailed } from "../src/server/checks";
import { env } from "../src/server/env";
import { exercises } from "../src/server/db/schema";
import { processNext, solveExerciseDetailed, type SolveDeps, type SolveResult } from "../src/server/solver/solve";
import { disposeRunners } from "../src/lib/runners/index.ts";
import { pullExclusions, pullPending, pushCheck, supabaseAdmin } from "../src/server/sync/supabase-sync";
import { eq } from "drizzle-orm";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const { values } = parseArgs({
  options: {
    once: { type: "boolean", default: false },
    limit: { type: "string" },
    exercise: { type: "string" },
    "retry-failed": { type: "boolean", default: false },
    "enqueue-missing": { type: "boolean", default: false },
  },
});

const limit = values.once ? 1 : values.limit !== undefined ? Number(values.limit) : Infinity;
if (!(limit >= 1) || (Number.isFinite(limit) && !Number.isInteger(limit))) {
  console.error("--limit attend un entier ≥ 1.");
  process.exit(2);
}
const bounded = Number.isFinite(limit) || values.exercise !== undefined;

const STALE_MS = 30 * 60_000;
const IDLE_MS = 10_000;
const BACKOFF_START_MS = 60_000;
const BACKOFF_MAX_MS = 15 * 60_000;

const stop = new AbortController();
let stopping = false;
const onSignal = (sig: string) => {
  if (stopping) {
    console.error(`[solveur] ${sig} reçu deux fois : arrêt immédiat.`);
    process.exit(1);
  }
  stopping = true;
  console.log(`[solveur] ${sig} reçu : arrêt après l'exercice en cours (ligne rendue à la file si interrompue)…`);
  stop.abort();
};
process.on("SIGINT", () => onSignal("SIGINT"));
process.on("SIGTERM", () => onSignal("SIGTERM"));

// Site (Supabase) : le solveur rapatrie les exercices en attente et envoie chaque résultat.
// Sans SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY dans .env, il travaille sur la base du PC seule.
const sb = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin() : null;
const syncLog = (m: string) => console.log(`[solveur] site : ${m}`);
/** Une erreur réseau ne doit jamais arrêter le solveur : journalisée, réessayée plus tard. */
async function syncSafely(what: string, fn: () => Promise<unknown>): Promise<void> {
  if (!sb) return;
  try {
    await fn();
  } catch (e) {
    console.warn(`[solveur] site injoignable (${what}) : ${e instanceof Error ? e.message : e}`);
  }
}
const pull = () => syncSafely("rapatriement", async () => {
  await pullExclusions(getDb(), sb!, syncLog);
  await pullPending(getDb(), sb!, syncLog);
});
const push = (id: string) => syncSafely("envoi du résultat", () => pushCheck(getDb(), sb!, id));

/** Attente interrompue par un signal d'arrêt (l'écouteur est retiré à la fin de l'attente). */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(() => {
      stop.signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    stop.signal.addEventListener("abort", onAbort, { once: true });
  });
}

const db = getDb();
const deps: SolveDeps = {
  url: env.OLLAMA_URL,
  model: env.OLLAMA_MODEL,
  runTimeoutMs: env.SOLVER_TIMEOUT_MS,
  signal: stop.signal,
};

function logLine(id: string, r: SolveResult, durationMs: number): void {
  let title = "?";
  try {
    title = db.select({ t: exercises.title }).from(exercises).where(eq(exercises.id, id)).get()?.t ?? "(supprimé)";
  } catch {
    /* titre indisponible */
  }
  let detail = "";
  try {
    const c = getCheck(db, id);
    if (c && r.outcome === "ready") detail = ` ${c.language}, ${c.tests.length} tests, réf. ${c.referenceSource}`;
    else if (c && r.outcome === "failed") detail = ` ${c.error?.split("\n")[0].slice(0, 160) ?? ""}`;
  } catch {
    /* ligne illisible */
  }
  if (r.message && !detail) detail = ` ${r.message.split("\n")[0].slice(0, 200)}`;
  const short = title.length > 60 ? `${title.slice(0, 57)}…` : title;
  for (const n of r.notes) console.log(`[solveur] ${id.slice(0, 8)} note : ${n.slice(0, 200)}`);
  console.log(`[solveur] ${id.slice(0, 8)} « ${short} » → ${r.outcome}${detail} (${(durationMs / 1000).toFixed(1)} s)`);
}

function configError(message: string | undefined): number {
  console.error(
    `[solveur] erreur de configuration d'Ollama : ${message ?? "?"}\n` +
      `[solveur] vérifiez OLLAMA_MODEL (${deps.model}) et OLLAMA_URL (${deps.url}) dans .env, ou lancez « ollama pull ${deps.model} ». Arrêt.`,
  );
  return 1;
}

async function main(): Promise<number> {
  const released = releaseStale(db, STALE_MS);
  const added = enqueueAllMissing(db);
  const requeued = values["retry-failed"] ? requeueFailed(db) : 0;
  console.log(
    `[solveur] ${deps.model} via ${deps.url} — ${added} exercice(s) mis en file, ${released} reprise(s) libérée(s)` +
      (values["retry-failed"] ? `, ${requeued} échec(s) remis en file` : ""),
  );

  if (!sb) console.warn("[solveur] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents : résultats gardés sur le PC (npm run sync pour les envoyer).");
  await pull();

  if (values.exercise !== undefined) {
    const id = values.exercise;
    if (!db.select({ id: exercises.id }).from(exercises).where(eq(exercises.id, id)).get()) {
      console.error(`[solveur] exercice introuvable : ${id}`);
      return 1;
    }
    const q = requeueCheck(db, id);
    if (q === "verified") {
      console.error(`[solveur] ${id} : tests validés par un admin, rien à faire.`);
      return 1;
    }
    if (q === "busy" || !claimCheck(db, id)) {
      console.error(`[solveur] ${id} : calcul déjà en cours (statut running), rien à faire.`);
      return 1;
    }
    const t0 = performance.now();
    const r = await solveExerciseDetailed(db, id, deps);
    logLine(id, r, Math.round(performance.now() - t0));
    await push(id);
    if (r.outcome === "config_error") return configError(r.message);
    return r.outcome === "unavailable" || r.outcome === "retry_later" ? 1 : 0;
  }

  let done = 0;
  let backoff = BACKOFF_START_MS;
  let warnedUnavailable = false;
  while (!stopping && done < limit) {
    let r;
    try {
      // Lignes `running` abandonnées (autre solveur arrêté brutalement) : rendues à la file.
      // Les calculs actifs envoient un signe de vie avant chaque appel au modèle.
      const stale = releaseStale(db, STALE_MS);
      if (stale > 0) console.log(`[solveur] ${stale} calcul(s) abandonné(s) remis en file.`);
      r = await processNext(db, deps);
    } catch (e) {
      // Erreur imprévue (base verrouillée…) : en service, on journalise et on réessaie.
      if (bounded) throw e;
      console.error("[solveur] erreur, nouvel essai dans 60 s :", e);
      await pause(BACKOFF_START_MS);
      continue;
    }
    if (!r) {
      if (bounded) break;
      await pause(IDLE_MS);
      await pull(); // nouveaux exercices déposés ou relancés sur le site
      continue;
    }
    if (r.outcome === "config_error") return configError(r.message);
    if (r.outcome === "unavailable") {
      if (!warnedUnavailable) {
        console.warn(`[solveur] Ollama injoignable : ${r.message ?? deps.url} — exercices laissés en file, nouvel essai plus tard.`);
        warnedUnavailable = true;
      }
      if (bounded) return 1;
      await pause(backoff);
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
      continue;
    }
    if (warnedUnavailable) console.log("[solveur] Ollama de nouveau joignable.");
    warnedUnavailable = false;
    backoff = BACKOFF_START_MS;
    if (r.outcome !== "interrupted" && r.outcome !== "skipped") done++;
    logLine(r.id, r, r.durationMs);
    if (r.outcome !== "interrupted" && r.outcome !== "skipped") await push(r.id);
    // Délai dépassé / erreur 5xx : prise comptée, petite pause avant de réessayer.
    if (r.outcome === "retry_later" && !bounded) await pause(BACKOFF_START_MS);
  }
  return 0;
}

let code = 0;
try {
  code = await main();
} catch (e) {
  console.error("[solveur] erreur fatale :", e);
  code = 1;
} finally {
  await disposeRunners();
}
process.exit(stopping ? 0 : code);
