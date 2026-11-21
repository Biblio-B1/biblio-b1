import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client";
import { subjects } from "./db/schema";

import type { SubjectRules } from "@/lib/subject-rules";

export type { SubjectRules };

export type Subject = typeof subjects.$inferSelect;

type DefaultSubject = { name: string; slug: string; color: string; rules: SubjectRules };

const subject = (name: string, color: string, rules: SubjectRules): DefaultSubject => ({
  name,
  slug: slugify(name),
  color,
  rules,
});

/**
 * Matières par défaut : exactement les dossiers de cours de l'utilisateur (même nom).
 * Les règles servent aux fichiers sans dossier de matière (upload, fichiers en vrac).
 */
export const DEFAULT_SUBJECTS: DefaultSubject[] = [
  subject("Algorithmique et Prog C", "#2563eb", {
    pathPatterns: [
      // Locutions fixes : un "C" nu dans un nom de fichier ne compte pas.
      "\\balgo(rithmique)?\\s+et\\s+(prog(rammation)?\\s+)?c(?![a-z0-9'’])",
      "\\bprog(rammation)?[\\s_-]*c(?![a-z0-9'’])",
      "\\blangage\\s+c(?![a-z0-9'’])",
      "\\ben\\s+c(?![a-z0-9'’])",
      "\\bc\\s+language\\b",
      // Dossier entier nommé C (ou Cours C, Prog C, Langage C...), suivi d'un séparateur.
      "(^|[\\\\/])((cours|prog|programmation|langage)[\\s_-]*)?c[\\\\/]",
      "\\.[ch]$",
    ],
    keywords: {
      malloc: 3, calloc: 3, printf: 2, scanf: 2, "#include": 3, "#define": 2,
      struct: 2, "int main": 3, pointeur: 3, pointeurs: 3, pointer: 3, pointers: 3,
      "stdio.h": 3, "stdlib.h": 3, sizeof: 2, typedef: 2, "char *": 2, "void *": 2,
      "segmentation fault": 3, gcc: 2,
    },
  }),
  subject("Anglais professionnel & technique avancé", "#ea580c", {
    pathPatterns: ["\\banglais\\b", "\\benglish\\b", "\\btoeic\\b", "\\btoefl\\b"],
    keywords: {
      grammar: 3, vocabulary: 3, essay: 2, tense: 2, tenses: 2, "present perfect": 3,
      "past simple": 3, grammaire: 2, vocabulaire: 2, "phrasal verb": 3, "phrasal verbs": 3,
      adjective: 2, adverb: 2, "reading comprehension": 3, conjugation: 2, "irregular verbs": 3,
      "comprehension questions": 3, rubric: 1,
    },
  }),
  subject("comm-posture professionnelle", "#db2777", {
    pathPatterns: ["\\bposture\\b", "\\bprise\\s+de\\s+parole\\b"],
    keywords: { "prise de parole": 2, "langage corporel": 2, "posture professionnelle": 3, gestuelle: 1 },
  }),
  subject("Développement web Front-End", "#7c3aed", {
    pathPatterns: [
      "\\bhtml5?\\b", "\\bcss3?\\b", "\\bjavascript\\b", "\\bfront[\\s_-]*end\\b",
      "\\bflexbox\\b", "\\breact\\b", "\\bdeveloppement\\s+web\\b",
    ],
    keywords: {
      html: 2, css: 2, javascript: 3, dom: 2, flexbox: 3, "box model": 3, "<div": 2,
      "<html": 3, react: 2, queryselector: 3, addeventlistener: 3, selecteur: 2, selecteurs: 2,
      "media query": 3, "media queries": 3, "grid-template": 3, "font-size": 2,
    },
  }),
  subject("infra-data", "#0d9488", {
    pathPatterns: ["\\binfra[\\s_-]*data\\b", "\\bdata\\s*lake(house)?\\b", "\\bdatabricks\\b"],
    keywords: {
      databricks: 3, lakehouse: 3, "data lake": 3, "data warehouse": 3, etl: 2, elt: 1,
      nosql: 3, sql: 1, parquet: 3, hadoop: 3, spark: 2, "base de donnees": 1,
      "bases de donnees": 1, datacenter: 2, gpu: 1, stockage: 1,
    },
  }),
  subject("Linux & environnement IA", "#16a34a", {
    pathPatterns: ["\\blinux\\b", "\\bunix\\b", "\\bshell\\b", "\\bsystemes?\\s+d.exploitation\\b", "\\bgit(hub)?\\b"],
    keywords: {
      bash: 3, grep: 3, chmod: 3, chown: 3, shell: 2, terminal: 2, sudo: 3, ls: 1,
      "man page": 2, "/etc": 2, "/usr": 2, ssh: 2, systemd: 3,
      "script shell": 3, awk: 2, sed: 2, kernel: 2, noyau: 2,
      "git commit": 3, "git push": 3, vscode: 2,
    },
  }),
  subject("Mathématiques pour Info", "#dc2626", {
    pathPatterns: [
      "\\bmaths?\\b", "\\bmathematiques?\\b", "\\balgebre\\b", "\\banalyse\\b", "\\bprobabilites?\\b",
      "\\bboole(enne)?\\b", "\\blogique\\s+propositionnelle\\b", "\\bnumeration\\b",
    ],
    keywords: {
      integrale: 3, integrales: 3, derivee: 3, derivees: 3, matrice: 3, matrices: 3,
      theoreme: 3, equation: 2, equations: 2, limite: 2, "suite numerique": 3, vecteur: 2,
      determinant: 3, polynome: 3, integral: 3, derivative: 3, matrix: 3,
      theorem: 3, "espace vectoriel": 3, demonstration: 2,
      "table de verite": 3, "tables de verite": 3, "algebre de boole": 3, booleenne: 2,
    },
  }),
  subject("Présentations B1", "#64748b", {
    pathPatterns: ["\\bpresentation\\s+cursus\\b"],
    keywords: {},
  }),
  subject("Techaway dataanalysis", "#4f46e5", {
    pathPatterns: ["\\btechaway\\b"],
    keywords: { techaway: 3 },
  }),
];

