// Synchronisation entre la base de travail du PC (SQLite : import des cours, solveur Qwen) et
// Supabase (le site). Clé service_role lue dans .env (jamais publiée).
//
// Sens PC → Supabase (push) : matières, documents (+ fichiers), exercices, résultats du solveur.
// Sens Supabase → PC (pull) : exclusions d'import (documents supprimés sur le site), exercices
// déposés sur le site et vérifications relancées par un administrateur.
// Supabase fait foi pour les vérifications validées par un admin : jamais écrasées.
import fs from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { documents, exerciseChecks, exercises, importExclusions, subjects } from "../db/schema";
import { resolveStoragePath } from "../storage";
import { fromPg, pullPlan, toPg, type LocalCheck } from "./mapping";

const BUCKET = "files";
const BATCH = 50;

export type Log = (msg: string) => void;

export function supabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définis dans .env.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function chunks<T>(items: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what} : ${error.message}`);
  return data;
}

async function remoteIds(sb: SupabaseClient, table: string, column = "id"): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const rows = await ok(sb.from(table).select(column).range(from, from + 999), `Lecture ${table}`);
    for (const r of rows as unknown as Record<string, string>[]) ids.add(r[column]);
    if ((rows as unknown[]).length < 1000) return ids;
  }
}

// ---------------------------------------------------------------------------------------------
// Supabase → PC
// ---------------------------------------------------------------------------------------------

/** Documents supprimés sur le site : retirés du PC et exclus des prochains imports. */
export async function pullExclusions(db: Db, sb: SupabaseClient, log: Log = () => {}): Promise<number> {
  const rows = (await ok(sb.from("import_exclusions").select("sha256, source_path, deleted_at"), "Exclusions")) as {
    sha256: string;
    source_path: string | null;
    deleted_at: string;
  }[];
  let removed = 0;
  for (const r of rows) {
    db.insert(importExclusions)
      .values({ sha256: r.sha256, sourcePath: r.source_path, deletedAt: new Date(r.deleted_at), deletedBy: null })
      .onConflictDoNothing()
      .run();
    removed += db.delete(documents).where(eq(documents.sha256, r.sha256)).run().changes;
  }
  if (removed) log(`${removed} document(s) supprimé(s) sur le site retiré(s) du PC.`);
  return removed;
}

/** Exercices en attente côté site (déposés ou relancés) : rapatriés pour le solveur. */
export async function pullPending(db: Db, sb: SupabaseClient, log: Log = () => {}): Promise<{ fetched: number; requeued: number }> {
  const remote = (await ok(
    sb.from("exercise_checks").select("exercise_id, status, verified, updated_at").eq("status", "pending").eq("verified", false),
    "Vérifications en attente",
  )) as { exercise_id: string; status: string; verified: boolean; updated_at: string }[];
  if (!remote.length) return { fetched: 0, requeued: 0 };
  const localRows = db
    .select({ id: exerciseChecks.exerciseId, status: exerciseChecks.status, updatedAt: exerciseChecks.updatedAt })
    .from(exerciseChecks)
    .where(inArray(exerciseChecks.exerciseId, remote.map((r) => r.exercise_id)))
    .all();
  const local = new Map<string, LocalCheck>(localRows.map((r) => [r.id, { status: r.status, updatedAt: r.updatedAt }]));
  const plan = pullPlan(
    remote.map((r) => ({ exerciseId: r.exercise_id, status: r.status, verified: r.verified, updatedAt: new Date(r.updated_at) })),
    local,
  );

  for (const ids of chunks(plan.fetch)) {
    const exs = (await ok(sb.from("exercises").select("*").in("id", ids), "Exercices")) as Record<string, unknown>[];
    const docIds = [...new Set(exs.map((e) => e.document_id as string))];
    const docs = (await ok(sb.from("documents").select("*").in("id", docIds), "Documents")) as Record<string, unknown>[];
    const subjIds = [...new Set([...docs, ...exs].map((r) => r.subject_id as string | null).filter((x): x is string => !!x))];
    const subs = subjIds.length ? ((await ok(sb.from("subjects").select("*").in("id", subjIds), "Matières")) as Record<string, unknown>[]) : [];
    db.transaction((tx) => {
      for (const s of subs) tx.insert(subjects).values(fromPg(s) as typeof subjects.$inferInsert).onConflictDoNothing().run();
      for (const d of docs) {
        // Auteur : compte du site, inconnu de la base du PC.
        tx.insert(documents).values({ ...(fromPg(d) as typeof documents.$inferInsert), authorId: null }).onConflictDoNothing().run();
      }
      for (const e of exs) {
        tx.insert(exercises).values(fromPg(e) as typeof exercises.$inferInsert).onConflictDoNothing().run();
        tx.insert(exerciseChecks).values({ exerciseId: e.id as string, status: "pending" }).onConflictDoNothing().run();
      }
    });
  }
  for (const id of plan.requeue) {
    db.update(exerciseChecks)
      .set({ status: "pending", verified: false, attempts: 0, error: null, updatedAt: new Date() })
      .where(eq(exerciseChecks.exerciseId, id))
      .run();
  }
  if (plan.fetch.length || plan.requeue.length) {
    log(`${plan.fetch.length} nouvel(s) exercice(s) du site, ${plan.requeue.length} relance(s).`);
  }
  return { fetched: plan.fetch.length, requeued: plan.requeue.length };
}

// ---------------------------------------------------------------------------------------------
// PC → Supabase
// ---------------------------------------------------------------------------------------------

function checkRow(c: typeof exerciseChecks.$inferSelect): Record<string, unknown> {
  // verified_by : identifiant SQLite, sans correspondance côté site.
  return { ...toPg(c), verified_by: null };
}

/** Envoie le résultat du solveur pour un exercice, sauf si un admin a validé les tests en ligne. */
export async function pushCheck(db: Db, sb: SupabaseClient, exerciseId: string): Promise<void> {
  const c = db.select().from(exerciseChecks).where(eq(exerciseChecks.exerciseId, exerciseId)).get();
  if (!c) return;
  const row = checkRow(c);
  delete row.verified;
  await ok(sb.from("exercise_checks").update(row).eq("exercise_id", exerciseId).eq("verified", false), "Envoi du résultat");
}

export type PushOptions = { authorId?: string | null; log?: Log };

/** Envoie tout ce que le site n'a pas encore (idempotent : relançable sans doublon). */
export async function pushAll(db: Db, sb: SupabaseClient, opts: PushOptions = {}): Promise<Record<string, number>> {
  const log = opts.log ?? (() => {});
  const stats: Record<string, number> = {};

  const subs = db.select().from(subjects).all();
  await ok(sb.from("subjects").upsert(subs.map(toPg), { onConflict: "id" }), "Matières");
  stats.matieres = subs.length;

  const haveDocs = await remoteIds(sb, "documents");
  const docs = db.select().from(documents).all().filter((d) => !haveDocs.has(d.id));
  let files = 0;
  for (const d of docs) {
    try {
      const abs = resolveStoragePath(d.filePath);
      if (fs.existsSync(abs)) {
        const up = await sb.storage.from(BUCKET).upload(d.filePath, fs.readFileSync(abs), { contentType: d.mime, upsert: true });
        if (up.error) throw new Error(up.error.message);
        files++;
      } else log(`fichier absent du PC : ${d.filePath}`);
    } catch (e) {
      log(`envoi impossible (${d.title}) : ${e instanceof Error ? e.message : e}`);
    }
  }
  for (const batch of chunks(docs)) {
    const rows = batch.map((d) => ({ ...toPg(d), author_id: opts.authorId ?? null }));
    await ok(sb.from("documents").upsert(rows, { onConflict: "id" }), "Documents");
  }
  stats.documents = docs.length;
  stats.fichiers = files;
  if (docs.length) log(`${docs.length} document(s) et ${files} fichier(s) envoyés.`);

  // Exercices : tous (classement ou énoncé ont pu changer) ; le trigger crée une vérification « pending ».
  const exs = db.select().from(exercises).all();
  for (const batch of chunks(exs)) await ok(sb.from("exercises").upsert(batch.map(toPg), { onConflict: "id" }), "Exercices");
  stats.exercices = exs.length;

  // Vérifications : résultat local envoyé s'il est plus récent et pas validé par un admin en ligne.
  const remote = new Map<string, { updated: number; verified: boolean }>();
  for (let from = 0; ; from += 1000) {
    const rows = (await ok(sb.from("exercise_checks").select("exercise_id, updated_at, verified").range(from, from + 999), "Vérifications")) as {
      exercise_id: string;
      updated_at: string;
      verified: boolean;
    }[];
    for (const r of rows) remote.set(r.exercise_id, { updated: new Date(r.updated_at).getTime(), verified: r.verified });
    if (rows.length < 1000) break;
  }
  const checks = db
    .select()
    .from(exerciseChecks)
    .all()
    .filter((c) => {
      const r = remote.get(c.exerciseId);
      if (r?.verified) return false;
      // Ligne créée par le trigger juste avant (pending, sans résultat) : le résultat local l'emporte.
      return !r || c.status !== "pending" || c.updatedAt.getTime() >= r.updated;
    });
  for (const batch of chunks(checks)) await ok(sb.from("exercise_checks").upsert(batch.map(checkRow), { onConflict: "exercise_id" }), "Vérifications");
  stats.verifications = checks.length;
  return stats;
}
