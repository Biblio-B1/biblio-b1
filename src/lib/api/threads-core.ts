// Règles des notes et questions (fils), sans accès aux données : tri d'affichage et images jointes.

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp"]);

type ThreadLike = { id: string; createdAt: string; isSynthesis: boolean; authorId: string };
type PostLike = { id: string; threadId: string; createdAt: string; pinned: boolean; authorId: string };

export type OrderedItem<T extends ThreadLike, P extends PostLike> = {
  thread: T;
  authorName: string;
  posts: (P & { authorName: string })[];
};

/**
 * Fils d'une cible : synthèses d'abord, puis fils avec un message épinglé, puis les plus récents.
 * Dans un fil : message d'ouverture, puis l'épinglé, puis les autres dans l'ordre.
 */
export function orderThreads<T extends ThreadLike, P extends PostLike>(
  threads: T[],
  posts: P[],
  names: Map<string, string>,
): OrderedItem<T, P>[] {
  const byDate = <X extends { createdAt: string }>(a: X, b: X) => a.createdAt.localeCompare(b.createdAt);
  const items = [...threads].sort(byDate).map((thread) => {
    const own = posts.filter((x) => x.threadId === thread.id).sort(byDate);
    const [opening, ...rest] = own;
    const ordered = [...(opening ? [opening] : []), ...rest.filter((x) => x.pinned), ...rest.filter((x) => !x.pinned)];
    return {
      thread,
      authorName: names.get(thread.authorId) ?? "?",
      posts: ordered.map((x) => ({ ...x, authorName: names.get(x.authorId) ?? "?" })),
    };
  });
  const rank = (i: OrderedItem<T, P>) => (i.thread.isSynthesis ? 0 : i.posts.some((x) => x.pinned) ? 1 : 2);
  // tri stable : à rang égal, plus récent d'abord
  return items.reverse().sort((a, b) => rank(a) - rank(b));
}

/** null si l'image est acceptable, sinon le message d'erreur. */
export function validateImage(file: { name: string; size: number }): string | null {
  const ext = /\.([^.]+)$/.exec(file.name)?.[1]?.toLowerCase() ?? "";
  if (!IMAGE_EXT.has(ext)) return "Image : jpg, png ou webp uniquement.";
  if (file.size > MAX_IMAGE_BYTES) return "Image trop volumineuse (10 Mo maximum).";
  return null;
}

/** Chemin de l'image dans le bucket : seul uploads/<id utilisateur>/ est autorisé en écriture. */
export function imageUploadPath(userId: string, fileName: string, randomId: string): string {
  const ext = /\.([^.]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? "bin";
  return `uploads/${userId}/posts/${randomId}.${ext}`;
}