/** Anciennes matières supprimées à nettoyer automatiquement dans la base existante. */
export const REMOVED_SUBJECT_SLUGS = ["shift-s-1-decoder-pour-agir", "shift-b1"] as const;

/** Insère les matières par défaut et retire les matières supprimées ; idempotent (clé unique `slug`). */
export function seedSubjects(db: Db): void {
  db.delete(subjects).where(inArray(subjects.slug, [...REMOVED_SUBJECT_SLUGS])).run();
  for (const s of DEFAULT_SUBJECTS) {
    db.insert(subjects).values(s).onConflictDoNothing({ target: subjects.slug }).run();
  }
}

export function listSubjects(db: Db): Subject[] {
  return db.select().from(subjects).orderBy(asc(subjects.createdAt), asc(subjects.name)).all();
}

// --- Administration des matières -------------------------------------------

const MAX_WEIGHT = 10;

export function normalizeKeyword(k: string): string {
  return k.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
}

/** Lit des lignes « mot-clé: poids » (poids entier 1–10, 1 par défaut). */
export function parseKeywordLines(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.*?)(?:\s*:\s*([^:]*))?$/.exec(line)!;
    const kw = normalizeKeyword(m[1] ?? "");
    if (!kw) continue;
    let weight = 1;
    if (m[2] !== undefined) {
      weight = Number(m[2].trim());
      if (!Number.isInteger(weight) || weight < 1 || weight > MAX_WEIGHT) {
        throw new Error(`Poids invalide pour « ${kw} » (entier de 1 à ${MAX_WEIGHT}).`);
      }
    }
    out[kw] = weight;
  }
  return out;
}

export function formatKeywordLines(keywords: Record<string, number>): string {
  return Object.entries(keywords)
    .map(([k, w]) => `${k}: ${w}`)
    .join("\n");
}

export const subjectInputSchema = z.object({
  name: z.string().trim().min(1, "Nom requis.").max(60, "Nom trop long (60 max)."),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur invalide (format #rrggbb)."),
  pathPatterns: z
    .array(z.string().trim().min(1).max(300))
    .max(50)
    .superRefine((patterns, ctx) => {
      for (const p of patterns) {
        try {
          new RegExp(p, "i");
        } catch {
          ctx.addIssue({ code: "custom", message: `Motif invalide : ${p}` });
        }
      }
    }),
  keywords: z.record(z.string().min(1).max(100), z.number().int().min(1).max(MAX_WEIGHT)),
});
export type SubjectInput = z.input<typeof subjectInputSchema>;

function parseSubjectInput(input: SubjectInput) {
  const r = subjectInputSchema.safeParse(input);
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? "Données invalides.");
  return r.data;
}

export function updateSubject(db: Db, id: string, input: SubjectInput): Subject {
  const data = parseSubjectInput(input);
  const row = db
    .update(subjects)
    .set({
      name: data.name,
      color: data.color.toLowerCase(),
      rules: { pathPatterns: data.pathPatterns, keywords: data.keywords } satisfies SubjectRules,
    })
    .where(eq(subjects.id, id))
    .returning()
    .get();
  if (!row) throw new Error("Matière introuvable.");
  return row;
}

export function slugify(name: string): string {
  return (
    normalizeKeyword(name)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "matiere"
  );
}

export function createSubject(db: Db, input: SubjectInput): Subject {
  const data = parseSubjectInput(input);
  const base = slugify(data.name);
  const taken = new Set(db.select({ slug: subjects.slug }).from(subjects).all().map((r) => r.slug));
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  return db
    .insert(subjects)
    .values({
      name: data.name,
      slug,
      color: data.color.toLowerCase(),
      rules: { pathPatterns: data.pathPatterns, keywords: data.keywords } satisfies SubjectRules,
    })
    .returning()
    .get();
}

export function getSubjectBySlug(db: Db, slug: string): Subject | undefined {
  return db.select().from(subjects).where(eq(subjects.slug, slug)).get();
}

export function deleteSubject(db: Db, id: string): void {
  const row = db.delete(subjects).where(eq(subjects.id, id)).returning().get();
  if (!row) throw new Error("Matière introuvable.");
}
