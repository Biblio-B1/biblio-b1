"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Spine } from "@/components/layout/Spine";
import { CategorizedDocumentList } from "@/components/library/CategorizedDocumentList";
import { listDocuments, listSubjects } from "@/lib/api/library";
import type { Document } from "@/lib/api/types";
import { useData } from "@/lib/api/use-data";
import { groupDocumentsByCategory, parseCategory } from "@/lib/doc-categories";
import { UNCLASSIFIED_SLUG } from "@/lib/routes";

function SubjectView() {
  const params = useSearchParams();
  const slug = params.get("slug") ?? "";
  const category = parseCategory(params.get("cat"), params.get("type"));
  const q = params.get("q")?.slice(0, 200) || undefined;
  const { data, error } = useData(async () => {
    const subjects = await listSubjects();
    const subject = slug === UNCLASSIFIED_SLUG ? null : (subjects.find((s) => s.slug === slug) ?? undefined);
    if (subject === undefined) return { subjects, subject, all: [] as Document[] };
    const all = await listDocuments({ subjectId: subject ? subject.id : null });
    return { subjects, subject, all };
  }, [slug]);

  if (error) return <p role="alert" className="text-danger">{error}</p>;
  if (!data) return <p className="text-sm text-ink-3">Chargement…</p>;
  if (data.subject === undefined) return <p className="text-ink-2">Matière introuvable.</p>;

  const { subject, all, subjects } = data;
  const catCount = groupDocumentsByCategory(all).length;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-start gap-3">
        <Spine color={subject?.color ?? null} className="mt-1 h-8" />
        <div>
          <h1 className="page-title">{subject?.name ?? "Sans matière"}</h1>
          <p className="text-ink-2">
            {all.length} document{all.length > 1 ? "s" : ""}
            {catCount > 1 ? ` · ${catCount} catégories` : ""}
            {!subject && " à classer : ouvrez-en un pour choisir sa matière."}
          </p>
        </div>
      </header>

      <CategorizedDocumentList
        key={slug}
        docs={all}
        subjects={subjects}
        showSubject={false}
        activeCategory={category}
        baseHref="/library/subject"
        extraParams={{ slug }}
        initialQuery={q}
        empty={
          <>
            Rien ici pour l&apos;instant.{" "}
            <Link href="/upload" className="text-ink underline underline-offset-2">
              Déposer des fichiers
            </Link>
            .
          </>
        }
      />
    </div>
  );
}

export default function SubjectPage() {
  return (
    <Suspense fallback={null}>
      <SubjectView />
    </Suspense>
  );
}
