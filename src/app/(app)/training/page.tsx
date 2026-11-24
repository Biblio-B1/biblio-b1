"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Spine } from "@/components/layout/Spine";
import { ExerciseCard } from "@/components/training/ExerciseCard";
import { listSubjects } from "@/lib/api/library";
import { getMyProgress, listAllExercises } from "@/lib/api/training";
import { filterExercises, summarizeBySubject, withStatus, type Lang, type Summary } from "@/lib/api/training-core";
import { useData } from "@/lib/api/use-data";
import { PROGRESS_STATUS_LABELS, PROGRESS_STATUS_VALUES, parseStatus } from "@/lib/labels";

const LANGS = ["fr", "en"] as const;
const PAGE_SIZE = 50;

/** Lien épinglé dans l'entraînement d'Algorithmique et programmation C. */
const CODEX_C_URL = "https://s-l-a-k-e-r.github.io/CODEX_C/#path";
function isAlgoC(s: { name: string; slug: string }): boolean {
  const n = `${s.name} ${s.slug}`.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return n.includes("algo") && /(^|[^a-z])c([^a-z+#]|$)/.test(n);
}

function Bar({ s }: { s: Summary }) {
  const pct = (n: number) => (s.total ? (n / s.total) * 100 : 0);
  return (
    <div
      role="img"
      aria-label={`${s.mastered} maîtrisés, ${s.doing} en cours, ${s.todo} à faire sur ${s.total}`}
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-sunken"
    >
      <span className="bg-ink" style={{ width: `${pct(s.mastered)}%` }} />
      <span className="bg-ink-3" style={{ width: `${pct(s.doing)}%` }} />
    </div>
  );
}

function Training() {
  const sp = useSearchParams();
  const router = useRouter();
  const { data, error } = useData(async () => {
    const [subjects, exercises, progress] = await Promise.all([listSubjects(), listAllExercises(), getMyProgress()]);
    return { subjects, all: withStatus(exercises, progress) };
  }, []);
  if (error) return <p role="alert" className="text-danger">{error}</p>;
  if (!data) return <p className="text-sm text-ink-3">Chargement…</p>;
  const { subjects, all } = data;
  const subject = subjects.find((s) => s.id === sp.get("subject"));
  const status = parseStatus(sp.get("status") ?? undefined);
  const rawLang = sp.get("lang") ?? "";
  const lang = (LANGS as readonly string[]).includes(rawLang) ? (rawLang as Lang) : undefined;
  const q = sp.get("q")?.slice(0, 200).trim() || undefined;
  const page = Math.min(Math.max(Number.parseInt(sp.get("page") ?? "1", 10) || 1, 1), 1000);

  const rows = filterExercises(all, { subjectId: subject?.id, status, lang, q });
  const hasNext = rows.length > page * PAGE_SIZE;
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const bySubject = summarizeBySubject(all);
  const byId = new Map(subjects.map((s) => [s.id, s]));

  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string | undefined> = { subject: subject?.id, status, lang, q, ...over };
    for (const [k, v] of Object.entries(cur)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/training?${s}` : "/training";
  };
  const chip = (active: boolean) =>
    `h-8 shrink-0 rounded-full border px-3 text-[13.5px] leading-[30px] transition-colors ${
      active ? "border-ink bg-ink text-bg" : "border-line text-ink-2 hover:border-line-strong hover:text-ink"
    }`;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="page-title">Entraînement</h1>
        <p className="text-ink-2">Suivez votre avancée exercice par exercice.</p>
      </header>

      <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2" aria-label="Progression par matière">
        {subjects
          .filter((s) => bySubject.get(s.id)?.total)
          .map((s) => {
            const sum = bySubject.get(s.id)!;
            return (
              <li key={s.id}>
                <Link href={href({ subject: s.id, page: undefined })} className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-2 text-[14px]">
                    <Spine color={s.color} />
                    <span className="min-w-0 flex-1 truncate text-ink">{s.name}</span>
                    <span className="text-[12.5px] text-ink-3 tabular-nums">
                      {sum.mastered}/{sum.total}
                    </span>
                  </span>
                  <Bar s={sum} />
                </Link>
              </li>
            );
          })}
      </ul>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const value = String(new FormData(e.currentTarget).get("q") ?? "").trim();
          router.push(href({ q: value || undefined, page: undefined }));
        }}
      >
        <input name="q" defaultValue={q} placeholder="Rechercher un exercice" aria-label="Rechercher un exercice" className="input h-9 min-w-0 flex-1" />
        <button className="btn h-9">Chercher</button>
      </form>

      <nav aria-label="Filtres" className="flex flex-col gap-2">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          <Link href={href({ subject: undefined, page: undefined })} aria-current={!subject ? "page" : undefined} className={chip(!subject)}>
            Toutes matières
          </Link>
          {subjects.map((s) => (
            <Link key={s.id} href={href({ subject: s.id, page: undefined })} aria-current={subject?.id === s.id ? "page" : undefined} className={chip(subject?.id === s.id)}>
              {s.name}
            </Link>
          ))}
        </div>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          <Link href={href({ status: undefined, page: undefined })} aria-current={!status ? "page" : undefined} className={chip(!status)}>
            Tous statuts
          </Link>
          {PROGRESS_STATUS_VALUES.map((s) => (
            <Link key={s} href={href({ status: s, page: undefined })} aria-current={status === s ? "page" : undefined} className={chip(status === s)}>
              {PROGRESS_STATUS_LABELS[s]}
            </Link>
          ))}
          <span aria-hidden className="mx-1 w-px shrink-0 bg-line" />
          <Link href={href({ lang: undefined, page: undefined })} aria-current={!lang ? "page" : undefined} className={chip(!lang)}>
            FR et EN
          </Link>
          {LANGS.map((l) => (
            <Link key={l} href={href({ lang: l, page: undefined })} aria-current={lang === l ? "page" : undefined} className={chip(lang === l)}>
              {l === "fr" ? "Français" : "English"}
            </Link>
          ))}
        </div>
      </nav>

      {subject && isAlgoC(subject) && (
        <a
          href={CODEX_C_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-lg border border-line-strong bg-surface p-3.5 transition-colors hover:border-ink"
          style={{ boxShadow: `inset 4px 0 0 ${subject.color}` }}
        >
          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-sunken text-base">
            📌
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold text-ink">CODEX C : parcours d&apos;entraînement</span>
            <span className="block truncate text-xs text-ink-2">Exercices de C guidés, à faire dans l&apos;ordre (s-l-a-k-e-r.github.io)</span>
          </span>
          <span className="btn btn-primary h-8 shrink-0 px-3 text-xs">Ouvrir ↗</span>
        </a>
      )}

      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong p-6 text-ink-2">
          Aucun exercice ne correspond. Essayez un autre mot ou retirez un filtre.
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {shown.map((e) => {
            const s = e.subjectId ? byId.get(e.subjectId) : undefined;
            return (
              <ExerciseCard key={e.id} id={e.id} title={e.title} number={e.number} lang={e.lang} status={e.status} subjectName={s?.name} color={s?.color ?? null} />
            );
          })}
        </ul>
      )}

      {(page > 1 || hasNext) && (
        <nav aria-label="Pagination" className="flex items-center justify-between text-[14px]">
          {page > 1 ? (
            <Link className="btn" href={href({ page: String(page - 1) })}>
              Précédent
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-3">Page {page}</span>
          {hasNext ? (
            <Link className="btn" href={href({ page: String(page + 1) })}>
              Suivant
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}

export default function TrainingPage() {
  return (
    <Suspense fallback={null}>
      <Training />
    </Suspense>
  );
}
