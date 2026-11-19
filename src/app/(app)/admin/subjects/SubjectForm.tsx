"use client";

import { useActionState, useState } from "react";
import type { FormState } from "@/components/ActionForm";

type Values = { name: string; color: string; pathPatterns: string; keywords: string };

/** Formulaire d'une matière ; champs contrôlés pour conserver la saisie en cas d'erreur. */
export function SubjectForm({
  action,
  initial,
  submitLabel,
  idPrefix,
  resetOnSuccess = false,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  initial: Values;
  submitLabel: string;
  idPrefix: string;
  resetOnSuccess?: boolean;
}) {
  const [v, setV] = useState(initial);
  const [state, formAction, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const res = await action(prev, fd);
    if (resetOnSuccess && !res?.error) setV(initial);
    return res;
  }, null);
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setV((old) => ({ ...old, [k]: e.target.value }));

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <label className="label">
          Nom
          <input name="name" value={v.name} onChange={set("name")} required maxLength={60} className="input" />
        </label>
        <label className="label">
          Couleur
          <span className="flex h-10 items-center gap-2">
            <input
              type="color"
              name="color"
              value={v.color}
              onChange={set("color")}
              className="h-9 w-12 cursor-pointer rounded border border-line-strong bg-surface p-0.5"
            />
            <code className="hidden font-mono text-[13px] text-ink-3 sm:inline">{v.color}</code>
          </span>
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="label" htmlFor={`${idPrefix}-patterns`}>
          <span>
            Motifs de chemin ou de nom{" "}
            <span className="font-normal text-ink-3">(expressions régulières, une par ligne)</span>
          </span>
          <textarea
            id={`${idPrefix}-patterns`}
            name="pathPatterns"
            value={v.pathPatterns}
            onChange={set("pathPatterns")}
            rows={6}
            spellCheck={false}
            className="input h-auto resize-y py-2 font-mono text-[13px]"
          />
        </label>
        <label className="label" htmlFor={`${idPrefix}-keywords`}>
          <span>
            Mots-clés <span className="font-normal text-ink-3">(« mot: poids » de 1 à 10, un par ligne)</span>
          </span>
          <textarea
            id={`${idPrefix}-keywords`}
            name="keywords"
            value={v.keywords}
            onChange={set("keywords")}
            rows={6}
            spellCheck={false}
            className="input h-auto resize-y py-2 font-mono text-[13px]"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Enregistrement…" : submitLabel}
        </button>
        {state?.error && (
          <p role="alert" className="text-[14px] text-danger">
            {state.error}
          </p>
        )}
        {state?.message && (
          <p role="status" className="text-[14px] text-ok">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
