"use client";

import { LinesSkeleton } from "@/components/Skeleton";
import type { Role } from "@/lib/roles";
import { PageRefreshProvider } from "@/components/PageRefresh";
import { createThreadAction, listThreads } from "@/lib/api/threads";
import { useData } from "@/lib/api/use-data";
import { PostEditor } from "./PostEditor";
import { ThreadView } from "./ThreadView";

/** Notes et questions d'un document ou d'un exercice (lues dans Supabase, rechargées après chaque action). */
export function QAPanel({
  targetType,
  targetId,
  viewer,
}: {
  targetType: "document" | "exercise";
  targetId: string;
  viewer: { id: string; role: Role };
}) {
  const { data: items, error, reload } = useData(() => listThreads(targetType, targetId), [targetType, targetId]);
  return (
    <PageRefreshProvider value={reload}>
      <section aria-labelledby="qa-title" className="flex flex-col gap-4 border-t border-line pt-6">
        <h2 id="qa-title" className="text-[1.15rem] font-semibold">
          Notes et questions
        </h2>
        {error ? (
          <p role="alert" className="text-[14px] text-danger">{error}</p>
        ) : !items ? (
          <LinesSkeleton lines={3} />
        ) : items.length === 0 ? (
          <p className="text-[14px] text-ink-3">Aucune note ni question pour l&apos;instant.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {items.map((item) => (
              <ThreadView key={item.thread.id} item={item} viewer={viewer} revalidate="" />
            ))}
          </div>
        )}
        <details data-write className="rounded-lg border border-line-strong bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-[15px] font-medium">Poser une question ou ajouter une note</summary>
          <div className="p-4 pt-1">
            <PostEditor
              action={async (prev, fd) => {
                const r = await createThreadAction(prev, fd);
                if (r?.ok) reload();
                return r;
              }}
              hidden={{ targetType, targetId }}
              submitLabel="Publier"
              withTitle
            />
          </div>
        </details>
      </section>
    </PageRefreshProvider>
  );
}
