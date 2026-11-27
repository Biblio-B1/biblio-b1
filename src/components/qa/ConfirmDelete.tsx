"use client";

import { useRef } from "react";

/** Bouton « Supprimer » avec boîte de confirmation ; `action` est une server action (FormData : id, revalidate). */
export function ConfirmDelete({
  id,
  revalidate,
  action,
  title,
  detail,
  label = "Supprimer",
}: {
  id: string;
  revalidate: string;
  action: (fd: FormData) => Promise<void>;
  title: string;
  detail: string;
  label?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" data-write className="btn btn-ghost h-8 px-2 text-[13px] text-danger" onClick={() => dialog.current?.showModal()}>
        {label}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`qdel-${id}`}
        className="m-auto w-[min(92vw,26rem)] rounded-lg border border-line-strong bg-surface p-5 text-ink backdrop:bg-black/40"
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="revalidate" value={revalidate} />
          <h2 id={`qdel-${id}`} className="text-base font-semibold">
            {title}
          </h2>
          <p className="text-sm text-ink-2">{detail}</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => dialog.current?.close()}>
              Annuler
            </button>
            <button type="submit" className="btn border-transparent bg-danger text-white hover:opacity-90">
              Supprimer
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
