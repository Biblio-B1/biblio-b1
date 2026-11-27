"use client";

// Case « Fait » d'un devoir, propre à l'élève connecté (onglet Devoirs, emploi du temps, accueil).
// Mise à jour immédiate à l'écran ; en cas d'échec, l'état revient en arrière.
import { useEffect, useState, useTransition } from "react";
import { setHomeworkDone } from "@/lib/api/homeworks";

/** Prévient les autres vues de la page (accueil, emploi du temps) qu'un devoir a changé. */
export const HOMEWORK_DONE_EVENT = "bb1-homework-done";

export function HomeworkDoneToggle({
  id,
  done,
  label,
  size = "md",
  onChange,
}: {
  id: string;
  done: boolean;
  /** Ce que la case coche, pour les lecteurs d'écran (« Devoir de Maths du 2 décembre »). */
  label: string;
  size?: "sm" | "md";
  onChange?: (done: boolean) => void;
}) {
  const [value, setValue] = useState(done);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => setValue(done), [done]);

  const toggle = () => {
    const next = !value;
    setValue(next);
    setError(false);
    startTransition(async () => {
      const res = await setHomeworkDone(id, next);
      if (res.error) {
        setValue(!next);
        setError(true);
        return;
      }
      onChange?.(next);
      window.dispatchEvent(new CustomEvent(HOMEWORK_DONE_EVENT, { detail: { id, done: next } }));
    });
  };

  const small = size === "sm";
  return (
    <button
      type="button"
      data-write
      role="checkbox"
      aria-checked={value}
      aria-label={`${label} : ${value ? "fait" : "à faire"}`}
      title={error ? "Enregistrement impossible, réessayez." : value ? "Marquer comme à faire" : "Marquer comme fait"}
      disabled={pending}
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border font-medium transition-colors disabled:opacity-60 ${
        small ? "h-6 px-1.5 text-[11px]" : "h-8 px-2.5 text-xs"
      } ${
        value
          ? "border-ok/40 bg-ok/15 text-ok"
          : error
            ? "border-danger/50 text-danger"
            : "border-line-strong bg-surface text-ink-2 hover:border-ink hover:text-ink"
      }`}
    >
      <span
        aria-hidden
        className={`grid place-items-center rounded-[4px] border ${small ? "h-3 w-3" : "h-3.5 w-3.5"} ${
          value ? "border-ok bg-ok text-surface" : "border-current"
        }`}
      >
        {value && (
          <svg viewBox="0 0 12 12" className={small ? "h-2 w-2" : "h-2.5 w-2.5"} fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="m2.5 6.2 2.3 2.3 4.7-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {value ? "Fait" : "À faire"}
    </button>
  );
}
