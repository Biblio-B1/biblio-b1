import fs from "node:fs";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client";
import { THREAD_KINDS, THREAD_TARGETS, documents, exercises, posts, threads, users } from "./db/schema";
import { indexThread, removeFromIndex } from "./search";
import { resolveStoragePath } from "./storage";

export type Thread = typeof threads.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type ThreadActor = { id: string; role: "admin" | "member" };
export type ThreadItem = {
  thread: Thread;
  authorName: string;
  posts: (Post & { authorName: string })[];
};

const body = z.string().trim().min(1, "Le message est vide.").max(20_000, "Message trop long.");
// Image stockée par saveUpload : uploads/<...>/<nom>.<ext image>, sans remontée de dossier.
const imagePath = z
  .string()
  .max(300)
  .regex(/^uploads\/[\w./-]+\.(jpe?g|png|webp)$/i)
  .refine((p) => !p.split("/").some((s) => s === ".." || s === "." || s === ""), "Chemin invalide");

const createSchema = z.object({
  targetType: z.enum(THREAD_TARGETS),
  targetId: z.string().min(1),
  authorId: z.string().min(1),
  title: z.string().trim().min(1, "Le titre est vide.").max(300, "Titre trop long."),
  body,
  kind: z.enum(THREAD_KINDS),
  imagePath: imagePath.nullish(),
});
const postSchema = z.object({
  threadId: z.string().min(1),
  authorId: z.string().min(1),
  body,
  imagePath: imagePath.nullish(),
});

const isAdmin = (a: ThreadActor) => a.role === "admin";

function threadPosts(db: Db, threadId: string): Post[] {
  return db.select().from(posts).where(eq(posts.threadId, threadId)).orderBy(asc(posts.createdAt), sql`posts.rowid`).all();
}

function reindex(db: Db, threadId: string): void {
  const thread = db.select().from(threads).where(eq(threads.id, threadId)).get();
  if (thread) indexThread(db, thread, threadPosts(db, threadId));
}

/** Crée un fil (note ou question) et son message d'ouverture. Erreur : `not_found` (cible inconnue). */
export function createThread(db: Db, input: z.input<typeof createSchema>): Thread {
  const d = createSchema.parse(input);
  const target =
    d.targetType === "document"
      ? db.select({ id: documents.id }).from(documents).where(eq(documents.id, d.targetId)).get()
      : db.select({ id: exercises.id }).from(exercises).where(eq(exercises.id, d.targetId)).get();
  if (!target) throw new Error("not_found");
  const thread = db.$client.transaction(() => {
    const t = db
      .insert(threads)
      .values({ targetType: d.targetType, targetId: d.targetId, authorId: d.authorId, question: d.title, kind: d.kind })
      .returning()
      .get();
    db.insert(posts).values({ threadId: t.id, authorId: d.authorId, body: d.body, imagePath: d.imagePath ?? null }).run();
    return t;
  })();
  reindex(db, thread.id);
  return thread;
}

/** Ajoute une réponse. Erreur : `not_found` (fil inconnu). */
export function addPost(db: Db, input: z.input<typeof postSchema>): Post {
  const d = postSchema.parse(input);
  if (!db.select({ id: threads.id }).from(threads).where(eq(threads.id, d.threadId)).get()) throw new Error("not_found");
  const post = db.insert(posts).values({ threadId: d.threadId, authorId: d.authorId, body: d.body, imagePath: d.imagePath ?? null }).returning().get();
  reindex(db, d.threadId);
  return post;
}

function actorOf(db: Db, userId: string): ThreadActor {
  const u = db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, userId)).get();
  if (!u) throw new Error("forbidden");
  return u;
}

/** Épingle un post (auteur du fil ou admin) ; un seul épinglé par fil. Erreurs : `not_found`, `forbidden`. */
export function pinPost(db: Db, postId: string, actorId: string): void {
  const post = db.select().from(posts).where(eq(posts.id, postId)).get();
  if (!post) throw new Error("not_found");
  const thread = db.select().from(threads).where(eq(threads.id, post.threadId)).get();
  if (!thread) throw new Error("not_found");
  const actor = actorOf(db, actorId);
  if (!isAdmin(actor) && thread.authorId !== actor.id) throw new Error("forbidden");
  db.$client.transaction(() => {
    db.update(posts).set({ pinned: false }).where(and(eq(posts.threadId, post.threadId), ne(posts.id, postId))).run();
    db.update(posts).set({ pinned: true }).where(eq(posts.id, postId)).run();
  })();
  reindex(db, post.threadId);
}

