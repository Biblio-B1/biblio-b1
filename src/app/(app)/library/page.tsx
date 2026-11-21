"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { DocumentList, TypeFilter } from "@/components/library/DocumentList";
import { listDocuments, listSubjects } from "@/lib/api/library";
import { useData } from "@/lib/api/use-data";
import { filterByTitle, parseType } from "@/lib/labels";

function Library() {
  const params = useSearchParams();
  const type = parseType(params.get("type") ?? undefined);
  const q = params.get("q")?.slice(0, 200) || undefined;
  const { data, error } = useData(async () => {
    const [subjects, docs] = await Promise.all([listSubjects(), listDocuments({ type })]);
    return { subjects, docs };
  }, [type]);
  const docs = filterByTitle(data?.docs ?? [], q);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="page-title">Bibliothèque</h1>
        <p className="text-ink-2">
          {!data
            ? error ?? "Chargement…"
            : q
              ? `${docs.length} résultat${docs.length > 1 ? "s" : ""} pour « ${q} »`
              : `${docs.length} document${docs.length > 1 ? "s" : ""}`}
        </p>
      </header>
      <TypeFilter active={type} base="/library" q={q} />
      {data && (
        <DocumentList
          docs={docs}
          subjects={data.subjects}
          empty={
            q || type ? (
              "Aucun document ne correspond. Essayez un autre mot ou retirez le filtre."
            ) : (
              <>
                Aucun document pour l&apos;instant.{" "}
                <Link href="/upload" className="text-ink underline underline-offset-2">
                  Déposer des fichiers
                </Link>
                .
              </>
            )
          }
        />
      )}
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
