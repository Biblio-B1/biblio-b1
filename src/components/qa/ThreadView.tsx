import { formatDate, fileUrl } from "@/lib/labels";
import { MarkdownView } from "@/components/viewers/MarkdownView";
import type { ThreadItem } from "@/server/threads";
import {
  addPostAction,
  deletePostAction,
  deleteThreadAction,
  markSynthesisAction,
  pinPostAction,
  unpinPostAction,
} from "@/app/qa/actions";
import { ConfirmDelete } from "./ConfirmDelete";
import { PostEditor } from "./PostEditor";

type Viewer = { id: string; role: "admin" | "member" };

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
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="revalidate" value={revalidate} />
      <button className="btn btn-ghost h-8 px-2 text-[13px]">{children}</button>
    </form>
  );
}

export function ThreadView({ item, viewer, revalidate }: { item: ThreadItem; viewer: Viewer; revalidate: string }) {
  const { thread, posts } = item;
  const isAdmin = viewer.role === "admin";
  const canModerate = isAdmin || thread.authorId === viewer.id; // épingler, synthèse, supprimer le fil
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4" aria-label={thread.question}>
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
              action={deleteThreadAction}
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
                      action={deletePostAction}
                      title="Supprimer cette réponse ?"
                      detail="La réponse et son image seront effacées. Cette action est irréversible."
                    />
                  )}
                </span>
              </div>
              <div className="min-w-0 overflow-x-auto">
                <MarkdownView source={p.body} />
              </div>
              {p.imagePath && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileUrl(p.imagePath)} alt={`Image jointe par ${p.authorName}`} className="mt-3 max-h-96 max-w-full rounded-md border border-line" />
              )}
            </li>
          );
        })}
      </ul>

      <details className="rounded-md border border-line">
        <summary className="cursor-pointer px-3 py-2 text-[14px] font-medium">Répondre</summary>
        <div className="p-3 pt-1">
          <PostEditor action={addPostAction} hidden={{ threadId: thread.id, revalidate }} submitLabel="Publier la réponse" />
        </div>
      </details>
    </section>
  );
}
