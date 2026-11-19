import { z } from "zod";

const schema = z.object({
  ADMIN_INVITE_CODE: z.string().default(""),
  C_PROF_REPO_URL: z
    .string()
    .min(1)
    .default("https://github.com/S-L-A-K-E-R/C_courses"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  STORAGE_PATH: z.string().min(1).default("./storage"),
  SESSION_SECRET: z.string().default("dev-insecure-secret-change-me"),
});

export type Env = z.infer<typeof schema>;

// Chaîne vide dans .env = variable non définie (retombe sur le défaut).
function readEnv(): Env {
  const raw: Record<string, string | undefined> = {};
  for (const key of Object.keys(schema.shape)) {
    const v = process.env[key];
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
  return parsed.data;
}

let cached: Env | undefined;

/** Lecture paresseuse : évite d'échouer au `next build` si le .env est absent. */
export const env: Env = new Proxy({} as Env, {
  get(_t, prop: string) {
    cached ??= readEnv();
    return cached[prop as keyof Env];
  },
});
