// Notes et questions via Supabase. Les « …Action » gardent la signature des anciennes server actions
// pour que PostEditor, ThreadView et ConfirmDelete ne changent que leur import. La RLS limite
// l'écriture à l'auteur (ou à l'auteur du fil / un admin pour épingler, marquer, supprimer).
import { getSupabase, FILES_BUCKET } from "@/lib/supabase/client";
import { imageUploadPath, orderThreads, validateImage } from "./threads-core";

export type QAState = { error?: string; ok?: boolean } | null;

export type Thread = {
  id: string;
  targetType: "document" | "exercise";
  targetId: string;
  question: string;
  kind: "question" | "note";
  isSynthesis: boolean;
  authorId: string;
  createdAt: Date;
};
export type Post = {
  id: string;
  threadId: string;
  authorId: string;
  body: string;
  imagePath: string | null;
  pinned: boolean;
  isSummary: boolean;
  createdAt: Date;
};
export type ThreadItem = { thread: Thread; authorName: string; posts: (Post & { authorName: string })[] };

type Row = Record<string, unknown>;

export async function listThreads(targetType: "document" | "exercise", targetId: string): Promise<ThreadItem[]> {
  const supabase = getSupabase();
  const { data: threads, error } = await supabase.from("threads").select("*").eq("target_type", targetType).eq("target_id", targetId);
  if (error) throw new Error(`Questions : ${error.message}`);
  if (!threads?.length) return [];
  const { data: posts } = await supabase.from("posts").select("*").in("thread_id", threads.map((t) => t.id));
  const ids = [...new Set([...threads.map((t) => t.author_id), ...(posts ?? []).map((p) => p.author_id)])];
  const { data: profiles } = await supabase.from("profiles").select("id, name").in("id", ids);
  const names = new Map((profiles ?? []).map((p) => [p.id as string, p.name as string]));
  const items = orderThreads(
    threads.map((t: Row) => ({ id: String(t.id), createdAt: String(t.created_at), isSynthesis: Boolean(t.is_synthesis), authorId: String(t.author_id), row: t })),
    (posts ?? []).map((p: Row) => ({
      id: String(p.id),
      threadId: String(p.thread_id),
      createdAt: String(p.created_at),
      pinned: Boolean(p.pinned),
      authorId: String(p.author_id),
      row: p,
    })),
    names,
  );
  return items.map((i) => ({
    authorName: i.authorName,
    thread: {
      id: i.thread.id,
      targetType: i.thread.row.target_type as Thread["targetType"],
      targetId: String(i.thread.row.target_id),
      question: String(i.thread.row.question),
      kind: i.thread.row.kind as Thread["kind"],
      isSynthesis: i.thread.isSynthesis,
      authorId: i.thread.authorId,
      createdAt: new Date(i.thread.createdAt),
    },
    posts: i.posts.map((p) => ({
      id: p.id,
      threadId: p.threadId,
      authorId: p.authorId,
      body: String(p.row.body),
      imagePath: (p.row.image_path as string | null) ?? null,
      pinned: p.pinned,
      isSummary: Boolean(p.row.is_summary),
      createdAt: new Date(p.createdAt),
      authorName: p.authorName,
    })),
  }));
}

async function myId(): Promise<string | null> {
  return (await getSupabase().auth.getUser()).data.user?.id ?? null;
}

/** Envoie l'image jointe (facultative) ; renvoie son chemin dans le bucket. */
async function uploadImage(fd: FormData, uid: string): Promise<{ path: string | null } | { error: string }> {
  const file = fd.get("image");
  if (!(file instanceof File) || file.size === 0) return { path: null };
  const invalid = validateImage(file);
  if (invalid) return { error: invalid };
  const path = imageUploadPath(uid, file.name, crypto.randomUUID());
  const { error } = await getSupabase().storage.from(FILES_BUCKET).upload(path, file, { contentType: file.type || undefined });
  return error ? { error: "Image refusée." } : { path };
}

