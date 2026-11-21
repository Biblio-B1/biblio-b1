"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { MarkdownView } from "@/components/viewers/MarkdownView";
import { createNoteAction, type NoteState } from "@/lib/api/notes";
import { docHref } from "@/lib/routes";

const PLACEHOLDER = `## Pointeurs

Un pointeur contient l'adresse d'une variable.

\`\`\`c
int x = 42;
int *p = &x;
printf("%d\\n", *p);
\`\`\`

Formule : $\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$`;

/** Éditeur Markdown avec aperçu (côte à côte sur grand écran, onglets sur mobile). */
export function NoteEditor({ subjects }: { subjects: { id: string; name: string }[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: NoteState, fd: FormData) => {
    const r = await createNoteAction(prev, fd);
    if (r?.id) router.push(docHref(r.id));
    return r;
  }, null);
  // Champs contrôlés : React réinitialise le formulaire après l'action (erreur incluse).
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [body, setBody] = useState("");
  const [tab, setTab] = useState<"edit" | "preview">("edit");

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
        <label className="label">
          Titre
          <input
            name="title"
            required
            maxLength={300}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input"
            placeholder="Ex. Résumé du chapitre 3"
          />
        </label>
        <label className="label">
          Matière
          <select name="subjectId" className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">Sans matière</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div role="tablist" aria-label="Mode" className="flex gap-1 lg:hidden">
        {(["edit", "preview"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`btn h-8 ${tab === t ? "bg-sunken" : "btn-ghost"}`}
          >
            {t === "edit" ? "Écrire" : "Aperçu"}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <label className={`flex flex-col gap-1.5 ${tab === "edit" ? "" : "hidden lg:flex"}`}>
          <span className="hidden text-sm font-medium text-ink-2 lg:block">Markdown</span>
          <textarea
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={PLACEHOLDER}
            spellCheck
            className="min-h-[50vh] w-full resize-y rounded-lg border border-line-strong bg-surface p-4 font-mono text-[14px] leading-relaxed text-ink placeholder:text-ink-3"
            aria-label="Contenu de la fiche (Markdown)"
          />
        </label>
        <div className={`flex flex-col gap-1.5 ${tab === "preview" ? "" : "hidden lg:flex"}`}>
          <span className="hidden text-sm font-medium text-ink-2 lg:block">Aperçu</span>
          <div className="min-h-[50vh] overflow-x-auto rounded-lg border border-line bg-surface p-4 md:p-6">
            {body.trim() ? <MarkdownView source={body} /> : <p className="text-ink-3">L&apos;aperçu s&apos;affiche ici.</p>}
          </div>
        </div>
      </div>

      {state?.error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger-bg p-3 text-[14px] text-danger">
          {state.error}
        </p>
      )}
      <div>
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Enregistrement…" : "Enregistrer la fiche"}
        </button>
      </div>
    </form>
  );
}
