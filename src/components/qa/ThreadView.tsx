"use client";

import type { Role } from "@/lib/roles";
import { usePageRefresh } from "@/components/PageRefresh";
import { useSignedUrl } from "@/lib/api/files";
import { formatDate } from "@/lib/labels";
import { MarkdownView } from "@/components/viewers/MarkdownView";
import type { ThreadItem } from "@/lib/api/threads";
import {
  addPostAction,
  deletePostAction,
  deleteThreadAction,
  markSynthesisAction,
  pinPostAction,
  unpinPostAction,
} from "@/lib/api/threads";
import { ConfirmDelete } from "./ConfirmDelete";
import { PostEditor } from "./PostEditor";

type Viewer = { id: string; role: Role };

function Tag({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "accent" }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[12px] ${tone === "accent" ? "border-ink bg-ink text-bg" : "border-line-strong text-ink-2"}`}
    >
      {children}
    </span>
  );
}

function SmallForm({ action, id, revalidate, children }: { action: (fd: FormData) => Promise<void>; id: string; revalidate: string; children: React.ReactNode }) {
  const { refresh } = usePageRefresh();
  return (
    <form
      data-write
      action={async (fd) => {
        await action(fd);
        refresh();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="revalidate" value={revalidate} />
      <button className="btn btn-ghost h-8 px-2 text-[13px]">{children}</button>
    </form>
  );
}

function PostImage({ path, author }: { path: string; author: string }) {
  const src = useSignedUrl(path);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={`Image jointe par ${author}`} className="mt-3 max-h-96 max-w-full rounded-md border border-line" />;
}

export function ThreadView({ item, viewer, revalidate }: { item: ThreadItem; viewer: Viewer; revalidate: string }) {
  const { refresh } = usePageRefresh();
  const then = (fn: (fd: FormData) => Promise<void>) => async (fd: FormData) => {
    await fn(fd);
    refresh();
  };
  const { thread, posts } = item;
  const isAdmin = viewer.role === "admin";
  const canModerate = isAdmin || thread.authorId === viewer.id; // épingler, synthèse, supprimer le fil
  return (
    <section id={`thread-${thread.id}`} className="flex scroll-mt-20 flex-col gap-3 rounded-lg border border-line bg-surface p-4" aria-label={thread.question}>
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-[16px] font-semibold">{thread.question}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
            <Tag>{thread.kind === "note" ? "Note" : "Question"}</Tag>
            {thread.isSynthesis && <Tag tone="accent">Synthèse</Tag>}
            <span>
              {item.authorName}, {formatDate(thread.createdAt)}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1 sm:shrink-0">
          {canModerate && (
            <SmallForm action={markSynthesisAction} id={thread.id} revalidate={revalidate}>
              {thread.isSynthesis ? "Retirer la synthèse" : "Marquer synthèse"}
            </SmallForm>
          )}
          {canModerate && (
            <ConfirmDelete
              id={thread.id}
              revalidate={revalidate}
              action={then(deleteThreadAction)}
              title={thread.kind === "note" ? "Supprimer cette note ?" : "Supprimer cette question ?"}
              detail="Le fil, ses réponses et leurs images seront effacés. Cette action est irréversible."
              label={thread.kind === "note" ? "Supprimer la note" : "Supprimer la question"}
            />
          )}
        </div>
      </header>

      <ul className="flex flex-col gap-3">
        {posts.map((p, i) => {
          const canDeletePost = i > 0 && (isAdmin || p.authorId === viewer.id);
          return (
            <li key={p.id} className={`rounded-md border p-3 ${p.pinned ? "border-ink/50 bg-sunken" : "border-line"}`}>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                <strong className="font-medium text-ink">{p.authorName}</strong>
                <span>{formatDate(p.createdAt)}</span>
                {p.pinned && <Tag tone="accent">Épinglé</Tag>}
                <span className="ml-auto flex flex-wrap items-center gap-1">
                  {i > 0 && canModerate && (
                    <SmallForm action={p.pinned ? unpinPostAction : pinPostAction} id={p.id} revalidate={revalidate}>
                      {p.pinned ? "Désépingler" : "Épingler"}
                    </SmallForm>
                  )}
                  {canDeletePost && (
                    <ConfirmDelete
                      id={p.id}
                      revalidate={revalidate}
                      action={then(deletePostAction)}
                      title="Supprimer cette réponse ?"
                      detail="La réponse et son image seront effacées. Cette action est irréversible."
                    />
                  )}
                </span>
              </div>
              <div className="min-w-0 overflow-x-auto">
                <MarkdownView source={p.body} />
              </div>
              {p.imagePath && <PostImage path={p.imagePath} author={p.authorName} />}
            </li>
          );
        })}
      </ul>

      <details data-write className="rounded-md border border-line">
        <summary className="cursor-pointer px-3 py-2 text-[14px] font-medium">Répondre</summary>
        <div className="p-3 pt-1">
          <PostEditor
            action={async (prev, fd) => {
              const r = await addPostAction(prev, fd);
              if (r?.ok) refresh();
              return r;
            }}
            hidden={{ threadId: thread.id, revalidate }}
            submitLabel="Publier la réponse"
          />
        </div>
      </details>
    </section>
  );
}
