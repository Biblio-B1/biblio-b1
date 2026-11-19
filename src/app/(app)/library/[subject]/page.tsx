import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentList, TypeFilter } from "@/components/library/DocumentList";
import { Spine } from "@/components/layout/Spine";
import { fileUrl, parseType } from "@/lib/labels";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listDocuments } from "@/server/documents";
import { filterByTitle, listUnclassified } from "@/server/library";
import { getSubjectBySlug, listSubjects } from "@/server/subjects";

const UNCLASSIFIED = "sans-matiere";

type Params = Promise<{ subject: string }>;
type SP = Promise<{ type?: string; q?: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  await requireUser();
  const { subject } = await params;
  if (subject === UNCLASSIFIED) return { title: "Sans matière" };
  return { title: getSubjectBySlug(getDb(), subject)?.name ?? "Matière" };
}

export default async function SubjectPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  await requireUser();
  const { subject: slug } = await params;
  const { type: rawType, q: rawQ } = await searchParams;
  const q = typeof rawQ === "string" ? rawQ.slice(0, 200) : undefined;
  const type = parseType(rawType);
  const db = getDb();
  const subjects = listSubjects(db);
  const subject = slug === UNCLASSIFIED ? null : getSubjectBySlug(db, slug);
  if (slug !== UNCLASSIFIED && !subject) notFound();

  const all = subject ? listDocuments(db, { subjectId: subject.id }) : listUnclassified(db);
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
                <Link href={`/doc/${p.id}`} className="block overflow-hidden rounded-md border border-line" title={p.title}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileUrl(p.filePath)} alt={p.title} loading="lazy" className="h-24 w-32 object-cover" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <TypeFilter active={type} base={`/library/${slug}`} q={q} />
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
