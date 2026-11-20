import Link from "next/link";
import { Spine } from "@/components/layout/Spine";
import { ExerciseCard } from "@/components/training/ExerciseCard";
import { PROGRESS_STATUS_LABELS, PROGRESS_STATUS_VALUES, parseStatus } from "@/lib/labels";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { LANGS } from "@/server/db/schema";
import { listExercises, progressBySubject, type Lang, type Summary } from "@/server/progress";
import { listSubjects } from "@/server/subjects";

export const metadata = { title: "Entraînement" };

const PAGE_SIZE = 50;

type SP = Promise<{ subject?: string; status?: string; lang?: string; q?: string; page?: string }>;

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

export default async function TrainingPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const subjects = listSubjects(db);
  const subject = subjects.find((s) => s.id === sp.subject);
  const status = parseStatus(sp.status);
  const lang = (LANGS as readonly string[]).includes(sp.lang ?? "") ? (sp.lang as Lang) : undefined;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 200).trim() || undefined : undefined;
  const page = Math.min(Math.max(Number.parseInt(sp.page ?? "1", 10) || 1, 1), 1000);

  const rows = listExercises(db, {
    userId: user.id,
    subjectId: subject?.id,
    status,
    lang,
    q,
    limit: PAGE_SIZE + 1,
    offset: (page - 1) * PAGE_SIZE,
  });
  const hasNext = rows.length > PAGE_SIZE;
  const shown = rows.slice(0, PAGE_SIZE);
  const bySubject = progressBySubject(db, user.id);
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

      <form action="/training" className="flex gap-2">
        {subject && <input type="hidden" name="subject" value={subject.id} />}
        {status && <input type="hidden" name="status" value={status} />}
        {lang && <input type="hidden" name="lang" value={lang} />}
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
