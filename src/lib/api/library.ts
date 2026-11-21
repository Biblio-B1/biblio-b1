// Bibliothèque : matières et documents lus/écrits directement dans Supabase (RLS : comptes actifs).
import { getSupabase, FILES_BUCKET } from "@/lib/supabase/client";
import { DOCUMENT_LIST_COLUMNS, toDocument, toSubject, type Document, type Subject } from "./types";

function check<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} : ${res.error.message}`);
  return res.data as T;
}

export async function listSubjects(): Promise<Subject[]> {
  const rows = check(await getSupabase().from("subjects").select("*").order("name"), "Matières");
  return rows.map(toSubject);
}

/** Nombre de documents par matière (clé null = sans matière). */
export async function countBySubject(): Promise<Map<string | null, number>> {
  const rows = check(await getSupabase().from("documents").select("subject_id"), "Comptage") as { subject_id: string | null }[];
  const counts = new Map<string | null, number>();
  for (const r of rows) counts.set(r.subject_id, (counts.get(r.subject_id) ?? 0) + 1);
  return counts;
}

export async function listDocuments(
  opts: { subjectId?: string | null; type?: string; limit?: number } = {},
): Promise<Document[]> {
  let q = getSupabase().from("documents").select(DOCUMENT_LIST_COLUMNS).order("created_at", { ascending: false });
  if (opts.subjectId === null) q = q.is("subject_id", null);
  else if (opts.subjectId) q = q.eq("subject_id", opts.subjectId);
  if (opts.type) q = q.eq("type", opts.type);
  if (opts.limit) q = q.limit(opts.limit);
  return (check(await q, "Documents") as Record<string, unknown>[]).map(toDocument);
}

export async function getDocument(id: string): Promise<Document | null> {
  const row = check(await getSupabase().from("documents").select("*").eq("id", id).maybeSingle(), "Document");
  return row ? toDocument(row as Record<string, unknown>) : null;
}

export async function getProfileName(id: string): Promise<string | null> {
  const { data } = await getSupabase().from("profiles").select("name").eq("id", id).maybeSingle();
  return (data?.name as string | undefined) ?? null;
}

/** Images de la même matière (galerie du visualiseur). */
export async function listSiblingImages(doc: Document): Promise<Pick<Document, "id" | "title" | "filePath">[]> {
  let q = getSupabase().from("documents").select("id, title, file_path").like("mime", "image/%").order("created_at", { ascending: false }).limit(50);
  q = doc.subjectId ? q.eq("subject_id", doc.subjectId) : q.eq("id", doc.id);
  const rows = check(await q, "Images") as { id: string; title: string; file_path: string }[];
  return rows.map((r) => ({ id: r.id, title: r.title, filePath: r.file_path }));
}

/** Classe un document (et ses exercices) dans une matière, et confirme ce classement. */
export async function setDocumentSubject(id: string, subjectId: string | null): Promise<void> {
  const supabase = getSupabase();
  check(await supabase.from("documents").update({ subject_id: subjectId, subject_confirmed: true }).eq("id", id), "Classement");
  // Les exercices suivent (administrateur ; ignoré sinon par la RLS).
  await supabase.from("exercises").update({ subject_id: subjectId }).eq("document_id", id);
}

/**
 * Supprime un document : ses exercices et leur progression suivent (cascade), ses fils de questions
 * sont retirés, son fichier aussi s'il n'est partagé par aucun autre document. Un document importé
 * (dépôt du prof, dossiers locaux) est exclu des prochains imports.
 */
export async function deleteDocument(doc: Document): Promise<void> {
  const supabase = getSupabase();
  const { data: exercises } = await supabase.from("exercises").select("id").eq("document_id", doc.id);
  const targetIds = [doc.id, ...((exercises ?? []) as { id: string }[]).map((e) => e.id)];
  await supabase.from("threads").delete().in("target_id", targetIds);
  if (doc.source !== "upload") {
    await supabase.from("import_exclusions").upsert({ sha256: doc.sha256, source_path: doc.sourcePath });
  }
  check(await supabase.from("documents").delete().eq("id", doc.id), "Suppression");
  const { count } = await supabase.from("documents").select("id", { count: "exact", head: true }).eq("file_path", doc.filePath);
  if (!count) await supabase.storage.from(FILES_BUCKET).remove([doc.filePath]);
}

/** Même règle que l'ancien serveur : l'admin supprime tout, l'auteur ses propres dépôts. */
export function canDeleteDocument(doc: Pick<Document, "source" | "authorId">, viewer: { id: string; role: string }): boolean {
  return viewer.role === "admin" || (doc.source === "upload" && doc.authorId === viewer.id);
}
