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

/** Codes d'erreur de l'erreur et de ses causes (undici : `cause.code`, parfois imbriquées). */
function errorCodes(e: unknown): string[] {
  const codes: string[] = [];
  for (let cur = e, depth = 0; cur && typeof cur === "object" && depth < 5; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") codes.push(code);
    const errors = (cur as { errors?: unknown }).errors; // AggregateError (IPv4 + IPv6)
    if (Array.isArray(errors)) for (const x of errors) codes.push(...errorCodes(x));
    cur = (cur as { cause?: unknown }).cause;
  }
  return codes;
}

/** Délais d'undici (fetch de Node) : en-têtes (300 s par défaut) ou corps entre deux morceaux. */
const TIMEOUT_CODES = new Set(["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
/**
 * Connexion impossible avant toute réponse : l'exercice reste en file sans compter la prise.
 * Outre ECONNREFUSED / ENOTFOUND / ECONNRESET, les codes « hôte injoignable » couvrent le cas
 * prévu par la spécification d'un PC éteint sur le réseau local (Chromebook → PC).
 */
const UNREACHABLE_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ECONNRESET",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EHOSTDOWN",
  "UND_ERR_CONNECT_TIMEOUT",
]);

type StreamLine = { response?: unknown; done?: unknown; error?: unknown };

/**
 * Envoie `prompt` au modèle et renvoie l'objet JSON produit (non validé : à passer à zod).
 * Mode `stream: true` : Ollama envoie les en-têtes avec le premier jeton (donc après le
 * chargement du modèle et le traitement de l'invite, ce qui peut prendre plusieurs minutes sur
 * CPU), puis des lignes NDJSON `{response, done}` ; les morceaux sont accumulés jusqu'à
 * `done: true` (avec `stream: false`, aucun en-tête n'arrive avant la fin de la génération et
 * le fetch de Node abandonne au bout de 300 s). Le délai global `timeoutMs` couvre tout l'appel.
 * Erreurs : `OllamaUnavailableError` (connexion impossible ou interruption), `OllamaCallError`
 * (modèle introuvable, délai dépassé, HTTP 5xx, flux interrompu…), `ModelOutputError` (JSON invalide).
 */
export async function askModel(prompt: string, schema: object, opts: AskOptions): Promise<unknown> {
  const doFetch = opts.fetchImpl ?? fetch;
  const endpoint = `${opts.url.replace(/\/+$/, "")}/api/generate`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
  const failure = (e: unknown, during: "connexion" | "lecture"): Error => {
    if (opts.signal?.aborted) return new OllamaUnavailableError("Appel au modèle interrompu (arrêt du solveur).", { cause: e });
    const codes = errorCodes(e);
    if (timeout.aborted || codes.some((c) => TIMEOUT_CODES.has(c))) {
      const what = timeout.aborted ? `${Math.round(timeoutMs / 1000)} s` : codes.find((c) => TIMEOUT_CODES.has(c));
      return new OllamaCallError("timeout", `délai du modèle dépassé (${what})`, { cause: e });
    }
    if (during === "connexion" && codes.some((c) => UNREACHABLE_CODES.has(c))) {
      return new OllamaUnavailableError(`Ollama injoignable à ${opts.url} : ${describe(e)}`, { cause: e });
    }
    return new OllamaCallError("server", `erreur du modèle : ${during === "connexion" ? "échec de la requête" : "réponse interrompue"} (${describe(e)})`, {
      cause: e,
    });
  };
  let res: Response;
  try {
    res = await doFetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        prompt,
        stream: true,
        think: false,
        format: schema,
        options: { temperature: 0.2, num_ctx: 8192, num_predict: 3000 },
      }),
      signal,
    });
  } catch (e) {
    throw failure(e, "connexion");
  }
  if (!res.ok) {
    let raw = "";
    try {
      raw = await res.text();
    } catch {
      /* corps illisible : le statut suffit */
    }
    const body = raw.slice(0, 500);
    if (res.status === 404 || (res.status === 400 && /model/i.test(raw))) {
      throw new OllamaCallError("config", `modèle « ${opts.model} » refusé par Ollama (HTTP ${res.status}) : ${body}`, {
        httpStatus: res.status,
        body,
      });
    }
    throw new OllamaCallError("server", `erreur du modèle (HTTP ${res.status}) : ${body}`, { httpStatus: res.status, body });
  }
  if (!res.body) throw new OllamaCallError("server", "erreur du modèle : réponse d'Ollama sans corps");

  // Lecture du flux NDJSON : une ligne = un objet { response, done } (ou { error }).
  let text = "";
  let done = false;
  let pending = "";
  const handleLine = (line: string) => {
    if (line.trim() === "" || done) return;
    let obj: StreamLine;
    try {
      obj = JSON.parse(line) as StreamLine;
    } catch {
      throw new OllamaCallError("server", `erreur du modèle : ligne du flux illisible : ${line.slice(0, 300)}`, { body: line.slice(0, 500) });
    }
    if (typeof obj.error === "string") {
      throw new OllamaCallError("server", `erreur du modèle : ${obj.error.slice(0, 500)}`, { body: obj.error.slice(0, 500) });
    }
    if (typeof obj.response === "string") text += obj.response;
    if (obj.done === true) done = true;
  };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (!done) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        throw failure(e, "lecture");
      }
      if (chunk.done) {
        pending += decoder.decode();
        break;
      }
      pending += decoder.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = pending.indexOf("\n")) >= 0) {
        handleLine(pending.slice(0, nl));
        pending = pending.slice(nl + 1);
      }
    }
    handleLine(pending); // dernière ligne sans saut de ligne final
  } finally {
    reader.cancel().catch(() => {});
  }
  if (!done) {
    throw new OllamaCallError("server", "erreur du modèle : flux interrompu avant la fin de la génération (done absent)");
  }
  if (text.trim() === "") throw new ModelOutputError("Réponse du modèle vide.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ModelOutputError(`JSON invalide : ${text.slice(0, 300)}`);
  }
}
