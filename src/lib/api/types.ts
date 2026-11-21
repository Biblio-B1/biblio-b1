// Types du site (camelCase, dates en Date), identiques à ceux de l'ancien serveur pour que les
// composants existants ne changent pas, et conversion depuis les lignes Supabase (snake_case).
import type { SubjectRules } from "@/lib/subject-rules";

export const DOC_TYPES = ["course", "photo", "exercise", "exam", "note"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export type Subject = {
  id: string;
  name: string;
  slug: string;
  color: string;
  rules: SubjectRules | null;
  createdAt: Date;
};

export type Document = {
  id: string;
  title: string;
  type: DocType;
  subjectId: string | null;
  subjectConfirmed: boolean;
  filePath: string;
  mime: string;
  sha256: string;
  /** Vide dans les listes (colonne non chargée) ; rempli par getDocument. */
  text: string;
  source: "upload" | "local" | "github";
  sourcePath: string | null;
  tags: string[];
  authorId: string | null;
  correctionOfId: string | null;
  createdAt: Date;
};

type Row = Record<string, unknown>;

export function toSubject(r: Row): Subject {
  return {
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    color: String(r.color ?? "#6b7280"),
    rules: (r.rules as SubjectRules | null) ?? null,
    createdAt: new Date(String(r.created_at)),
  };
}

export function toDocument(r: Row): Document {
  return {
    id: String(r.id),
    title: String(r.title),
    type: r.type as DocType,
    subjectId: (r.subject_id as string | null) ?? null,
    subjectConfirmed: Boolean(r.subject_confirmed),
    filePath: String(r.file_path),
    mime: String(r.mime),
    sha256: String(r.sha256 ?? ""),
    text: typeof r.text === "string" ? r.text : "",
    source: r.source as Document["source"],
    sourcePath: (r.source_path as string | null) ?? null,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    authorId: (r.author_id as string | null) ?? null,
    correctionOfId: (r.correction_of_id as string | null) ?? null,
    createdAt: new Date(String(r.created_at)),
  };
}

/** Colonnes des listes de documents : tout sauf le texte extrait (volumineux). */
export const DOCUMENT_LIST_COLUMNS =
  "id, title, type, subject_id, subject_confirmed, file_path, mime, sha256, source, source_path, tags, author_id, correction_of_id, created_at";
