// Liaison du compte Outlook de l'école (Microsoft) : connexion OpenID Connect avec PKCE, sans
// bibliothèque. Si l'élève est déjà connecté à Outlook dans son navigateur, Microsoft le renvoie
// aussitôt, sans redemander le mot de passe. Le site ne garde que l'adresse du compte (affichée
// « Lié : … ») : aucun accès aux mails, aucun jeton conservé.

/** Identifiant de l'application enregistrée sur portal.azure.com (vide : liaison indisponible). */
export const MS_CLIENT_ID = "";
const AUTHORITY = "https://login.microsoftonline.com/organizations/oauth2/v2.0";
/** Domaine des adresses de l'école : Microsoft va directement à la connexion de l'école. */
export const SCHOOL_DOMAIN = "edu.ece.fr";
const SCOPES = "openid profile email";
const STORE = "bb1-outlook-link";

export const outlookLinkAvailable = () => MS_CLIENT_ID !== "";

/** Adresse de retour : la page /outlook/ du site (même origine, chemin de base compris). */
export function outlookRedirectUri(origin: string, basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ""): string {
  return `${origin}${basePath}/outlook/`;
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function randomString(n = 32): string {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return b64url(a);
}

/** code_challenge = BASE64URL(SHA-256(code_verifier)) (RFC 7636). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(hash));
}

export function authorizeUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  challenge: string;
  loginHint?: string | null;
}): string {
  const u = new URL(`${AUTHORITY}/authorize`);
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("state", p.state);
  u.searchParams.set("nonce", p.nonce);
  u.searchParams.set("code_challenge", p.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("domain_hint", SCHOOL_DOMAIN);
  if (p.loginHint) u.searchParams.set("login_hint", p.loginHint);
  return u.toString();
}

/** Lance la liaison : redirection vers Microsoft, retour sur /outlook/ puis vers `returnTo`. */
export async function startOutlookLink(opts: { returnTo: string; siteEmail?: string | null }): Promise<void> {
  const verifier = randomString(48);
  const state = randomString();
  const nonce = randomString();
  const redirectUri = outlookRedirectUri(window.location.origin);
  sessionStorage.setItem(STORE, JSON.stringify({ verifier, state, nonce, returnTo: opts.returnTo }));
  // Indice de compte : l'adresse du site si c'est déjà une adresse de l'école.
  const hint = opts.siteEmail?.toLowerCase().endsWith(`@${SCHOOL_DOMAIN}`) ? opts.siteEmail : null;
  window.location.assign(
    authorizeUrl({ clientId: MS_CLIENT_ID, redirectUri, state, nonce, challenge: await pkceChallenge(verifier), loginHint: hint }),
  );
}

export type OutlookAccount = { email: string; name: string | null };

/** Contenu (non vérifié) d'un id_token : sert seulement à afficher l'adresse liée. */
export function readIdToken(idToken: string): { email: string | null; name: string | null; nonce: string | null } {
  const part = idToken.split(".")[1] ?? "";
  const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")), (c) => c.charCodeAt(0))));
  const email = (json.email ?? json.preferred_username ?? json.upn ?? null) as string | null;
  return { email: email ? email.toLowerCase() : null, name: (json.name as string | undefined) ?? null, nonce: (json.nonce as string | undefined) ?? null };
}

/** Message affiché pour une erreur renvoyée par Microsoft. */
export function outlookErrorMessage(error: string, description?: string | null): string {
  if (error === "access_denied") return "Liaison annulée.";
  if (/AADSTS65001|consent|admin/i.test(description ?? "")) {
    return "L'école n'autorise pas encore Biblio B1 sur les comptes Microsoft : un administrateur de l'école doit l'approuver.";
  }
  return "La connexion à Outlook n'a pas abouti. Réessayez.";
}

/** Fin de la liaison, sur /outlook/ : échange du code contre l'identité du compte. */
export async function finishOutlookLink(search: string): Promise<{ account: OutlookAccount; returnTo: string } | { error: string; returnTo: string }> {
  const saved = JSON.parse(sessionStorage.getItem(STORE) ?? "null") as { verifier: string; state: string; nonce: string; returnTo: string } | null;
  sessionStorage.removeItem(STORE);
  const returnTo = saved?.returnTo ?? "/settings";
  const q = new URLSearchParams(search);
  if (q.get("error")) return { error: outlookErrorMessage(q.get("error")!, q.get("error_description")), returnTo };
  const code = q.get("code");
  if (!saved || !code || q.get("state") !== saved.state) return { error: "Lien de connexion expiré : recommencez la liaison.", returnTo };
  const res = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: outlookRedirectUri(window.location.origin),
      code_verifier: saved.verifier,
      scope: SCOPES,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !data.id_token) return { error: outlookErrorMessage(data.error ?? "server_error", data.error_description), returnTo };
  const t = readIdToken(data.id_token);
  if (t.nonce !== saved.nonce || !t.email) return { error: "Réponse de Microsoft invalide : recommencez la liaison.", returnTo };
  return { account: { email: t.email, name: t.name }, returnTo };
}

export const isSchoolEmail = (email: string | null | undefined) => !!email && email.toLowerCase().endsWith(`@${SCHOOL_DOMAIN}`);
