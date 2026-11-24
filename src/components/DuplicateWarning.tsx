"use client";

// Avertissement avant publication : ce devoir / contrôle / projet final a peut-être déjà été mis en
// ligne pour ce cours. La personne vérifie la liste et confirme, ou annule.
import { useRef } from "react";
import { DUE_KIND_LABEL, findDuplicates, type DueItem } from "@/lib/duplicates";
import { labelDate } from "@/lib/calendar-view";

export function DuplicateWarning({
  matches,
  what,
  onConfirm,
  onCancel,
}: {
  matches: DueItem[];
  /** « ce devoir », « ce contrôle »… */
  what: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (matches.length === 0) return null;
  const day = labelDate(matches[0].date, { weekday: "long", day: "numeric", month: "long" });
  return (
    <div role="alertdialog" aria-labelledby="dup-title" aria-describedby="dup-desc" className="flex flex-col gap-3 rounded-lg border border-[#d97706]/60 bg-[#d97706]/10 p-4">
      <div>
        <p id="dup-title" className="text-sm font-semibold text-ink">
          ⚠️ Déjà en ligne ?
        </p>
        <p id="dup-desc" className="mt-1 text-sm text-ink-2">
          Pour cette matière, {day}, il y a déjà {matches.length > 1 ? "ces éléments" : "cet élément"}. Vérifiez que {what}{" "}
          n&apos;a pas déjà été mis en ligne avant de publier.
        </p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {matches.map((m) => (
          <li key={`${m.kind}-${m.id}`} className="rounded-md border border-line bg-surface px-3 py-2 text-sm">
            <span className="mr-2 rounded bg-sunken px-1.5 py-0.5 text-[11px] font-semibold uppercase text-ink-2">{DUE_KIND_LABEL[m.kind]}</span>
            <span className="font-medium text-ink">{m.subjectName}</span>
            {m.title && <span className="block truncate text-ink-2">{m.title}</span>}
            {m.authorName && <span className="block text-xs text-ink-3">Ajouté par {m.authorName}</span>}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onConfirm} className="btn btn-primary h-9">
          Ce n&apos;est pas la même chose : publier
        </button>
        <button type="button" onClick={onCancel} className="btn h-9">
          C&apos;est un doublon : annuler
        </button>
      </div>
    </div>
  );
}

/**
 * Logique commune aux formulaires : `check` à appeler dans onSubmit (renvoie true s'il faut
 * s'arrêter pour demander confirmation) ; `confirm` relance l'envoi sans revérifier.
 */
export function useDuplicateGuard(existing: DueItem[]) {
  const skipNext = useRef(false);
  return {
    check(draft: { subjectId: string; subjectName: string; date: string }, show: (m: DueItem[]) => void): boolean {
      if (skipNext.current) {
        skipNext.current = false;
        return false;
      }
      const matches = findDuplicates(draft, existing);
      show(matches);
      return matches.length > 0;
    },
    confirm(form: HTMLFormElement | null) {
      skipNext.current = true;
      form?.requestSubmit();
    },
  };
}
