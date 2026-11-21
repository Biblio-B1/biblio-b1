// Client Supabase du navigateur. L'adresse du projet et la clé publiable sont publiques par
// conception (la sécurité repose sur la RLS) : valeurs par défaut ici, surchargeables au build.
// Ne JAMAIS mettre ici la clé secrète (service_role / sb_secret_…).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://iwztvxkovnvcqgiaqacq.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_TimzLf_Jg4s2AOd38cXEhw_tHbqULjW";

/** Bucket privé des documents, images des messages et pièces jointes. */
export const FILES_BUCKET = "files";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  client ??= createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "bb1-auth" },
  });
  return client;
}
