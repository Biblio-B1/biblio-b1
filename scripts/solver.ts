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
 * `pending`, attente (60 s, doublée jusqu'à 15 min) puis nouvel essai. SIGINT/SIGTERM :
 * la ligne en cours est rendue à la file, les moteurs sont arrêtés, sortie 0.
 */
import fs from "node:fs";
import { parseArgs } from "node:util";
import { getDb } from "../src/server/db/client";
import { enqueueAllMissing, claimCheck, getCheck, releaseStale, requeueCheck, requeueFailed } from "../src/server/checks";
import { env } from "../src/server/env";
import { exercises } from "../src/server/db/schema";
import { processNext, solveExercise, type SolveDeps, type SolveOutcome } from "../src/server/solver/solve";
import { disposeRunners } from "../src/lib/runners/index.ts";
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

/** Attente interrompue par un signal d'arrêt. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    stop.signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

const db = getDb();
const deps: SolveDeps = {
  url: env.OLLAMA_URL,
  model: env.OLLAMA_MODEL,
  runTimeoutMs: env.SOLVER_TIMEOUT_MS,
  signal: stop.signal,
};

function logLine(id: string, outcome: SolveOutcome, durationMs: number): void {
  let title = "?";
  try {
    title = db.select({ t: exercises.title }).from(exercises).where(eq(exercises.id, id)).get()?.t ?? "(supprimé)";
  } catch {
    /* titre indisponible */
  }
  let detail = "";
  try {
    const c = getCheck(db, id);
    if (c && (outcome === "ready" || outcome === "failed")) {
      detail = outcome === "ready"
        ? ` ${c.language}, ${c.tests.length} tests, réf. ${c.referenceSource}`
        : ` ${c.error?.split("\n")[0].slice(0, 160) ?? ""}`;
    }
  } catch {
    /* ligne illisible */
  }
  const short = title.length > 60 ? `${title.slice(0, 57)}…` : title;
  console.log(`[solveur] ${id.slice(0, 8)} « ${short} » → ${outcome}${detail} (${(durationMs / 1000).toFixed(1)} s)`);
}

async function main(): Promise<number> {
  const released = releaseStale(db, STALE_MS);
  const added = enqueueAllMissing(db);
  const requeued = values["retry-failed"] ? requeueFailed(db) : 0;
  console.log(
    `[solveur] ${deps.model} via ${deps.url} — ${added} exercice(s) mis en file, ${released} reprise(s) libérée(s)` +
      (values["retry-failed"] ? `, ${requeued} échec(s) remis en file` : ""),
  );

  if (values.exercise !== undefined) {
    const id = values.exercise;
    if (!db.select({ id: exercises.id }).from(exercises).where(eq(exercises.id, id)).get()) {
      console.error(`[solveur] exercice introuvable : ${id}`);
      return 1;
    }
    if (!requeueCheck(db, id) || !claimCheck(db, id)) {
      console.error(`[solveur] ${id} : tests validés par un admin ou déjà en cours ailleurs, rien à faire.`);
      return 1;
    }
    const t0 = performance.now();
    const outcome = await solveExercise(db, id, deps);
    logLine(id, outcome, Math.round(performance.now() - t0));
    return outcome === "unavailable" ? 1 : 0;
  }

  let done = 0;
  let backoff = BACKOFF_START_MS;
  let warnedUnavailable = false;
  while (!stopping && done < limit) {
    let r;
    try {
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
      continue;
    }
    if (r.outcome === "unavailable") {
      if (!warnedUnavailable) {
        console.warn(`[solveur] Ollama injoignable (${deps.url}) : exercices laissés en file, nouvel essai plus tard.`);
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
    logLine(r.id, r.outcome, r.durationMs);
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
