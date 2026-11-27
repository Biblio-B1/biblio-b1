"use client";

import { ListSkeleton } from "@/components/Skeleton";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CategorizedDocumentList, CategoryFilter } from "@/components/library/CategorizedDocumentList";
import { DocumentList } from "@/components/library/DocumentList";
import { listDocuments, listSubjects } from "@/lib/api/library";
import { useData } from "@/lib/api/use-data";
import {
  categorizeDocument,
  groupDocumentsByCategory,
  matchesDocumentQuery,
  parseCategory,
} from "@/lib/doc-categories";

function Library() {
  const params = useSearchParams();
  const category = parseCategory(params.get("cat"), params.get("type"));
  const q = params.get("q")?.slice(0, 200) || undefined;
  const view = params.get("view") === "categories" ? "categories" : "recent";

  const { data, error } = useData(async () => {
    const [subjects, docs] = await Promise.all([listSubjects(), listDocuments()]);
    return { subjects, docs };
  }, []);

  const allDocs = data?.docs ?? [];
  const queryFiltered = q ? allDocs.filter((d) => matchesDocumentQuery(d, q)) : allDocs;
  const recentDocs = category ? queryFiltered.filter((d) => categorizeDocument(d) === category) : queryFiltered;
  const groupsForPills = groupDocumentsByCategory(queryFiltered);
  const totalGroupsCount = groupDocumentsByCategory(allDocs).length;

  const viewHref = (targetView: "recent" | "categories") => {
    const p = new URLSearchParams();
    if (targetView === "categories") p.set("view", "categories");
    if (category) p.set("cat", category);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `/library?${s}` : "/library";
  };

  const emptyNode =
    q || category ? (
      "Aucun document ne correspond. Essayez un autre mot ou retirez le filtre."
    ) : (
      <>
        Aucun document pour l&apos;instant.{" "}
        <Link href="/upload" data-write className="text-ink underline underline-offset-2">
          Déposer des fichiers
        </Link>
        .
      </>
    );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="page-title">Bibliothèque</h1>
          <p className="text-ink-2">
            {!data
              ? error ?? " "
              : q
                ? `${recentDocs.length} résultat${recentDocs.length > 1 ? "s" : ""} pour « ${q} »`
                : `${recentDocs.length} document${recentDocs.length > 1 ? "s" : ""}`}
          </p>
        </div>

        <div
          role="group"
          aria-label="Mode d'affichage"
          className="inline-flex rounded-md border border-line bg-surface p-0.5 text-[13.5px]"
        >
          <Link
            href={viewHref("recent")}
            aria-current={view === "recent" ? "page" : undefined}
            className={`rounded px-2.5 py-1 transition-colors ${
              view === "recent" ? "bg-sunken font-medium text-ink" : "text-ink-2 hover:text-ink"
            }`}
          >
            Récents
          </Link>
          <Link
            href={viewHref("categories")}
            aria-current={view === "categories" ? "page" : undefined}
            className={`rounded px-2.5 py-1 transition-colors ${
              view === "categories" ? "bg-sunken font-medium text-ink" : "text-ink-2 hover:text-ink"
            }`}
          >
            Par catégorie
          </Link>
        </div>
      </header>

      {!data && !error && <ListSkeleton rows={6} />}
      {data &&
        (view === "categories" ? (
          <CategorizedDocumentList
            docs={data.docs}
            subjects={data.subjects}
            showSubject
            activeCategory={category}
            baseHref="/library"
            extraParams={{ view: "categories" }}
            initialQuery={q}
            empty={emptyNode}
          />
        ) : (
          <>
            {(totalGroupsCount >= 2 || Boolean(category)) && (
              <CategoryFilter
                groups={groupsForPills}
                totalCount={queryFiltered.length}
                active={category}
                base="/library"
                q={q}
              />
            )}
            <DocumentList docs={recentDocs} subjects={data.subjects} empty={emptyNode} />
          </>
        ))}
    </div>
  );
}

export default function LibraryPage() {
  return (
    <Suspense fallback={null}>
      <Library />
    </Suspense>
  );
}
