"use client";

// Administrateur : déplace un document dans une autre catégorie de sa matière (ou le rend à la
// détection automatique).
import { useState, useTransition } from "react";
import { setDocumentCategory } from "@/lib/api/library";
import { categorizeDocument, DOC_CATEGORIES, type CategorizableDoc, type DocCategoryId } from "@/lib/doc-categories";

const AUTO = "";

export function MoveCategory({
  doc,
  onMoved,
  compact = false,
}: {
  doc: CategorizableDoc;
  /** Nouvelle catégorie choisie (null : automatique). */
  onMoved: (category: DocCategoryId | null) => void;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const current = categorizeDocument(doc);
  const auto = categorizeDocument({ ...doc, category: null });
  const autoLabel = DOC_CATEGORIES.find((c) => c.id === auto)?.label ?? "";

  return (
    <span data-write className="inline-flex flex-col gap-1">
      <label className={`flex items-center gap-1.5 text-ink-3 ${compact ? "text-[12px]" : "text-[13px]"}`}>
        <span className={compact ? "sr-only" : ""}>Catégorie</span>
        <select
          aria-label={`Déplacer « ${doc.title} » vers une autre catégorie`}
          title="Déplacer vers une autre catégorie (administrateur)"
          disabled={pending}
          value={doc.category ? current : AUTO}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const value = e.target.value === AUTO ? null : (e.target.value as DocCategoryId);
            setError(null);
            startTransition(async () => {
              const res = await setDocumentCategory(doc.id, value);
              if (res.error) setError(res.error);
              else onMoved(value);
            });
          }}
          className={`input w-auto py-0 pr-7 ${compact ? "h-7 text-[12px]" : "h-8 text-[13px]"}`}
        >
          <option value={AUTO}>Automatique ({autoLabel})</option>
          {DOC_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <span role="alert" className="text-[12px] text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
