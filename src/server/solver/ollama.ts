// Client minimal de l'API Ollama (`POST /api/generate`, sortie JSON structurée via `format`).
// Réservé au solveur (tsx) et aux tests : aucun import Next.

/** Ollama injoignable (refus de connexion, délai dépassé, erreur HTTP) : réessayer plus tard. */
export class OllamaUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OllamaUnavailableError";
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
 * Erreurs : `OllamaUnavailableError` (réseau, délai, HTTP non 2xx), `ModelOutputError` (JSON invalide).
 */
export async function askModel(prompt: string, schema: object, opts: AskOptions): Promise<unknown> {
  const doFetch = opts.fetchImpl ?? fetch;
  const endpoint = `${opts.url.replace(/\/+$/, "")}/api/generate`;
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
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
        options: { temperature: 0.2, num_ctx: 8192 },
      }),
      signal,
    });
  } catch (e) {
    throw new OllamaUnavailableError(`Ollama injoignable à ${opts.url} : ${describe(e)}`, { cause: e });
  }
  let raw: string;
  try {
    raw = await res.text();
  } catch (e) {
    throw new OllamaUnavailableError(`Réponse d'Ollama interrompue : ${describe(e)}`, { cause: e });
  }
  if (!res.ok) {
    throw new OllamaUnavailableError(`Ollama a répondu HTTP ${res.status} : ${raw.slice(0, 300)}`);
  }
  let envelope: { response?: unknown };
  try {
    envelope = JSON.parse(raw) as { response?: unknown };
  } catch {
    throw new OllamaUnavailableError(`Réponse d'Ollama illisible : ${raw.slice(0, 300)}`);
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
