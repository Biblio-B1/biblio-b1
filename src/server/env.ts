import type { z } from "zod";
import { DEV_SESSION_SECRET, envSchema, parseEnv as parseEnvJs } from "./env-schema.mjs";

export type Env = z.infer<typeof envSchema>;

export { DEV_SESSION_SECRET };

/** Valide un environnement brut (chaîne vide = variable non définie, retombe sur le défaut). */
export function parseEnv(source: Record<string, string | undefined>): Env {
  return parseEnvJs(source);
}

/**
 * Validation au démarrage du serveur (instrumentation, scripts/start.mjs) : lève l'erreur
 * française de parseEnv si la configuration est invalide ou refusée en production.
 */
export function validateEnv(source: Record<string, string | undefined> = process.env): Env {
  return parseEnv(source);
}

let cached: Env | undefined;

/** Lecture paresseuse : évite d'échouer au `next build` si le .env est absent. */
export const env: Env = new Proxy({} as Env, {
  get(_t, prop: string) {
    cached ??= parseEnv(process.env);
    return cached[prop as keyof Env];
  },
});
