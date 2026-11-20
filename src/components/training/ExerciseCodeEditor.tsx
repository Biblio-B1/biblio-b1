"use client";

import { useState, useTransition } from "react";
import { checkExerciseCodeAction } from "@/app/(app)/training/actions";
import type { ExerciseCheckResult } from "@/server/exercise-check";

export function ExerciseCodeEditor({ exerciseId, lang }: { exerciseId: string; lang: string }) {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<ExerciseCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCheck(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await checkExerciseCodeAction(exerciseId, code);
      if (res.error) {
        setError(res.error);
      } else if (res.result) {
        setResult(res.result);
      }
    });
  }

  return (
    <section aria-labelledby="exercise-workspace" className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="exercise-workspace" className="text-[15px] font-semibold">
          Faire l&apos;exercice
        </h2>
        <span className="text-xs text-ink-3">
          {lang === "en" ? "Code submission & automated feedback" : "Saisissez votre code puis vérifiez-le"}
        </span>
      </div>

      <form onSubmit={handleCheck} className="flex flex-col gap-3">
        <label className="label">
          <span className="sr-only">Votre code</span>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Tab") {
                e.preventDefault();
                const el = e.currentTarget;
                const start = el.selectionStart;
                const end = el.selectionEnd;
                const next = `${code.slice(0, start)}    ${code.slice(end)}`;
                setCode(next);
                requestAnimationFrame(() => {
                  el.selectionStart = el.selectionEnd = start + 4;
                });
              }
            }}
            rows={10}
            spellCheck={false}
            placeholder={"// Écrivez votre code ici...\nint main(void) {\n    \n    return 0;\n}"}
            className="input h-auto resize-y py-3 font-mono text-[13.5px] leading-relaxed"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className="btn btn-primary">
            {pending ? "Vérification…" : "Vérifier mon code"}
          </button>
          {code.trim().length > 0 && (
            <button
              type="button"
              className="btn btn-ghost text-ink-2"
              onClick={() => {
                setCode("");
                setResult(null);
                setError(null);
              }}
            >
              Effacer
            </button>
          )}
        </div>
      </form>

      {error && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
          {error}
        </p>
      )}

      {result && !result.correct && (
        <div role="status" className="flex flex-col gap-4 rounded-lg border border-danger/30 bg-danger-bg p-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold text-danger">
              Code incorrect — Correction détaillée
            </h3>
            {result.issues.length > 0 && (
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm text-danger">
                {result.issues.map((issue, idx) => (
                  <li key={idx}>{issue}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-1.5 rounded-md border border-line bg-surface p-3.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-2">Explication</h4>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{result.explanation}</p>
          </div>

          <div className="flex flex-col gap-1.5 rounded-md border border-line bg-surface p-3.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-2">Réponse attendue</h4>
            <pre className="overflow-x-auto rounded border border-line bg-sunken p-3 font-mono text-[13px] leading-relaxed text-ink">
              <code>{result.answer}</code>
            </pre>
          </div>
        </div>
      )}

      {result && result.correct && (
        <div role="status" className="flex flex-col gap-3 rounded-lg border border-ok/40 bg-sunken p-4">
          <h3 className="text-sm font-semibold text-ok">Code valide</h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{result.explanation}</p>
          <details className="rounded-md border border-line bg-surface p-3 text-sm">
            <summary className="cursor-pointer font-medium text-ink-2">Voir la réponse de référence</summary>
            <pre className="mt-2 overflow-x-auto rounded border border-line bg-sunken p-3 font-mono text-[13px] leading-relaxed text-ink">
              <code>{result.answer}</code>
            </pre>
          </details>
        </div>
      )}
    </section>
  );
}
