"use server";

import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { THREAD_KINDS, THREAD_TARGETS } from "@/server/db/schema";
import { resolveStoragePath, saveUpload } from "@/server/storage";
import { addPost, createThread, deletePost, deleteThread, markSynthesis, pinPost, unpinPost } from "@/server/threads";

export type QAState = { error?: string; ok?: boolean } | null;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const ERRORS: Record<string, string> = {
  forbidden: "Action non autorisée.",
  not_found: "Élément introuvable (déjà supprimé ?).",
  opening_post: "Supprimez le fil entier pour retirer son premier message.",
};

function message(e: unknown): string {
  if (e instanceof z.ZodError) return e.issues[0]?.message ?? "Données invalides.";
  if (e instanceof Error && ERRORS[e.message]) return ERRORS[e.message];
  return "Opération impossible. Réessayez.";
}

function pathFor(type: string, id: string): string {
  return type === "exercise" ? `/training/${id}` : `/doc/${id}`;
}

/** Enregistre l'image jointe (jpg/jpeg/png/webp, 10 Mo max) ; renvoie son chemin relatif ou null. */
async function readImage(fd: FormData): Promise<{ filePath: string | null } | { error: string }> {
  const file = fd.get("image");
  if (!(file instanceof File) || file.size === 0) return { filePath: null };
  if (!IMAGE_EXT.has(path.extname(file.name).toLowerCase())) return { error: "Image : jpg, png ou webp uniquement." };
  if (file.size > MAX_IMAGE_BYTES) return { error: "Image trop volumineuse (10 Mo maximum)." };
  try {
    return { filePath: saveUpload(Buffer.from(await file.arrayBuffer()), file.name).filePath };
  } catch {
    return { error: "Image refusée." };
  }
}

function dropFile(filePath: string | null): void {
  if (!filePath) return;
  try {
    fs.rmSync(resolveStoragePath(filePath), { force: true });
  } catch {
    // déjà absent
  }
}

const newThreadSchema = z.object({
  targetType: z.enum(THREAD_TARGETS),
  targetId: z.uuid(),
  kind: z.enum(THREAD_KINDS),
  title: z.string(),
  body: z.string(),
});

export async function createThreadAction(_prev: QAState, fd: FormData): Promise<QAState> {
  const user = await requireUser();
  const parsed = newThreadSchema.safeParse({
    targetType: fd.get("targetType"),
    targetId: fd.get("targetId"),
    kind: fd.get("kind"),
    title: fd.get("title") ?? "",
    body: fd.get("body") ?? "",
  });
  if (!parsed.success) return { error: "Données invalides." };
  const img = await readImage(fd);
  if ("error" in img) return { error: img.error };
  try {
    createThread(getDb(), { ...parsed.data, authorId: user.id, imagePath: img.filePath });
  } catch (e) {
    dropFile(img.filePath);
    return { error: message(e) };
  }
  revalidatePath(pathFor(parsed.data.targetType, parsed.data.targetId));
  return { ok: true };
}

const replySchema = z.object({ threadId: z.uuid(), body: z.string(), revalidate: z.string().startsWith("/").max(200) });

export async function addPostAction(_prev: QAState, fd: FormData): Promise<QAState> {
  const user = await requireUser();
  const parsed = replySchema.safeParse({ threadId: fd.get("threadId"), body: fd.get("body") ?? "", revalidate: fd.get("revalidate") });
  if (!parsed.success) return { error: "Données invalides." };
  const img = await readImage(fd);
  if ("error" in img) return { error: img.error };
  try {
    addPost(getDb(), { threadId: parsed.data.threadId, authorId: user.id, body: parsed.data.body, imagePath: img.filePath });
  } catch (e) {
    dropFile(img.filePath);
    return { error: message(e) };
  }
  revalidatePath(parsed.data.revalidate);
  return { ok: true };
}

const idSchema = z.object({ id: z.uuid(), revalidate: z.string().startsWith("/").max(200) });

async function run(fd: FormData, fn: (id: string, actor: Awaited<ReturnType<typeof requireUser>>) => void): Promise<void> {
  const user = await requireUser();
  const parsed = idSchema.safeParse({ id: fd.get("id"), revalidate: fd.get("revalidate") });
  if (!parsed.success) return;
  try {
    fn(parsed.data.id, user);
  } catch {
    // droits insuffisants ou élément déjà supprimé : l'affichage est simplement rafraîchi
  }
  revalidatePath(parsed.data.revalidate);
}

export async function pinPostAction(fd: FormData): Promise<void> {
  await run(fd, (id, u) => pinPost(getDb(), id, u.id));
}
export async function unpinPostAction(fd: FormData): Promise<void> {
  await run(fd, (id, u) => unpinPost(getDb(), id, u.id));
}
export async function markSynthesisAction(fd: FormData): Promise<void> {
  await run(fd, (id, u) => void markSynthesis(getDb(), id, u.id));
}
export async function deletePostAction(fd: FormData): Promise<void> {
  await run(fd, (id, u) => deletePost(getDb(), id, u));
}
export async function deleteThreadAction(fd: FormData): Promise<void> {
  await run(fd, (id, u) => deleteThread(getDb(), id, u));
}
