import Link from "next/link";
import { DocumentList, TypeFilter } from "@/components/library/DocumentList";
import { parseType } from "@/lib/labels";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listDocuments } from "@/server/documents";
import { filterByTitle } from "@/server/library";
import { listSubjects } from "@/server/subjects";

export const metadata = { title: "Bibliothèque" };

type SP = Promise<{ type?: string; q?: string }>;

export default async function LibraryPage({ searchParams }: { searchParams: SP }) {
  await requireUser();
  const { type: rawType, q: rawQ } = await searchParams;
  const type = parseType(rawType);
  const q = typeof rawQ === "string" ? rawQ.slice(0, 200) : undefined;
  const db = getDb();
  const subjects = listSubjects(db);
  const docs = filterByTitle(listDocuments(db, { type }), q);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="page-title">Bibliothèque</h1>
        <p className="text-ink-2">
          {q ? `${docs.length} résultat${docs.length > 1 ? "s" : ""} pour « ${q} »` : `${docs.length} document${docs.length > 1 ? "s" : ""}`}
        </p>
      </header>
      <TypeFilter active={type} base="/library" q={q} />
      <DocumentList
        docs={docs}
        subjects={subjects}
        empty={
          q || type ? (
            "Aucun document ne correspond. Essayez un autre mot ou retirez le filtre."
          ) : (
            <>
              Aucun document pour l&apos;instant.{" "}
              <Link href="/upload" className="text-ink underline underline-offset-2">
                Déposer des fichiers
              </Link>
            </>
          )
        }
      />
    </div>
  );
}
