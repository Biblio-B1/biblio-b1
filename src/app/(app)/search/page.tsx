"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Spine } from "@/components/layout/Spine";
import { listSubjects } from "@/lib/api/library";
import { listAuthors, search } from "@/lib/api/search";
import { useData } from "@/lib/api/use-data";
import { DOC_TYPE_LABELS, DOC_TYPE_VALUES, formatDate } from "@/lib/labels";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function SearchView() {
  const sp = useSearchParams();
  const router = useRouter();
  const raw = Object.fromEntries(["q", "subject", "kind", "author", "from", "to"].map((k) => [k, sp.get(k) ?? undefined])) as Record<
    string,
    string | undefined
  >;
  const tooLong = (raw.q ?? "").trim().length > 200;
  const badDates = (!!raw.from && !DATE.test(raw.from)) || (!!raw.to && !DATE.test(raw.to));
  const parsed = !tooLong && !badDates;
  const v = raw;
  const { data } = useData(async () => {
    const [subjects, authors, results] = await Promise.all([
      listSubjects(),
      listAuthors(),
      parsed && raw.q ? search(raw.q, { subject: raw.subject, kind: raw.kind, author: raw.author, from: raw.from, to: raw.to }) : Promise.resolve([]),
    ]);
    return { subjects, authors, results };
  }, [sp.toString()]);
  const subjects = data?.subjects ?? [];
  const authors = data?.authors ?? [];
  const results = data?.results ?? [];
  const bySubject = new Map(subjects.map((s) => [s.id, s]));

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="page-title">Recherche</h1>
        <p className="text-ink-2" aria-live="polite">
          {!parsed
            ? tooLong
              ? "Recherche trop longue (200 caractères max)."
              : "Filtres invalides : vérifiez les dates."
            : v?.q
              ? `${results.length} résultat${results.length > 1 ? "s" : ""} pour « ${v.q} »`
              : "Cherchez dans les cours, exercices, annales et notes."}
        </p>
      </header>

      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const p = new URLSearchParams();
          for (const [k, val] of new FormData(e.currentTarget)) if (String(val).trim()) p.set(k, String(val).trim());
          router.push(`/search?${p}`);
        }}
        className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="label sm:col-span-2 lg:col-span-3">
          Mots
          <input name="q" type="search" defaultValue={v?.q ?? raw.q ?? ""} maxLength={200} placeholder="pointeur, mémoire…" className="input" />
        </label>
        <label className="label">
          Matière
          <select name="subject" defaultValue={v?.subject ?? ""} className="input">
            <option value="">Toutes</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          Type
          <select name="kind" defaultValue={v?.kind ?? ""} className="input">
            <option value="">Tous</option>
            {DOC_TYPE_VALUES.map((t) => (
              <option key={t} value={t}>
                {DOC_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          Auteur
          <select name="author" defaultValue={v?.author ?? ""} className="input">
            <option value="">Tous</option>
            {authors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          Depuis le
          <input name="from" type="date" defaultValue={v?.from ?? ""} className="input" />
        </label>
        <label className="label">
          Jusqu&apos;au
          <input name="to" type="date" defaultValue={v?.to ?? ""} className="input" />
        </label>
        <div className="flex items-end gap-2">
          <button className="btn btn-primary h-10">Rechercher</button>
          <Link href="/search" className="btn btn-ghost h-10">
            Réinitialiser
          </Link>
        </div>
      </form>

      {parsed && v?.q && results.length === 0 && (
        <div className="rounded-lg border border-dashed border-line-strong p-6 text-ink-2">Aucun résultat. Essayez un autre mot ou retirez un filtre.</div>
      )}
      {results.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {results.map((r) => {
            const s = r.subjectId ? bySubject.get(r.subjectId) : undefined;
            return (
              <li key={`${r.entity}-${r.refId}`}>
                <Link href={r.href} className="flex items-start gap-3 px-3 py-3 transition-colors hover:bg-sunken sm:px-4">
                  <Spine color={s?.color ?? null} className="mt-0.5 h-10" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{r.title}</span>
                    <span className="block truncate text-[13px] text-ink-3">
                      {DOC_TYPE_LABELS[r.kind]}
                      {s ? `, ${s.name}` : ""}, {formatDate(r.createdAt)}
                    </span>
                    {r.snippet && <span className="snippet mt-1 line-clamp-2 block text-[13px] text-ink-2" dangerouslySetInnerHTML={{ __html: r.snippet }} />}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchView />
    </Suspense>
  );
}
