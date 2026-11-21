"use client";

import { useActionState, useRef, useState } from "react";
import { MarkdownView } from "@/components/viewers/MarkdownView";
import type { QAState } from "@/lib/api/threads";

type Props = {
  action: (prev: QAState, fd: FormData) => Promise<QAState>;
  hidden: Record<string, string>;
  submitLabel: string;
  /** Nouveau fil : titre + choix note/question. */
  withTitle?: boolean;
  placeholder?: string;
};

/** Éditeur Markdown (aperçu avec blocs de code colorés) et ajout d'une image. */
export function PostEditor({ action, hidden, submitLabel, withTitle, placeholder }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [fileName, setFileName] = useState("");
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [state, formAction, pending] = useActionState(async (prev: QAState, fd: FormData) => {
    const res = await action(prev, fd);
    if (res?.ok) {
      setTitle("");
      setBody("");
      setFileName("");
      setTab("edit");
      if (fileRef.current) fileRef.current.value = "";
    }
    return res;
  }, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {withTitle && (
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <label className="label">
            Titre
            <input
              name="title"
              required
              maxLength={300}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input"
              placeholder="Ex. Pourquoi *p et non p ?"
            />
          </label>
          <label className="label">
            Type
            <select name="kind" className="input" defaultValue="question">
              <option value="question">Question</option>
              <option value="note">Note</option>
            </select>
          </label>
        </div>
      )}

      <div role="tablist" aria-label="Mode" className="flex gap-1">
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
      <textarea
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder ?? "Markdown : ```c pour un bloc de code, $x^2$ pour une formule"}
        aria-label="Message (Markdown)"
        maxLength={20000}
        className={`min-h-32 w-full resize-y rounded-lg border border-line-strong bg-surface p-3 font-mono text-[14px] leading-relaxed text-ink placeholder:text-ink-3 ${tab === "edit" ? "" : "hidden"}`}
      />
      {tab === "preview" && (
        <div className="min-h-32 overflow-x-auto rounded-lg border border-line bg-surface p-3">
          {body.trim() ? <MarkdownView source={body} /> : <p className="text-ink-3">L&apos;aperçu s&apos;affiche ici.</p>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="btn cursor-pointer">
          Ajouter une image
          <input
            ref={fileRef}
            type="file"
            name="image"
            accept=".jpg,.jpeg,.png,.webp"
            className="sr-only"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
          />
        </label>
        {fileName && <span className="min-w-0 truncate text-[13px] text-ink-2">{fileName}</span>}
        <button type="submit" disabled={pending} className="btn btn-primary ml-auto">
          {pending ? "Envoi…" : submitLabel}
        </button>
      </div>
      {state?.error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger-bg p-2.5 text-[14px] text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
