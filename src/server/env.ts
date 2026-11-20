import { z } from "zod";

const schema = z.object({
  ADMIN_INVITE_CODE: z.string().default(""),
  C_PROF_REPO_URL: z
    .string()
    .min(1)
    .default("https://github.com/S-L-A-K-E-R/C_courses"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  STORAGE_PATH: z.string().min(1).default("./storage"),
  LOCAL_COURSES_PATH: z.string().min(1).default("./sources/local"),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  SESSION_SECRET: z.string().default("dev-insecure-secret-change-me"),
});

export type Env = z.infer<typeof schema>;

export const DEV_SESSION_SECRET = "dev-insecure-secret-change-me";

/** Valide un environnement brut (chaîne vide = variable non définie, retombe sur le défaut). */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const raw: Record<string, string | undefined> = {};
  for (const key of Object.keys(schema.shape)) {
    const v = source[key];
    if (v !== undefined && v !== "") raw[key] = v;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Configuration invalide : ${parsed.error.issues
        .map((i) => `${i.path.join(".")} (${i.message})`)
        .join(", ")}`,
    );
  }
  const data = parsed.data;
  if (source.NODE_ENV === "production") {
    const problems: string[] = [];
    if (data.SESSION_SECRET.trim() === "" || data.SESSION_SECRET === DEV_SESSION_SECRET || data.SESSION_SECRET === "change-me-to-a-long-random-string") {
      problems.push("SESSION_SECRET doit être une chaîne aléatoire longue (ex. : openssl rand -hex 32)");
    }
    if (data.ADMIN_INVITE_CODE.trim() === "" || data.ADMIN_INVITE_CODE === "change-me") {
      problems.push("ADMIN_INVITE_CODE doit être défini à une valeur secrète (pas « change-me »)");
    }
    if (problems.length) {
      throw new Error(`Configuration de production refusée : ${problems.join(" ; ")}. Corrigez le fichier .env.`);
    }
  }
  return data;
}

function readEnv(): Env {
  return parseEnv(process.env);
}

let cached: Env | undefined;

/** Lecture paresseuse : évite d'échouer au `next build` si le .env est absent. */
export const env: Env = new Proxy({} as Env, {
  get(_t, prop: string) {
    cached ??= readEnv();
    return cached[prop as keyof Env];
  },
});
