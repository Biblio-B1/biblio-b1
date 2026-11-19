import Link from "next/link";
import { DocumentList } from "@/components/library/DocumentList";
import { IconCamera, IconPen, IconUpload } from "@/components/layout/Icons";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listDocuments } from "@/server/documents";
import { countBySubject } from "@/server/library";
import { listSubjects } from "@/server/subjects";

export const metadata = { title: "Tableau de bord" };

export default async function Dashboard() {
  const user = await requireUser();
  const db = getDb();
  const subjects = listSubjects(db);
  const docs = listDocuments(db);
  const counts = countBySubject(db);
  const toReview = docs.filter((d) => !d.subjectConfirmed || !d.subjectId).slice(0, 5);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <h1 className="page-title">Bonjour {user.name}</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/upload" className="btn btn-primary">
            <IconUpload size={16} /> Déposer des fichiers
          </Link>
          <Link href="/upload#photo" className="btn sm:hidden">
            <IconCamera size={16} /> Prendre une photo
          </Link>
          <Link href="/notes/new" className="btn">
            <IconPen size={16} /> Écrire une fiche
          </Link>
        </div>
      </section>

      <section aria-labelledby="shelf" className="flex flex-col gap-3">
        <h2 id="shelf" className="text-[15px] font-semibold">Matières</h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {subjects.map((s) => (
            <li key={s.id}>
              <Link
                href={`/library/${s.slug}`}
                className="flex h-full flex-col justify-between gap-6 rounded-lg border border-line bg-surface p-3 transition-colors hover:border-line-strong"
                style={{ boxShadow: `inset 4px 0 0 ${s.color}` }}
              >
                <span className="pl-1.5 text-[14px] leading-snug font-medium">{s.name}</span>
                <span className="pl-1.5 text-[13px] text-ink-3 tabular-nums">
                  {counts.get(s.id) ?? 0} document{(counts.get(s.id) ?? 0) > 1 ? "s" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {toReview.length > 0 && (
        <section aria-labelledby="review" className="flex flex-col gap-3">
          <h2 id="review" className="text-[15px] font-semibold">Matière à vérifier</h2>
          <p className="-mt-1 text-[14px] text-ink-2">Classés automatiquement ou sans matière : ouvrez-les pour confirmer.</p>
          <DocumentList docs={toReview} subjects={subjects} />
        </section>
      )}

      <section aria-labelledby="recent" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 id="recent" className="text-[15px] font-semibold">Ajoutés récemment</h2>
          {docs.length > 8 && (
            <Link href="/library" className="text-[14px] text-ink-2 hover:text-ink">
              Toute la bibliothèque
            </Link>
          )}
        </div>
        <DocumentList
          docs={docs.slice(0, 8)}
          subjects={subjects}
          empty={
            <>
              La bibliothèque est vide.{" "}
              <Link href="/upload" className="text-ink underline underline-offset-2">
                Déposez un premier cours
              </Link>{" "}
              ou lancez <code className="font-mono text-[13px]">npm run import</code>.
            </>
          }
        />
      </section>
    </div>
  );
}
