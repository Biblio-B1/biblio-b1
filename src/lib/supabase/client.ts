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

/** Le jeton est-il celui d'une connexion anonyme (mode invité) ? */
function isAnonymousToken(authorization: string | null): boolean {
  const token = authorization?.replace(/^Bearer\s+/i, "");
  const payload = token?.split(".")[1];
  if (!payload) return false;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return json?.is_anonymous === true;
  } catch {
    return false;
  }
}

/** Appels de lecture qui passent par POST (fonctions de recherche, liens signés des fichiers). */
const GUEST_ALLOWED_POST = [/\/rest\/v1\/rpc\/(search|directory_students)$/, /\/storage\/v1\/object\/sign\//];

/**
 * Mode invité : toute écriture est refusée avant même de partir (la vraie barrière reste la RLS),
 * avec un message clair plutôt qu'une erreur de droits.
 */
const guestFetch: typeof fetch = async (input, init) => {
  const asRequest = input instanceof Request ? input : null;
  const method = (init?.method ?? asRequest?.method ?? "GET").toUpperCase();
  const url = new URL(asRequest?.url ?? String(input));
  const headers = new Headers(init?.headers ?? asRequest?.headers);
  const write = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (
    write &&
    !url.pathname.startsWith("/auth/v1/") &&
    !GUEST_ALLOWED_POST.some((re) => re.test(url.pathname)) &&
    isAnonymousToken(headers.get("Authorization"))
  ) {
    const message = "Mode invité : consultation uniquement. Créez un compte pour ajouter ou supprimer.";
    return new Response(JSON.stringify({ message, error: message, code: "guest_read_only" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return fetch(input, init);
};

export function getSupabase(): SupabaseClient {
  client ??= createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "bb1-auth" },
    global: { fetch: guestFetch },
  });
  return client;
}
