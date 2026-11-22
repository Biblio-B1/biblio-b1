// npm run sync : synchronise la base de travail du PC (SQLite) avec Supabase (le site).
//   1. rapatrie les exclusions (documents supprimés sur le site) ;
//   2. envoie matières, documents (+ fichiers), exercices et résultats du solveur ;
//   3. rapatrie les exercices déposés ou relancés sur le site.
// Premier transfert : npm run sync -- --admin-email <ton e-mail>
//   (inscris-toi d'abord sur le site) : ton compte devient admin et validé, ta progression et
//   ton calendrier lié sont repris, tes documents déposés te sont attribués.
// À relancer après chaque `npm run import`. Idempotent.
import fs from "node:fs";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { getDb } from "../src/server/db/client";
import { boostcampCalendarLinks, progress, users } from "../src/server/db/schema";
import { pullExclusions, pullPending, pushAll, supabaseAdmin } from "../src/server/sync/supabase-sync";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const { values } = parseArgs({ options: { "admin-email": { type: "string" } } });
const log = (m: string) => console.log(`[sync] ${m}`);

const db = getDb();
const sb = supabaseAdmin();

let adminId: string | null = null;
const email = values["admin-email"]?.trim().toLowerCase();
if (email) {
  const { data, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(error.message);
  const user = data.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) {
    console.error(`[sync] aucun compte ${email} sur le site : inscris-toi d'abord sur la page « Créer un compte ».`);
    process.exit(1);
  }
  adminId = user.id;
  const up = await sb.from("profiles").update({ role: "admin", status: "active" }).eq("id", adminId);
  if (up.error) throw new Error(up.error.message);
  log(`${email} : administrateur et validé.`);
}

await pullExclusions(db, sb, log);
const stats = await pushAll(db, sb, { authorId: adminId, log });
log(`envoyé : ${Object.entries(stats).map(([k, v]) => `${v} ${k}`).join(", ")}`);
await pullPending(db, sb, log);

if (adminId) {
  // Compte local de l'administrateur (ancien site) : progression et calendrier repris.
  const localAdmin = db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).get();
  if (localAdmin) {
    const rows = db.select().from(progress).where(eq(progress.userId, localAdmin.id)).all();
    if (rows.length) {
      const r = await sb
        .from("progress")
        .upsert(rows.map((p) => ({ user_id: adminId, exercise_id: p.exerciseId, status: p.status, updated_at: p.updatedAt.toISOString() })));
      if (r.error) throw new Error(r.error.message);
      log(`${rows.length} progression(s) reprise(s).`);
    }
    const cal = db.select().from(boostcampCalendarLinks).where(eq(boostcampCalendarLinks.userId, localAdmin.id)).get();
    if (cal) {
      // Même format chiffré et même clé (CALENDAR_ENCRYPTION_KEY) que la fonction calendar.
      const r = await sb.from("calendar_links").upsert({
        user_id: adminId,
        encrypted_url: cal.encryptedUrl,
        events: JSON.parse(cal.eventsJson),
        synced_at: cal.syncedAt.toISOString(),
      });
      if (r.error) throw new Error(r.error.message);
      log("calendrier lié repris.");
    }
  }
}
log("terminé.");
process.exit(0);
