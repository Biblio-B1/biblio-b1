// Fiche Markdown écrite en ligne : fichier .md dans le bucket privé + document de type « note ».
import { getSupabase, FILES_BUCKET } from "@/lib/supabase/client";
import { sha256Hex, uploadStoragePath } from "@/lib/upload-core";

export type NoteState = { error?: string; id?: string } | null;

export async function createNoteAction(_prev: NoteState, fd: FormData): Promise<NoteState> {
  const title = String(fd.get("title") ?? "").trim();
  const subjectId = String(fd.get("subjectId") ?? "") || null;
  const text = String(fd.get("body") ?? "").trim();
  if (!title) return { error: "Donnez un titre à la fiche." };
  if (title.length > 300) return { error: "Titre trop long." };
  if (!text) return { error: "La fiche est vide." };
  if (text.length > 500_000) return { error: "Fiche trop longue." };
  const supabase = getSupabase();
  const uid = (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return { error: "Session expirée : reconnectez-vous." };

  const body = `${text}\n`;
  const sha256 = await sha256Hex(new TextEncoder().encode(body).buffer as ArrayBuffer);
  const { data: same } = await supabase.from("documents").select("id").eq("sha256", sha256).maybeSingle();
  if (same) return { error: "Une fiche identique existe déjà." };

  const path = uploadStoragePath(uid, sha256, "fiche.md");
  const up = await supabase.storage.from(FILES_BUCKET).upload(path, new Blob([body], { type: "text/markdown" }), { upsert: true });
  if (up.error) return { error: "Enregistrement impossible. Réessayez." };
  const { data: doc, error } = await supabase
    .from("documents")
    .insert({ title, type: "note", subject_id: subjectId, subject_confirmed: true, file_path: path, mime: "text/markdown", sha256, text: body, source: "upload", author_id: uid })
    .select("id")
    .single();
  if (error || !doc) {
    await supabase.storage.from(FILES_BUCKET).remove([path]);
    return { error: "Enregistrement impossible. Réessayez." };
  }
  return { id: doc.id as string };
}
