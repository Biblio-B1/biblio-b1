"use client";

import { useState, useTransition } from "react";
import { setStatusAction } from "@/lib/api/training";
import { PROGRESS_STATUS_LABELS, PROGRESS_STATUS_VALUES, type ProgressStatusValue } from "@/lib/labels";

/** Trois boutons exclusifs ; mise à jour optimiste, retour arrière en cas d'erreur. */
export function StatusPicker({ exerciseId, status }: { exerciseId: string; status: ProgressStatusValue }) {
  const [current, setCurrent] = useState(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function choose(next: ProgressStatusValue) {
    if (next === current) return;
    const prev = current;
    setCurrent(next);
    setError(null);
    start(async () => {
      const r = await setStatusAction(exerciseId, next);
      if (r.error) {
        setCurrent(prev);
        setError(r.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div role="group" aria-label="Statut" aria-busy={pending} className="flex gap-1">
        {PROGRESS_STATUS_VALUES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={current === s}
            onClick={() => choose(s)}
            className={`h-8 rounded-full border px-3 text-[13.5px] transition-colors ${
              current === s ? "border-ink bg-ink text-bg" : "border-line text-ink-2 hover:border-line-strong hover:text-ink"
            }`}
          >
            {PROGRESS_STATUS_LABELS[s]}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
