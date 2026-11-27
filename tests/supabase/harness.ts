// Harnais des tests de droits (RLS) : un Postgres en mémoire (PGlite) qui imite ce que Supabase
// fournit autour de nos migrations — schémas `auth` et `storage` réduits, rôles `anon`,
// `authenticated`, `service_role`, droits par défaut — puis applique les migrations de
// supabase/migrations. `as(userId)` change d'identité comme le ferait un jeton Supabase.
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../supabase/migrations");

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema extensions;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  is_anonymous boolean not null default false
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid default auth.uid()
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export type RlsDb = {
  db: PGlite;
  /** null = visiteur (anon) ; "service" = clé service_role ; sinon l'id d'un utilisateur connecté. */
  as(user: string | null | "service"): Promise<void>;
  /** Crée un compte (comme Supabase Auth) et renvoie son id ; le profil est créé par trigger. */
  signUp(email: string, name: string): Promise<string>;
  /** Connexion anonyme (bouton « Visiter en invité ») ; renvoie l'id du compte invité. */
  signInAnonymously(): Promise<string>;
  /** Exécute en superutilisateur (préparation des données), puis revient à l'identité courante. */
  admin<T>(fn: () => Promise<T>): Promise<T>;
  count(sql: string, params?: unknown[]): Promise<number>;
};

export async function createRlsDb(): Promise<RlsDb> {
  const db = new PGlite({ extensions: { unaccent } });
  await db.exec(SUPABASE_STUB);
  for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql")).sort()) {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
  }
  let current: string | null | "service" = "superuser";
  const as = async (user: string | null | "service") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user && user !== "service" ? user : ""]);
    if (user === null) await db.exec("set role anon");
    else if (user === "service") await db.exec("set role service_role");
    else await db.exec("set role authenticated");
    current = user;
  };
  const admin = async <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = current;
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    try {
      return await fn();
    } finally {
      if (prev !== "superuser") await as(prev as string | null | "service");
    }
  };
  const signUp = (email: string, name: string) =>
    admin(async () => {
      const r = await db.query<{ id: string }>(
        "insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('name', $2::text)) returning id",
        [email, name],
      );
      return r.rows[0].id;
    });
  const signInAnonymously = () =>
    admin(async () => {
      const r = await db.query<{ id: string }>("insert into auth.users (is_anonymous) values (true) returning id");
      return r.rows[0].id;
    });
  const count = async (sql: string, params: unknown[] = []) => {
    const r = await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) t`, params);
    return r.rows[0].n;
  };
  return { db, as, signUp, signInAnonymously, admin, count };
}