async function dropImage(path: string | null): Promise<void> {
  if (path) await getSupabase().storage.from(FILES_BUCKET).remove([path]);
}

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function createThreadAction(_prev: QAState, fd: FormData): Promise<QAState> {
  const uid = await myId();
  if (!uid) return { error: "Session expirée : reconnectez-vous." };
  const targetType = text(fd, "targetType");
  const kind = text(fd, "kind");
  const title = text(fd, "title");
  const body = text(fd, "body");
  if (!["document", "exercise"].includes(targetType) || !["question", "note"].includes(kind)) return { error: "Données invalides." };
  if (!title) return { error: "Le titre est vide." };
  if (title.length > 300) return { error: "Titre trop long." };
  if (!body) return { error: "Le message est vide." };
  if (body.length > 20_000) return { error: "Message trop long." };
  const img = await uploadImage(fd, uid);
  if ("error" in img) return { error: img.error };
  const supabase = getSupabase();
  const { data: thread, error } = await supabase
    .from("threads")
    .insert({ target_type: targetType, target_id: text(fd, "targetId"), question: title, kind, author_id: uid })
    .select("id")
    .single();
  if (error || !thread) {
    await dropImage(img.path);
    return { error: "Opération impossible. Réessayez." };
  }
  const post = await supabase.from("posts").insert({ thread_id: thread.id, author_id: uid, body, image_path: img.path });
  if (post.error) {
    await supabase.from("threads").delete().eq("id", thread.id);
    await dropImage(img.path);
    return { error: "Opération impossible. Réessayez." };
  }
  return { ok: true };
}

export async function addPostAction(_prev: QAState, fd: FormData): Promise<QAState> {
  const uid = await myId();
  if (!uid) return { error: "Session expirée : reconnectez-vous." };
  const body = text(fd, "body");
  if (!body) return { error: "Le message est vide." };
  if (body.length > 20_000) return { error: "Message trop long." };
  const img = await uploadImage(fd, uid);
  if ("error" in img) return { error: img.error };
  const { error } = await getSupabase().from("posts").insert({ thread_id: text(fd, "threadId"), author_id: uid, body, image_path: img.path });
  if (error) {
    await dropImage(img.path);
    return { error: "Élément introuvable (déjà supprimé ?)." };
  }
  return { ok: true };
}

/** Épingle un message (un seul par fil). Droits : auteur du fil ou admin (RLS). */
export async function pinPostAction(fd: FormData): Promise<void> {
  const supabase = getSupabase();
  const id = text(fd, "id");
  const { data: post } = await supabase.from("posts").select("thread_id").eq("id", id).maybeSingle();
  if (!post) return;
  await supabase.from("posts").update({ pinned: false }).eq("thread_id", post.thread_id).neq("id", id);
  await supabase.from("posts").update({ pinned: true }).eq("id", id);
}

export async function unpinPostAction(fd: FormData): Promise<void> {
  await getSupabase().from("posts").update({ pinned: false }).eq("id", text(fd, "id"));
}

export async function markSynthesisAction(fd: FormData): Promise<void> {
  const supabase = getSupabase();
  const id = text(fd, "id");
  const { data } = await supabase.from("threads").select("is_synthesis").eq("id", id).maybeSingle();
  if (data) await supabase.from("threads").update({ is_synthesis: !data.is_synthesis }).eq("id", id);
}

/** Supprime une réponse (son auteur ou un admin) ; le message d'ouverture part avec le fil. */
export async function deletePostAction(fd: FormData): Promise<void> {
  const supabase = getSupabase();
  const id = text(fd, "id");
  const { data: post } = await supabase.from("posts").select("thread_id, image_path").eq("id", id).maybeSingle();
  if (!post) return;
  const { data: first } = await supabase.from("posts").select("id").eq("thread_id", post.thread_id).order("created_at").limit(1).maybeSingle();
  if (first?.id === id) return;
  const { error } = await supabase.from("posts").delete().eq("id", id);
  if (!error) await dropImage(post.image_path);
}

/** Supprime un fil, ses messages et leurs images (auteur du fil ou admin). */
export async function deleteThreadAction(fd: FormData): Promise<void> {
  const supabase = getSupabase();
  const id = text(fd, "id");
  const { data: posts } = await supabase.from("posts").select("image_path").eq("thread_id", id);
  const { error } = await supabase.from("threads").delete().eq("id", id);
  if (error) return;
  const images = (posts ?? []).map((p) => p.image_path as string | null).filter((p): p is string => !!p);
  if (images.length) await supabase.storage.from(FILES_BUCKET).remove(images);
}