/** Retire l'épingle d'un post (mêmes droits que pinPost). */
export function unpinPost(db: Db, postId: string, actorId: string): void {
  const post = db.select().from(posts).where(eq(posts.id, postId)).get();
  if (!post) throw new Error("not_found");
  const thread = db.select().from(threads).where(eq(threads.id, post.threadId)).get();
  if (!thread) throw new Error("not_found");
  const actor = actorOf(db, actorId);
  if (!isAdmin(actor) && thread.authorId !== actor.id) throw new Error("forbidden");
  db.update(posts).set({ pinned: false }).where(eq(posts.id, postId)).run();
  reindex(db, post.threadId);
}

/** Bascule le marquage « synthèse » d'un fil (admin ou auteur du fil) ; renvoie le nouvel état. */
export function markSynthesis(db: Db, threadId: string, actorId: string): boolean {
  const thread = db.select().from(threads).where(eq(threads.id, threadId)).get();
  if (!thread) throw new Error("not_found");
  const actor = actorOf(db, actorId);
  if (!isAdmin(actor) && thread.authorId !== actor.id) throw new Error("forbidden");
  const next = !thread.isSynthesis;
  db.update(threads).set({ isSynthesis: next }).where(eq(threads.id, threadId)).run();
  reindex(db, threadId);
  return next;
}

/** Fils d'une cible : synthèses d'abord, puis fils avec un post épinglé, puis les plus récents. */
export function listThreads(db: Db, targetType: (typeof THREAD_TARGETS)[number], targetId: string): ThreadItem[] {
  const rows = db
    .select()
    .from(threads)
    .where(and(eq(threads.targetType, targetType), eq(threads.targetId, targetId)))
    .orderBy(asc(threads.createdAt), sql`threads.rowid`)
    .all();
  if (!rows.length) return [];
  const allPosts = db
    .select()
    .from(posts)
    .where(inArray(posts.threadId, rows.map((t) => t.id)))
    .orderBy(asc(posts.createdAt), sql`posts.rowid`)
    .all();
  const userIds = [...new Set([...rows.map((t) => t.authorId), ...allPosts.map((p) => p.authorId)])];
  const names = new Map(db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)).all().map((u) => [u.id, u.name]));
  const items = rows.map((thread): ThreadItem => {
    const own = allPosts.filter((p) => p.threadId === thread.id);
    const [opening, ...rest] = own;
    const ordered = [...(opening ? [opening] : []), ...rest.filter((p) => p.pinned), ...rest.filter((p) => !p.pinned)];
    return {
      thread,
      authorName: names.get(thread.authorId) ?? "?",
      posts: ordered.map((p) => ({ ...p, authorName: names.get(p.authorId) ?? "?" })),
    };
  });
  const rank = (i: ThreadItem) => (i.thread.isSynthesis ? 0 : i.posts.some((p) => p.pinned) ? 1 : 2);
  // tri stable : à rang égal, plus récent d'abord
  return items.reverse().sort((a, b) => rank(a) - rank(b));
}

/**
 * Efface du disque les images devenues orphelines (aucun post ni document ne les référence encore).
 * À appeler après le commit de la suppression des lignes.
 */
export function removeUnreferencedImages(db: Db, paths: (string | null)[], root?: string): void {
  for (const p of new Set(paths.filter((x): x is string => !!x))) {
    const used =
      db.select({ id: posts.id }).from(posts).where(eq(posts.imagePath, p)).limit(1).get() ||
      db.select({ id: documents.id }).from(documents).where(eq(documents.filePath, p)).limit(1).get();
    if (used) continue;
    try {
      fs.rmSync(resolveStoragePath(p, root), { force: true });
    } catch {
      // fichier absent ou chemin invalide : la base est déjà propre
    }
  }
}

/** Supprime une réponse (son auteur ou un admin). Le message d'ouverture se supprime avec le fil. */
export function deletePost(db: Db, id: string, actor: ThreadActor, root?: string): void {
  const post = db.select().from(posts).where(eq(posts.id, id)).get();
  if (!post) throw new Error("not_found");
  if (!isAdmin(actor) && post.authorId !== actor.id) throw new Error("forbidden");
  const opening = threadPosts(db, post.threadId)[0];
  if (opening?.id === id) throw new Error("opening_post");
  db.delete(posts).where(eq(posts.id, id)).run();
  removeUnreferencedImages(db, [post.imagePath], root);
  reindex(db, post.threadId);
}

/** Supprime un fil et ses messages (auteur du fil ou admin), images comprises. */
export function deleteThread(db: Db, id: string, actor: ThreadActor, root?: string): void {
  const thread = db.select().from(threads).where(eq(threads.id, id)).get();
  if (!thread) throw new Error("not_found");
  if (!isAdmin(actor) && thread.authorId !== actor.id) throw new Error("forbidden");
  const images = threadPosts(db, id).map((p) => p.imagePath);
  db.delete(threads).where(eq(threads.id, id)).run(); // posts : cascade
  removeUnreferencedImages(db, images, root);
  removeFromIndex(db, "thread", id);
}
