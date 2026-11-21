// Edge Function `admin-users` : refuser une demande de compte = supprimer le compte en attente.
// Supprimer dans auth.users exige la clé service_role, d'où cette fonction ; la validation
// (status = 'active') se fait directement depuis le site, protégée par la RLS.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { canReject, type ProfileState } from "../_shared/admin-core.ts";
import { corsHeaders, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405, origin);

  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user) return json({ error: "Non authentifié" }, 401, origin);

  let body: { action?: string; userId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corps invalide" }, 400, origin);
  }
  if (body.action !== "reject" || typeof body.userId !== "string") {
    return json({ error: "Corps attendu : { action: 'reject', userId }" }, 400, origin);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: caller } = await admin.from("profiles").select("role, status").eq("id", userData.user.id).maybeSingle();
  const { data: target } = await admin.from("profiles").select("status").eq("id", body.userId).maybeSingle();
  if (!canReject(caller as ProfileState | null, target as Pick<ProfileState, "status"> | null)) {
    return json({ error: "Refus impossible : réservé aux administrateurs, pour un compte en attente." }, 403, origin);
  }
  const { error } = await admin.auth.admin.deleteUser(body.userId); // le profil suit (on delete cascade)
  if (error) return json({ error: error.message }, 500, origin);
  return json({ ok: true }, 200, origin);
});
