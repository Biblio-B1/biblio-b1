"use client";

import { useState } from "react";

/** Contenu replié par défaut ; libellés d'ouverture/fermeture fournis par l'appelant. */
export function Reveal({ showLabel, hideLabel, children }: { showLabel: string; hideLabel: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="flex flex-col gap-3">
      <button type="button" className="btn self-start" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? hideLabel : showLabel}
      </button>
      {open && <div className="rounded-lg border border-line bg-surface px-5 py-4">{children}</div>}
    </section>
  );
}
