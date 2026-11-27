"use client";

import { useRef } from "react";

/** Bouton « Supprimer » avec boîte de confirmation ; `action` est une server action (FormData : id). */
export function DeleteDocumentButton({ id, action }: { id: string; action: (fd: FormData) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" data-write className="btn shrink-0 text-danger" onClick={() => dialog.current?.showModal()}>
        Supprimer
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`del-${id}`}
        className="m-auto w-[min(92vw,26rem)] rounded-lg border border-line-strong bg-surface p-5 text-ink backdrop:bg-black/40"
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={id} />
          <h2 id={`del-${id}`} className="text-base font-semibold">
            Supprimer définitivement ce document ?
          </h2>
          <p className="text-sm text-ink-2">Le fichier, ses exercices et la progression associée seront effacés. Cette action est irréversible.</p>
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
