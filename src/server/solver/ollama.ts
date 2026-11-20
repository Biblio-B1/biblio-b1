// Client minimal de l'API Ollama (`POST /api/generate`, sortie JSON structurée via `format`).
// Réservé au solveur (tsx) et aux tests : aucun import Next.

/**
 * Ollama injoignable (connexion refusée, hôte inconnu, connexion coupée) : l'exercice n'y est
 * pour rien, il reste en file sans que la prise soit comptée. Aussi levée si l'appel est
 * interrompu par `signal` (arrêt du solveur).
 */
export class OllamaUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OllamaUnavailableError";
  }
}

/**
 * Ollama a été joint mais l'appel a échoué :
 * - `config` : modèle introuvable (HTTP 404, ou 400 mentionnant le modèle) — à corriger dans
 *   `.env` / `ollama pull`, le solveur s'arrête ;
 * - `timeout` : délai HTTP dépassé ; `server` : HTTP 5xx, autre 4xx, réponse illisible —
 *   la prise est comptée (le plafond de prises finit par passer l'exercice `failed`).
 */
export class OllamaCallError extends Error {
  readonly kind: "config" | "timeout" | "server";
  readonly httpStatus: number | null;
  readonly body: string;
  constructor(kind: "config" | "timeout" | "server", message: string, opts: { httpStatus?: number; body?: string; cause?: unknown } = {}) {
    super(message, { cause: opts.cause });
    this.name = "OllamaCallError";
    this.kind = kind;
    this.httpStatus = opts.httpStatus ?? null;
    this.body = opts.body ?? "";
  }
}

/** Le modèle a répondu, mais pas du JSON exploitable : nouvelle tentative possible. */
export class ModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelOutputError";
  }
}

export type AskOptions = {
  url: string;
  model: string;
  fetchImpl?: typeof fetch;
  /** Délai HTTP total (défaut 15 min : ~3,7 jetons/s sur CPU, + ~30 s de chargement du modèle). */
  timeoutMs?: number;
  /** Interruption externe (arrêt du solveur). */
  signal?: AbortSignal;
};

export const DEFAULT_HTTP_TIMEOUT_MS = 15 * 60_000;

function describe(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = (e as { cause?: unknown }).cause;
  if (cause instanceof Error) return `${e.message} (${cause.message})`;
  return e.message;
}

/**
 * Envoie `prompt` au modèle et renvoie l'objet JSON produit (non validé : à passer à zod).
 * Erreurs : `OllamaUnavailableError` (connexion impossible ou interruption), `OllamaCallError`
 * (modèle introuvable, délai dépassé, HTTP 5xx…), `ModelOutputError` (JSON invalide).
 */
export async function askModel(prompt: string, schema: object, opts: AskOptions): Promise<unknown> {
  const doFetch = opts.fetchImpl ?? fetch;
  const endpoint = `${opts.url.replace(/\/+$/, "")}/api/generate`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
  const failure = (e: unknown, during: string): Error => {
    if (opts.signal?.aborted) return new OllamaUnavailableError("Appel au modèle interrompu (arrêt du solveur).", { cause: e });
    if (timeout.aborted) {
      return new OllamaCallError("timeout", `délai du modèle dépassé (${Math.round(timeoutMs / 1000)} s)`, { cause: e });
    }
    if (during === "connexion") {
      return new OllamaUnavailableError(`Ollama injoignable à ${opts.url} : ${describe(e)}`, { cause: e });
    }
    return new OllamaCallError("server", `erreur du modèle : réponse interrompue (${describe(e)})`, { cause: e });
  };
  let res: Response;
  try {
    res = await doFetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        prompt,
        stream: false,
        think: false,
        format: schema,
        options: { temperature: 0.2, num_ctx: 8192, num_predict: 3000 },
      }),
      signal,
    });
  } catch (e) {
    throw failure(e, "connexion");
  }
  let raw: string;
  try {
    raw = await res.text();
  } catch (e) {
    throw failure(e, "lecture");
  }
  if (!res.ok) {
    const body = raw.slice(0, 500);
    if (res.status === 404 || (res.status === 400 && /model/i.test(raw))) {
      throw new OllamaCallError("config", `modèle « ${opts.model} » refusé par Ollama (HTTP ${res.status}) : ${body}`, {
        httpStatus: res.status,
        body,
      });
    }
    throw new OllamaCallError("server", `erreur du modèle (HTTP ${res.status}) : ${body}`, { httpStatus: res.status, body });
  }
  let envelope: { response?: unknown };
  try {
    envelope = JSON.parse(raw) as { response?: unknown };
  } catch {
    throw new OllamaCallError("server", `erreur du modèle : réponse d'Ollama illisible : ${raw.slice(0, 300)}`, { body: raw.slice(0, 500) });
  }
  if (typeof envelope.response !== "string") {
    throw new ModelOutputError("Réponse du modèle vide.");
  }
  try {
    return JSON.parse(envelope.response) as unknown;
  } catch {
    throw new ModelOutputError(`JSON invalide : ${envelope.response.slice(0, 300)}`);
  }
}
