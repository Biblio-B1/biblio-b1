import Link from "next/link";
import { notFound } from "next/navigation";
import { QAPanel } from "@/components/qa/QAPanel";
import { Spine } from "@/components/layout/Spine";
import { CodeExercise } from "@/components/training/CodeExercise";
import { Reveal } from "@/components/training/Reveal";
import { StatusPicker } from "@/components/training/StatusPicker";
import { requireUser } from "@/server/auth/session";
import { getAttempt, getCheck } from "@/server/checks";
import { getDb } from "@/server/db/client";
import { getDocument } from "@/server/documents";
import { env } from "@/server/env";
import { getExercise, getProgress, getVariants } from "@/server/progress";
import { listSubjects } from "@/server/subjects";

type Params = Promise<{ id: string }>;

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

export async function generateMetadata({ params }: { params: Params }) {
  await requireUser();
  const { id } = await params;
  return { title: (isUuid(id) && getExercise(getDb(), id)?.title) || "Exercice" };
}

/** Texte extrait d'un PDF : affiché tel quel, retours à la ligne conservés. */
function Plain({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{text}</div>;
}

export default async function ExercisePage({ params }: { params: Params }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = getDb();
  const ex = getExercise(db, id);
  if (!ex) notFound();
  const doc = getDocument(db, ex.documentId);
  const subject = listSubjects(db).find((s) => s.id === ex.subjectId);
  const status = getProgress(db, user.id).get(ex.id) ?? "todo";
  const variants = getVariants(db, ex);
  const hints = (ex.hints ?? []).filter((h) => h.trim());
  const checkRow = getCheck(db, ex.id);
  // Tous les tests (cachés compris) partent au navigateur : la vérification s'y exécute ;
  // l'interface n'affiche que l'entrée et la sortie attendue du test visible.
  const check = checkRow
    ? { status: checkRow.status, language: checkRow.language, tests: checkRow.tests ?? [], verified: checkRow.verified }
    : null;
  const attemptRow = getAttempt(db, user.id, ex.id);
  const attempt = attemptRow ? { language: attemptRow.language, code: attemptRow.code } : null;

  return (
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
                  <Link href={`/doc/${doc.id}`} className="underline underline-offset-2 hover:text-ink">
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
                  href={`/training/${v.id}`}
                  className="h-8 rounded-full border border-line px-3 text-[13.5px] leading-[30px] text-ink-2 hover:border-line-strong hover:text-ink"
                >
                  {v.lang.toUpperCase()}
                </Link>
              ))}
            </div>
          )}
        </div>
        {/* key : remonté avec le nouveau statut après une vérification réussie (router.refresh). */}
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
        isAdmin={user.role === "admin"}
        timeoutMs={env.SOLVER_TIMEOUT_MS}
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

      <QAPanel targetType="exercise" targetId={ex.id} viewer={{ id: user.id, role: user.role }} />
    </div>
  );
}
