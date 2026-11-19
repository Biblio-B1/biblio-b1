import { asc } from "drizzle-orm";
import type { Db } from "./db/client";
import { subjects } from "./db/schema";

export type SubjectRules = {
  /** Expressions régulières (insensibles à la casse et aux accents) testées sur le chemin et le nom. */
  pathPatterns: string[];
  /** Mot-clé (sans accent, minuscule) -> poids. */
  keywords: Record<string, number>;
};

export type Subject = typeof subjects.$inferSelect;

type DefaultSubject = { name: string; slug: string; color: string; rules: SubjectRules };

export const DEFAULT_SUBJECTS: DefaultSubject[] = [
  {
    name: "Programmation C",
    slug: "prog-c",
    color: "#2563eb",
    rules: {
      pathPatterns: [
        "\\balgo(rithmique)?\\s+et\\s+c\\b",
        "\\bprog(rammation)?[\\s_-]*c\\b",
        "(^|[\\s/\\\\_-])c([\\s_.-]|$)",
        "\\.[ch]$",
      ],
      keywords: {
        malloc: 3, calloc: 3, printf: 2, scanf: 2, "#include": 3, "#define": 2,
        struct: 2, "int main": 3, pointeur: 3, pointeurs: 3, pointer: 3, pointers: 3,
        "stdio.h": 3, "stdlib.h": 3, sizeof: 2, typedef: 2, "char *": 2, "void *": 2,
        "segmentation fault": 3, gcc: 2,
      },
    },
  },
  {
    name: "Systèmes Linux",
    slug: "linux",
    color: "#16a34a",
    rules: {
      pathPatterns: ["\\blinux\\b", "\\bunix\\b", "\\bshell\\b", "\\bsystemes?\\s+d.exploitation\\b"],
      keywords: {
        bash: 3, grep: 3, chmod: 3, chown: 3, shell: 2, terminal: 2, sudo: 3, ls: 1,
        "man page": 2, "/etc": 2, "/usr": 2, ssh: 2, systemd: 3,
        "script shell": 3, awk: 2, sed: 2, kernel: 2, noyau: 2,
      },
    },
  },
  {
    name: "Mathématiques",
    slug: "maths",
    color: "#dc2626",
    rules: {
      pathPatterns: ["\\bmaths?\\b", "\\bmathematiques?\\b", "\\balgebre\\b", "\\banalyse\\b", "\\bprobabilites?\\b"],
      keywords: {
        integrale: 3, integrales: 3, derivee: 3, derivees: 3, matrice: 3, matrices: 3,
        theoreme: 3, equation: 2, equations: 2, limite: 2, "suite numerique": 3, vecteur: 2,
        determinant: 3, polynome: 3, integral: 3, derivative: 3, matrix: 3,
        theorem: 3, "espace vectoriel": 3, demonstration: 2,
      },
    },
  },
  {
    name: "Architecture des ordinateurs",
    slug: "archi",
    color: "#9333ea",
    rules: {
      pathPatterns: ["\\barchi(tecture)?\\b", "\\bordinateurs?\\b", "\\bassembleur\\b", "\\bmicroprocesseur\\b"],
      keywords: {
        processeur: 3, registre: 2, registres: 2, "memoire cache": 3, binaire: 2,
        hexadecimal: 2, assembleur: 3, alu: 3, cpu: 3, "bus de donnees": 3, pipeline: 2,
        "porte logique": 3, "portes logiques": 3, bascule: 2, ram: 2, "jeu d'instructions": 3,
        "complement a 2": 3, opcode: 3, mips: 3, risc: 3,
      },
    },
  },
  {
    name: "Anglais",
    slug: "anglais",
    color: "#ea580c",
    rules: {
      pathPatterns: ["\\banglais\\b", "\\benglish\\b", "\\btoeic\\b", "\\btoefl\\b"],
      keywords: {
        grammar: 3, vocabulary: 3, essay: 2, tense: 2, tenses: 2, "present perfect": 3,
        "past simple": 3, grammaire: 2, vocabulaire: 2, "phrasal verb": 3, "phrasal verbs": 3,
        adjective: 2, adverb: 2, "reading comprehension": 3, conjugation: 2, "irregular verbs": 3,
      },
    },
  },
];

/** Insère les matières par défaut ; idempotent (clé unique `slug`). */
export function seedSubjects(db: Db): void {
  for (const s of DEFAULT_SUBJECTS) {
    db.insert(subjects).values(s).onConflictDoNothing({ target: subjects.slug }).run();
  }
}

export function listSubjects(db: Db): Subject[] {
  return db.select().from(subjects).orderBy(asc(subjects.createdAt), asc(subjects.name)).all();
}
