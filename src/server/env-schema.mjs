// Schéma et validation de la configuration, en JavaScript pur : partagé par src/server/env.ts
// (application, instrumentation) et par scripts/start.mjs (vérification avant `next start`).
import { z } from "zod";

export const DEV_SESSION_SECRET = "dev-insecure-secret-change-me";

export const envSchema = z.object({
  ADMIN_INVITE_CODE: z.string().default(""),
  C_PROF_REPO_URL: z.string().min(1).default("https://github.com/S-L-A-K-E-R/C_courses"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("127.0.0.1"),
  HOSTNAME: z.string().default("127.0.0.1"),
  STORAGE_PATH: z.string().min(1).default("./storage"),
  LOCAL_COURSES_PATH: z.string().min(1).default("./sources/local"),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  // Réservé : les sessions sont des jetons aléatoires hachés, ce secret n'est pas utilisé.
  SESSION_SECRET: z.string().default(DEV_SESSION_SECRET),
  // Service de pré-calcul des vérifications (npm run solver) : Ollama local ou du PC.
  OLLAMA_URL: z
    .url({ protocol: /^https?$/, error: "URL http(s) attendue, ex. http://127.0.0.1:11434" })
    .default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().min(1).default("qwen3.8:27b"),
  // Délai maximal d'une exécution de la solution de référence (compilation comprise), en ms.
  SOLVER_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(5000),
  CALENDAR_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "clé hexadécimale de 32 octets attendue")
    .optional(),
  // Adresse publique de l'application (liens d'invitation), sans « / » final.
  APP_URL: z
    .url({ protocol: /^https?$/, error: "URL http(s) attendue, ex. http://192.168.1.20:3000" })
    .refine((u) => !u.endsWith("/"), "sans « / » final")
    .optional(),
});

/**
 * Valide un environnement brut (chaîne vide = variable non définie, retombe sur le défaut).
 * En production, refuse un ADMIN_INVITE_CODE vide ou laissé à « change-me ».
 * @param {Record<string, string | undefined>} source
 * @returns {z.infer<typeof envSchema>}
 */
export function parseEnv(source) {
  /** @type {Record<string, string>} */
  const raw = {};
  for (const key of Object.keys(envSchema.shape)) {
    const v = source[key];
    if (v !== undefined && v !== "") raw[key] = v;
  }
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Configuration invalide : ${parsed.error.issues
        .map((i) => `${i.path.join(".")} (${i.message})`)
        .join(", ")}. Corrigez le fichier .env.`,
    );
  }
  const data = parsed.data;
  if (source.NODE_ENV === "production") {
    if (data.ADMIN_INVITE_CODE.trim() === "" || data.ADMIN_INVITE_CODE === "change-me") {
      throw new Error(
        "Configuration de production refusée : ADMIN_INVITE_CODE doit être défini à une valeur secrète (pas « change-me »). Corrigez le fichier .env.",
      );
    }
  }
  return data;
}
