// Catégorisation, sous-groupement adaptatif et tri pédagogique automatiques des documents.
// Aucune dépendance Node : utilisé dans le navigateur (pages Bibliothèque / Matière / Document) et en tests.

export const DOC_CATEGORY_IDS = [
  "course",
  "exercises",
  "corrections",
  "exams",
  "projects",
  "notes",
  "photos",
  "syllabus",
] as const;

export type DocCategoryId = (typeof DOC_CATEGORY_IDS)[number];

export type DocCategoryMeta = {
  id: DocCategoryId;
  label: string;
  shortLabel: string;
};

export const DOC_CATEGORIES: readonly DocCategoryMeta[] = [
  { id: "course", label: "Cours", shortLabel: "Cours" },
  { id: "exercises", label: "TD, TP & Exercices", shortLabel: "TD / TP / Exos" },
  { id: "corrections", label: "Corrigés", shortLabel: "Corrigés" },
  { id: "exams", label: "Annales & examens", shortLabel: "Examens" },
  { id: "projects", label: "Projets & devoirs", shortLabel: "Projets / DM" },
  { id: "notes", label: "Fiches & mémos", shortLabel: "Fiches / Mémos" },
  { id: "photos", label: "Photos & schémas", shortLabel: "Photos" },
  { id: "syllabus", label: "Programme & syllabus", shortLabel: "Syllabus" },
];

export const DOC_CATEGORY_MAP: Record<DocCategoryId, DocCategoryMeta> = Object.fromEntries(
  DOC_CATEGORIES.map((c) => [c.id, c]),
) as Record<DocCategoryId, DocCategoryMeta>;

const LEGACY_TYPE_TO_CATEGORY: Record<string, DocCategoryId> = {
  course: "course",
  exercise: "exercises",
  exam: "exams",
  photo: "photos",
  note: "notes",
};

export type CategorizableDoc = {
  id: string;
  title: string;
  type: "course" | "photo" | "exercise" | "exam" | "note";
  subjectId: string | null;
  filePath: string;
  mime: string;
  source?: "upload" | "local" | "github";
  sourcePath: string | null;
  tags: string[];
  correctionOfId: string | null;
  /** Catégorie choisie à la main (administrateur) : prioritaire sur la détection. */
  category?: string | null;
  createdAt?: Date;
};

export type DocumentSubGroup<T> = {
  label: string;
  docs: T[];
};

export type DocumentCategoryGroup<T> = {
  category: DocCategoryMeta;
  docs: T[];
  subGroups?: DocumentSubGroup<T>[];
};

const frCollator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });

/** Minuscule, sans accents, séparateurs Windows convertis en `/`. */
function normPath(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\\/g, "/");
}

/** Minuscule, sans accents, `_` remplacé par un espace. */
function normWords(s: string): string {
  return normPath(s).replace(/_/g, " ");
}

function splitDirSegments(sourcePath: string | null): string[] {
  if (!sourcePath) return [];
  return normPath(sourcePath)
    .split("/")
    .slice(0, -1)
    .map((s) => s.replace(/\.zip$/i, "").replace(/_/g, " ").trim())
    .filter(Boolean);
}

function rawPartsOf(sourcePath: string | null): string[] {
  if (!sourcePath) return [];
  return sourcePath.replace(/\\/g, "/").split("/").filter(Boolean);
}

function stemFromSourcePath(sourcePath: string | null): string {
  if (!sourcePath) return "";
  const last = normPath(sourcePath).split("/").pop() ?? "";
  return last.replace(/\.[^.]+$/, "").replace(/_/g, " ").trim();
}

export function parseCategory(raw?: string | null, legacyType?: string | null): DocCategoryId | undefined {
  if (raw) {
    return (DOC_CATEGORY_IDS as readonly string[]).includes(raw) ? (raw as DocCategoryId) : undefined;
  }
  if (legacyType && legacyType in LEGACY_TYPE_TO_CATEGORY) {
    return LEGACY_TYPE_TO_CATEGORY[legacyType];
  }
  return undefined;
}

// --- Règles de détection automatique ----------------------------------------

