"use client";

// Pièces jointes d'un contrôle ou d'un devoir : téléchargement, ajout (tout membre), retrait (auteur
// de la pièce jointe ou admin).
import { useRef, useState, useTransition } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { IconClose, IconDownload } from "@/components/layout/Icons";
import {
  addAttachments,
  deleteAttachment,
  MAX_FILES,
  pickedFiles,
  validateFiles,
  type Attachment,
  type AttachmentTarget,
} from "@/lib/api/attachments";
import { signedFileUrl } from "@/lib/api/files";
import { formatSize, UPLOAD_ACCEPT } from "@/lib/labels";

export function AttachmentList({
  target,
  parentId,
  attachments,
  addLabel,
  onChanged,
}: {
  target: AttachmentTarget;
  parentId: string;
  attachments: Attachment[];
  /** Nom accessible du bouton d'ajout (« Ajouter des pièces jointes au devoir de Maths »). */
  addLabel: string;
  onChanged: () => void;
}) {
  const { session, profile } = useAuth();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uid = session?.user.id;
  const full = attachments.length >= MAX_FILES;

  const run = (job: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await job();
      if (res.error) setError(res.error);
      else onChanged();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Pièces jointes">
          {attachments.map((a) => (
            <li key={a.id} className="inline-flex max-w-full items-center overflow-hidden rounded-md border border-line bg-sunken text-xs">
              <a
                href="#"
                onClick={async (e) => {
                  e.preventDefault();
                  window.location.href = await signedFileUrl(a.path, { download: a.name });
                }}
                className="inline-flex min-w-0 items-center gap-1.5 px-2.5 py-1 font-medium text-ink hover:bg-surface"
              >
                <IconDownload size={14} className="shrink-0" />
                <span className="max-w-[16rem] truncate">{a.name}</span>
                <span className="shrink-0 text-ink-3">({formatSize(a.size)})</span>
              </a>
              {(profile?.role === "admin" || a.authorId === uid) && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => deleteAttachment(target, a.id))}
                  aria-label={`Retirer ${a.name}`}
                  title="Retirer la pièce jointe"
                  className="border-l border-line px-1.5 py-1 text-ink-3 hover:bg-surface hover:text-danger"
                >
                  <IconClose size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={UPLOAD_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length) run(() => addAttachments(target, parentId, files, attachments.length));
            }}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
            aria-label={addLabel}
            className="btn btn-ghost h-7 px-2 text-xs"
          >
            {pending ? "Envoi…" : "+ Ajouter des pièces jointes"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Champ « Pièces jointes » d'un formulaire d'ajout (plusieurs fichiers), avec contrôle immédiat. */
export function AttachmentField({
  hint,
  onError,
}: {
  hint?: string;
  /** Erreur de sélection (trop de fichiers, fichier trop lourd) ou null. */
  onError: (error: string | null) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="label">
        <span>
          Pièces jointes <span className="font-normal text-ink-3">({hint ?? "facultatif"} · {MAX_FILES} fichiers, 30 Mo chacun)</span>
        </span>
        <input
          type="file"
          name="attachments"
          multiple
          accept={UPLOAD_ACCEPT}
          onChange={(e) => {
            const files = pickedFiles([...(e.target.files ?? [])]);
            const err = validateFiles(files);
            setPicked(files.map((f) => `${f.name} (${formatSize(f.size)})`));
            setError(err);
            onError(err);
          }}
          className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-sunken file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-line"
        />
      </label>
      {picked.length > 1 && <p className="text-xs text-ink-3">{picked.join(" · ")}</p>}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
