"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Spine } from "@/components/layout/Spine";
import { DocumentList, TypeFilter } from "@/components/library/DocumentList";
import { useSignedUrl } from "@/lib/api/files";
import { listDocuments, listSubjects } from "@/lib/api/library";
import type { Document } from "@/lib/api/types";
import { useData } from "@/lib/api/use-data";
import { filterByTitle, parseType } from "@/lib/labels";
import { UNCLASSIFIED_SLUG, docHref } from "@/lib/routes";

function PhotoThumb({ doc }: { doc: Document }) {
  const src = useSignedUrl(doc.filePath);
  return (
    <Link href={docHref(doc.id)} className="block overflow-hidden rounded-md border border-line" title={doc.title}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={doc.title} loading="lazy" className="h-24 w-32 object-cover" />
      ) : (
        <span className="block h-24 w-32 animate-pulse bg-sunken" />
      )}
    </Link>
  );
}

function SubjectView() {
  const params = useSearchParams();
  const slug = params.get("slug") ?? "";
  const type = parseType(params.get("type") ?? undefined);
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
  const docs = filterByTitle(type ? all.filter((d) => d.type === type) : all, q);
  const photos = all.filter((d) => d.type === "photo" && d.mime.startsWith("image/")).slice(0, 12);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-start gap-3">
        <Spine color={subject?.color ?? null} className="mt-1 h-8" />
        <div>
          <h1 className="page-title">{subject?.name ?? "Sans matière"}</h1>
          <p className="text-ink-2">
            {all.length} document{all.length > 1 ? "s" : ""}
            {!subject && " à classer : ouvrez-en un pour choisir sa matière."}
          </p>
        </div>
      </header>

      {photos.length > 0 && !type && (
        <section aria-label="Photos récentes" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <ul className="flex gap-2">
            {photos.map((p) => (
              <li key={p.id} className="shrink-0">
                <PhotoThumb doc={p} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <TypeFilter active={type} base="/library/subject" q={q} extra={{ slug }} />
      <DocumentList
        docs={docs}
        subjects={subjects}
        showSubject={false}
        empty={
          <>
            Rien ici pour l&apos;instant.{" "}
            <Link href="/upload" className="text-ink underline underline-offset-2">
              Déposer des fichiers
            </Link>
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
