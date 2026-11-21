"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { Spine } from "@/components/layout/Spine";
import { PageRefreshProvider } from "@/components/PageRefresh";
import { CodeExercise } from "@/components/training/CodeExercise";
import { Reveal } from "@/components/training/Reveal";
import { StatusPicker } from "@/components/training/StatusPicker";
import { listSubjects } from "@/lib/api/library";
import { getExerciseDetail } from "@/lib/api/training";
import { useData } from "@/lib/api/use-data";
import { docHref, exerciseHref } from "@/lib/routes";

/** Délai d'exécution du code de l'étudiant (compilation comprise), comme le pré-calcul. */
const RUN_TIMEOUT_MS = 5000;

/** Texte extrait d'un PDF : affiché tel quel, retours à la ligne conservés. */
function Plain({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{text}</div>;
}

function ExerciseView() {
  const id = useSearchParams().get("id") ?? "";
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const { data, error, reload } = useData(async () => {
    const [detail, subjects] = await Promise.all([getExerciseDetail(id, isAdmin), listSubjects()]);
    return { detail, subjects };
  }, [id, isAdmin]);

  if (error) return <p role="alert" className="text-danger">{error}</p>;
  if (!data) return <p className="text-sm text-ink-3">Chargement…</p>;
  if (!data.detail) return <p className="text-ink-2">Exercice introuvable.</p>;
  const { exercise: ex, document: doc, variants, status, check, attempt } = data.detail;
  const subject = data.subjects.find((s) => s.id === ex.subjectId);
  const hints = (ex.hints ?? []).filter((h) => h.trim());

  return (
    <PageRefreshProvider value={reload}>
      <div className="flex flex-col gap-5">
        <Link href="/training" className="text-[14px] text-ink-2 underline-offset-2 hover:text-ink hover:underline">
          Retour à l&apos;entraînement
        </Link>
        <header className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <Spine color={subject?.color ?? null} className="mt-1.5 h-7" />
            <div className="min-w-0 flex-1">
              <h1 className="page-title break-words">{ex.title}</h1>
              <p className="mt-1 text-[14px] text-ink-2">
                Exercice {ex.number}, {subject?.name ?? "sans matière"}, {ex.lang.toUpperCase()}
                {doc && (
                  <>
                    {" · "}
                    <Link href={docHref(doc.id)} className="underline underline-offset-2 hover:text-ink">
                      Voir le PDF source
                    </Link>
                  </>
                )}
              </p>
            </div>
            {variants.length > 0 && (
              <div role="group" aria-label="Langue" className="flex shrink-0 gap-1">
                <span aria-current="true" className="h-8 rounded-full border border-ink bg-ink px-3 text-[13.5px] leading-[30px] text-bg">
                  {ex.lang.toUpperCase()}
                </span>
                {variants.map((v) => (
                  <Link
                    key={v.id}
                    href={exerciseHref(v.id)}
                    className="h-8 rounded-full border border-line px-3 text-[13.5px] leading-[30px] text-ink-2 hover:border-line-strong hover:text-ink"
                  >
                    {v.lang.toUpperCase()}
                  </Link>
                ))}
              </div>
            )}
          </div>
          {/* key : remonté avec le nouveau statut après une vérification réussie (rechargement). */}
          <StatusPicker key={status} exerciseId={ex.id} status={status} />
        </header>

        <article className="rounded-lg border border-line bg-surface px-5 py-6 md:px-10 md:py-8">
          <Plain text={ex.statement} />
        </article>

        <CodeExercise
          key={ex.id}
          exerciseId={ex.id}
          check={check}
          attempt={attempt}
          isAdmin={isAdmin}
          timeoutMs={RUN_TIMEOUT_MS}
          subjectName={subject?.name ?? null}
        />

        {hints.length > 0 && (
          <Reveal showLabel="Afficher les indices" hideLabel="Masquer les indices">
            <ol className="flex list-decimal flex-col gap-2 pl-5">
              {hints.map((h, i) => (
                <li key={i}>
                  <Plain text={h} />
                </li>
              ))}
            </ol>
          </Reveal>
        )}

        {ex.solution ? (
          <Reveal showLabel="Afficher la correction" hideLabel="Masquer la correction">
            <Plain text={ex.solution} />
          </Reveal>
        ) : (
          <p className="text-[14px] text-ink-3">Pas de correction disponible pour cet exercice.</p>
        )}
      </div>
    </PageRefreshProvider>
  );
}

export default function ExercisePage() {
  return (
    <Suspense fallback={null}>
      <ExerciseView />
    </Suspense>
  );
}