const PROJECT_DIR_RE = /^(?:\d+[\s.\-_]+)?(projects?|projets?|mini[\s-]*projets?|homeworks?|devoirs?\s+maison|dm(?:\s*\d+)?|livrables?)$/i;
const PROJECT_NAME_RE =
  /(?<![a-z])(projects?|projets?|mini[\s-]*projets?|homeworks?|assignments?|devoirs?\s+maison|dm\s*\d+|etudes?\s+de\s+cas|case\s+stud(?:y|ies)|soutenances?|livrables?|cahier\s+des\s+charges)(?![a-z])/i;

const MIXED_COMPILATION_RE =
  /(?<![a-z])((?:annales|examens?|partiels?|exercices?|exos?|sujets?|enonces?|ds)[\s\-]+(?:et|avec)[\s\-]+(?:corriges?|corrections?)|(?:annales|anciens[\s\-]+(?:ds|examens|partiels|sujets)|recueil[\s\-]+d.?exercices|poly(?:copie)?[\s\-]+d.?exercices)[\s\-]+(?:corriges?|corrections?)|(?:examens|partiels|exercices|exos|sujets)[\s\-]+corriges)(?![a-z])/i;

const CORRECTION_STRONG_RE = /(?<![a-z])(corrig(?:e|es|ee|ees)|corrections?|correctifs?|answer\s*keys?)(?![a-z])/i;
const CORRECTION_DIR_RE = /^(?:\d+[\s.\-_]+)?(corrig(?:e|es|ee|ees)|corrections?|correctifs?|solutions?)(?:$|[\s\-–—.(])/i;
const SOLUTION_NAME_RE =
  /(?:^solutions?(?:$|\s*[:\-–—])|[\(\[]\s*solutions?\s*[\)\]]|[\-–—]\s*solutions?(?![a-z])|(?<![a-z])solutions?$|(?<![a-z])(?:td|tp|lab|exos?|exercices?|exercises?|exams?|examens?|partiels?|ds|dm)\s*\d*[\s\-–—]*solutions?(?![a-z])|(?<![a-z])solutions?[\s\-–—]+(?:de\s+|du\s+|des\s+|d.?|to\s+|for\s+)?(?:td|tp|lab|exos?|exercices?|exercises?|exams?|examens?|partiels?|ds|dm)(?![a-z]))/i;

const SYLLABUS_DIR_RE = /^(?:\d+[\s.\-_]+)?(syllabus|programmes?|plan\s+de\s+cours|modalites|presentations?\s+(?:du\s+)?(?:cursus|module|b1))$/i;
const SYLLABUS_NAME_RE =
  /(?<![a-z])(syllabus|plan\s+de\s+cours|programme\s+(?:du\s+cours|pedagogique|annuel|b1)|presentation\s+(?:du\s+)?(?:cursus|module|b1|de\s+la\s+matiere)|modalites\s+d.?evaluation|mcc|calendrier\s+(?:du\s+cours|pedagogique))(?![a-z])/i;

const EXAM_DIR_RE = /(?<![a-z])(exams?|examens?|partiels?|annales?|mock(?:\s+exams?)?|midterms?|controles?|devoirs?\s+surveilles?)(?![a-z])/i;
const EXAM_NAME_RE =
  /(?<![a-z])(exams?|examens?|partiels?|annales?|mock|midterm|devoirs?\s+surveilles?|ds\s*\d*|cc\s*\d+|qcm\s+note|controles?(?:\s+continu)?|sujet[\s\-]*(?:d.?exam|\d{2,4})|toeic|toefl)(?![a-z])/i;

const MEMO_NAME_RE =
  /(?<![a-z])(memos?|mementos?|fiches?(?:\s+de\s+revision|\s+synthese|\s+memo)?|resumes?|syntheses?|cheat[\s-]*sheets?|aide[\s-]*memoire|formulaires?|recaps?|recapitulatifs?|glossaires?|lexiques?|rappels?)(?![a-z])/i;

const EXERCISE_DIR_RE =
  /(?<![a-z])(exercises?|exercices?|exos?(?:details)?|lab(?:\s+general)?|labs|revisions?|td(?:\s*\d+)?|tp(?:\s*\d+)?|soutien|ateliers?|worksheets?)(?![a-z])/i;
const EXERCISE_NAME_RE =
  /(?<![a-z])(td\s*\d*|tp\s*\d*|lab\s*\d*|exos?\s*\d*|exercices?|exercises?|worksheets?|entrainements?|training|soutien|ateliers?|qcm|quiz|cahier\s+d.?exo|feuille\s+d.?exercices?|serie\s+\d+|pratique)(?![a-z])/i;

/** Classe automatiquement un document dans l'une des 8 catégories pédagogiques. */
export function categorizeDocument(doc: CategorizableDoc): DocCategoryId {
  // 0. Catégorie choisie par un administrateur
  const forced = doc.category ? parseCategory(doc.category) : undefined;
  if (forced) return forced;

  // 1. Photos & schémas
  if (doc.type === "photo" || doc.mime.startsWith("image/")) return "photos";

  // 2. Corrigé explicitement apparié à un énoncé
  if (doc.correctionOfId != null) return "corrections";

  const dirSegments = splitDirSegments(doc.sourcePath);
  const titleNorm = normWords(doc.title);
  const stemNorm = stemFromSourcePath(doc.sourcePath);
  const nameText = `${titleNorm} ${stemNorm}`.trim();

  // 3. Projets & devoirs
  if (dirSegments.some((s) => PROJECT_DIR_RE.test(s)) || PROJECT_NAME_RE.test(nameText)) {
    return "projects";
  }

  // 4. Corrigés autonomes (hors compilations mixtes énoncés+corrigés)
  if (
    !MIXED_COMPILATION_RE.test(nameText) &&
    (CORRECTION_STRONG_RE.test(nameText) ||
      SOLUTION_NAME_RE.test(nameText) ||
      dirSegments.some((s) => !MIXED_COMPILATION_RE.test(s) && CORRECTION_DIR_RE.test(s)))
  ) {
    return "corrections";
  }

  // 5. Programme & syllabus
  if (dirSegments.some((s) => SYLLABUS_DIR_RE.test(s)) || SYLLABUS_NAME_RE.test(nameText)) {
    return "syllabus";
  }

  // 6. Annales & examens
  if (doc.type === "exam" || dirSegments.some((s) => EXAM_DIR_RE.test(s)) || EXAM_NAME_RE.test(nameText)) {
    return "exams";
  }

  // 7. Fiches & mémos
  if (doc.type === "note" || MEMO_NAME_RE.test(nameText)) {
    return "notes";
  }

  // 8. TD, TP & Exercices
  if (
    doc.type === "exercise" ||
    dirSegments.some((s) => EXERCISE_DIR_RE.test(s)) ||
    EXERCISE_NAME_RE.test(nameText)
  ) {
    return "exercises";
  }

  // 9. Défaut
  return "course";
}

// --- Sous-groupes -----------------------------------------------------------

const GENERIC_LOCAL_DIRS = new Set([
  "resources",
  "ressources",
  "pdf",
  "pdf archive",
  "archive",
  "archives",
  "docs",
  "documents",
  "files",
  "fichiers",
  "images",
  "img",
  "assets",
  "annexes",
]);

const GITHUB_ROOTS = new Set(["archive", "courses", "exercises", "exams", "homeworks", "projects", "syllabus"]);

function cleanSegmentName(seg: string): string {
  return seg
    .replace(/\.zip$/i, "")
    .replace(/-\d{8}(?:T\d{6}Z(?:-\d+-\d+)?)?$/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function capitalizeFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Extrait un sous-groupe lisible d'après le chemin source (dépôt prof ou dossiers locaux). */
export function extractSubGroup(doc: CategorizableDoc, categoryId: DocCategoryId): string | null {
  if (!doc.sourcePath) return null;
  const parts = rawPartsOf(doc.sourcePath);
  if (parts.length < 2) return null;

  const dirs = parts.slice(0, -1);
  const topNorm = normWords(dirs[0]);
  const isGithub = doc.source === "github" || (doc.source !== "local" && GITHUB_ROOTS.has(topNorm));

  if (isGithub) {
    if (topNorm === "archive") {
      if (dirs.length >= 3 && /^20\d{2}$/.test(dirs[1].trim())) {
        const subNorm = normWords(dirs[2]);
        if (/^\d{1,3}\s/.test(subNorm)) {
          if (categoryId === "course") return "Cours par chapitre";
          if (categoryId === "exercises") return "TD & TP par chapitre";
          if (categoryId === "corrections") return "Corrigés TD & TP";
          if (categoryId === "notes") return "Mémos de cours";
          return null;
        }
        if (subNorm === "unsorted mess") {
          if (dirs.length >= 4) {
            const zipClean = cleanSegmentName(dirs[3]);
            const zipNorm = normWords(zipClean);
            if (/^ece\s*-\s*partiels\s+et\s+corrections$/i.test(zipNorm)) return "Partiels ECE";
            if (/^exos?\s*details/i.test(zipNorm)) return "Exercices complémentaires";
            if (/^drive[\s-]*download/i.test(zipNorm)) return "Autres fichiers";
            return zipClean || "Autres fichiers";
          }
          return "Autres fichiers";
        }
      }
      return null;
    }

    if (topNorm === "courses") {
      if (dirs.length >= 2 && /^tpe[\s_-]/i.test(dirs[1].trim())) return "Supports TPE";
      return null;
    }

    if (topNorm === "exercises") {
      if (dirs.length >= 2) {
        const sub = normWords(dirs[1]);
        if (sub === "lab general") return "Lab général (FR / EN)";
        if (sub === "revisions") return "Révisions & soutien";
        return capitalizeFirst(cleanSegmentName(dirs[1]));
      }
      return "Recueils d'exercices";
    }

    if (topNorm === "exams") {
      if (doc.tags.includes("externe") || (dirs.length >= 2 && /^\d*\.?\s*inspirations?$/i.test(normWords(dirs[1])))) {
        return "Annales externes";
      }
      if (dirs.length >= 2 && /^(20\d{2})$/.test(dirs[1].trim())) {
        return `Examens ${dirs[1].trim()}`;
      }
      return null;
    }

    if (topNorm === "homeworks") {
      if (dirs.length >= 2) {
        const cleaned = cleanSegmentName(dirs[1]).replace(/^tpe\d+\s*[-–—]\s*\d+\s*[-–—]\s*/i, "").trim();
        return cleaned ? `Devoir — ${capitalizeFirst(cleaned)}` : "Devoirs";
      }
      return "Devoirs";
    }

    if (topNorm === "projects") {
      const fullNorm = `${normPath(doc.sourcePath)} ${normWords(doc.title)}`;
      return /\bchess\b/.test(fullNorm) ? "Projet Chess" : "Projets";
    }

    return null;
  }

  // Dossiers locaux : <Matière>/<sous-dossier>/.../<fichier>
  const subDirs = dirs.slice(1);
  for (const rawSeg of subDirs) {
    const cleaned = cleanSegmentName(rawSeg);
    const norm = normWords(cleaned);
    if (!norm || GENERIC_LOCAL_DIRS.has(norm)) continue;
    return capitalizeFirst(cleaned);
  }
  return null;
}

// --- Tri pédagogique naturel ------------------------------------------------

const KEYWORD_NUM_RE =
  /(?<![a-z])(?:cours|chapitre|chap|ch|td|tp|tpe|lab|exos?|exercices?|exercises?|seances?|modules?|parties?|parts?|semaines?|weeks?|fiches?|dm|ds|cc|soutien)[\s.\-–—#]*(\d{1,3})(?![a-z0-9])/i;

function extractOrderKey(doc: CategorizableDoc): number | null {
  // 1. Tag chapitre-NN
  for (const tag of doc.tags) {
    const m = /^chapitre-(\d{1,3})$/i.exec(tag.trim());
    if (m) return Number(m[1]);
  }

  // 2. Préfixe numérique dans les dossiers du sourcePath (hors années 4 chiffres)
  if (doc.sourcePath) {
    const dirs = rawPartsOf(doc.sourcePath).slice(0, -1);
    for (let i = dirs.length - 1; i >= 0; i--) {
      const seg = normPath(dirs[i]);
      const m = /^(\d{1,3})(?:[_\s.\-–—]|$)/.exec(seg);
      if (m && !/^000_template$/i.test(seg)) return Number(m[1]);
    }
  }

  // 3. Numéro explicite en tête de titre ou du nom de fichier
  const titleHead = /^(\d{1,3})(?:[\s._\-–—]|$)/.exec(normWords(doc.title).trim());
  if (titleHead) return Number(titleHead[1]);
  const stemHead = /^(\d{1,3})(?:[\s._\-–—]|$)/.exec(stemFromSourcePath(doc.sourcePath));
  if (stemHead) return Number(stemHead[1]);

  // 4. Mot-clé pédagogique suivi d'un numéro
  const titleKw = KEYWORD_NUM_RE.exec(normWords(doc.title));
  if (titleKw) return Number(titleKw[1]);
  const stemKw = KEYWORD_NUM_RE.exec(stemFromSourcePath(doc.sourcePath));
  if (stemKw) return Number(stemKw[1]);

  return null;
}

function extractExamYear(doc: CategorizableDoc): number | null {
  const candidates = [doc.sourcePath ?? "", doc.title];
  for (const text of candidates) {
    const matches = [...text.matchAll(/(?<!\d)(20[0-3]\d)(?!\d)/g)];
    if (matches.length > 0) {
      return Math.max(...matches.map((m) => Number(m[1])));
    }
  }
  return null;
}

export function compareDocumentsInCategory<T extends CategorizableDoc>(
  a: T,
  b: T,
  categoryId: DocCategoryId,
): number {
  if (categoryId === "photos") {
    const timeDiff = (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
    if (timeDiff !== 0) return timeDiff;
    return frCollator.compare(a.title, b.title);
  }

  if (categoryId === "exams") {
    const yearA = extractExamYear(a);
    const yearB = extractExamYear(b);
    if (yearA !== yearB) {
      if (yearA !== null && yearB !== null) return yearB - yearA;
      return yearA !== null ? -1 : 1;
    }
    return frCollator.compare(a.title, b.title);
  }

  const keyA = extractOrderKey(a);
  const keyB = extractOrderKey(b);
  if (keyA !== null && keyB !== null && keyA !== keyB) return keyA - keyB;
  if (keyA !== null && keyB === null) return -1;
  if (keyA === null && keyB !== null) return 1;
  return frCollator.compare(a.title, b.title);
}

// --- Groupement adaptatif ---------------------------------------------------

const TAIL_SUBGROUPS = ["Autres fichiers", "Général", "Déposés par la promo"];
const HEAD_SUBGROUPS = [
  "Cours par chapitre",
  "TD & TP par chapitre",
  "Corrigés TD & TP",
  "Mémos de cours",
  "Lab général (FR / EN)",
];

function compareSubGroups(a: string, b: string, categoryId: DocCategoryId): number {
  const tailA = TAIL_SUBGROUPS.indexOf(a);
  const tailB = TAIL_SUBGROUPS.indexOf(b);
  if (tailA !== -1 || tailB !== -1) {
    if (tailA !== -1 && tailB !== -1) return tailA - tailB;
    return tailA !== -1 ? 1 : -1;
  }

  if (categoryId === "exams") {
    const yearA = /^Examens\s+(\d{4})$/.exec(a)?.[1];
    const yearB = /^Examens\s+(\d{4})$/.exec(b)?.[1];
    if (yearA && yearB) return Number(yearB) - Number(yearA);
    if (yearA) return -1;
    if (yearB) return 1;

    if (a === "Partiels ECE" && b !== "Partiels ECE") return -1;
    if (b === "Partiels ECE" && a !== "Partiels ECE") return 1;

    if (a === "Annales externes" && b !== "Annales externes") return 1;
    if (b === "Annales externes" && a !== "Annales externes") return -1;

    return frCollator.compare(a, b);
  }

  const headA = HEAD_SUBGROUPS.indexOf(a);
  const headB = HEAD_SUBGROUPS.indexOf(b);
  if (headA !== -1 || headB !== -1) {
    if (headA !== -1 && headB !== -1) return headA - headB;
    return headA !== -1 ? -1 : 1;
  }

  return frCollator.compare(a, b);
}

export function groupDocumentsByCategory<T extends CategorizableDoc>(docs: T[]): DocumentCategoryGroup<T>[] {
  const byCategory = new Map<DocCategoryId, T[]>();
  for (const doc of docs) {
    const cat = categorizeDocument(doc);
    const list = byCategory.get(cat);
    if (list) list.push(doc);
    else byCategory.set(cat, [doc]);
  }

  const groups: DocumentCategoryGroup<T>[] = [];
  for (const meta of DOC_CATEGORIES) {
    const catDocs = byCategory.get(meta.id);
    if (!catDocs || catDocs.length === 0) continue;

    catDocs.sort((a, b) => compareDocumentsInCategory(a, b, meta.id));

    let subGroups: DocumentSubGroup<T>[] | undefined;
    if (meta.id !== "photos" && catDocs.length >= 8) {
      const buckets = new Map<string, T[]>();
      for (const doc of catDocs) {
        const label = extractSubGroup(doc, meta.id) ?? (doc.source === "upload" ? "Déposés par la promo" : "Général");
        const bucket = buckets.get(label);
        if (bucket) bucket.push(doc);
        else buckets.set(label, [doc]);
      }

      const maxBucketSize = Math.max(...[...buckets.values()].map((b) => b.length));
      if (buckets.size >= 2 && maxBucketSize >= 2 && buckets.size <= Math.ceil(catDocs.length / 2)) {
        subGroups = [...buckets.entries()]
          .sort(([a], [b]) => compareSubGroups(a, b, meta.id))
          .map(([label, subDocs]) => ({ label, docs: subDocs }));
      }
    }

    groups.push({ category: meta, docs: catDocs, subGroups });
  }

  return groups;
}

// --- Utilitaires d'affichage et de filtrage --------------------------------

const MIME_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "text/markdown": "Markdown",
  "text/plain": "Texte",
  "text/x-c": "Code C",
  "text/x-python": "Python",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
};

const EXT_LABELS: Record<string, string> = {
  pdf: "PDF",
  c: "Code C",
  h: "Code C",
  py: "Python",
  md: "Markdown",
  txt: "Texte",
  docx: "Word",
  pptx: "PowerPoint",
  jpg: "Image",
  jpeg: "Image",
  png: "Image",
  webp: "Image",
};

export function formatFileKind(filePath: string, mime: string): string {
  const ext = /\.([^./\\]+)$/.exec(filePath)?.[1]?.toLowerCase() ?? "";
  if (ext && ext in EXT_LABELS) return EXT_LABELS[ext];
  if (mime in MIME_LABELS) return MIME_LABELS[mime];
  if (mime.startsWith("image/")) return "Image";
  return ext ? ext.toUpperCase() : "Document";
}

export function documentContextBadge(doc: CategorizableDoc, opts?: { hideSubGroup?: string }): string | null {
  for (const tag of doc.tags) {
    const ch = /^chapitre-(\d+)$/i.exec(tag.trim());
    if (ch) return `Chapitre ${Number(ch[1])}`;
  }

  if (doc.tags.includes("externe")) return "Externe";
  if (doc.correctionOfId) return "Solution";

  const catId = categorizeDocument(doc);
  const sub = extractSubGroup(doc, catId);
  if (sub && sub !== opts?.hideSubGroup) {
    return sub;
  }

  return null;
}

export function matchesDocumentQuery(doc: CategorizableDoc, query: string, categoryId?: DocCategoryId): boolean {
  const needle = normWords(query.trim());
  if (!needle) return true;

  const cat = categoryId ?? categorizeDocument(doc);
  const catMeta = DOC_CATEGORY_MAP[cat];
  const sub = extractSubGroup(doc, cat) ?? "";

  const haystack = normWords(
    [doc.title, catMeta.label, catMeta.shortLabel, ...doc.tags, sub, doc.sourcePath ?? ""].join(" "),
  );
  return haystack.includes(needle);
}
