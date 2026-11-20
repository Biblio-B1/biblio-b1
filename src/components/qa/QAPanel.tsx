import { createThreadAction } from "@/app/qa/actions";
import { getDb } from "@/server/db/client";
import { listThreads } from "@/server/threads";
import { PostEditor } from "./PostEditor";
import { ThreadView } from "./ThreadView";

/** Notes et questions d'un document ou d'un exercice. Composant serveur : la page appelante valide la session. */
export function QAPanel({
  targetType,
  targetId,
  viewer,
}: {
  targetType: "document" | "exercise";
  targetId: string;
  viewer: { id: string; role: "admin" | "member" };
}) {
  const items = listThreads(getDb(), targetType, targetId);
  const revalidate = targetType === "exercise" ? `/training/${targetId}` : `/doc/${targetId}`;
  return (
    <section aria-labelledby="qa-title" className="flex flex-col gap-4 border-t border-line pt-6">
      <h2 id="qa-title" className="text-[1.15rem] font-semibold">
        Notes et questions
      </h2>
      {items.length === 0 ? (
        <p className="text-[14px] text-ink-3">Aucune note ni question pour l&apos;instant.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((item) => (
            <ThreadView key={item.thread.id} item={item} viewer={viewer} revalidate={revalidate} />
          ))}
        </div>
      )}
      <details className="rounded-lg border border-line-strong bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-[15px] font-medium">Poser une question ou ajouter une note</summary>
        <div className="p-4 pt-1">
          <PostEditor action={createThreadAction} hidden={{ targetType, targetId }} withTitle submitLabel="Publier" />
        </div>
      </details>
    </section>
  );
}
