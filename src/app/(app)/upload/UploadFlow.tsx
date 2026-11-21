"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { IconCamera, IconClose, IconUpload } from "@/components/layout/Icons";
import { DOC_TYPE_LABELS, DOC_TYPE_VALUES, MAX_UPLOAD_MB, UPLOAD_ACCEPT, formatSize, type DocTypeValue } from "@/lib/labels";
import { confirmUploads, uploadFiles, type UploadDraft } from "@/lib/api/uploads";
import { docHref } from "@/lib/routes";

type SubjectOpt = { id: string; name: string; color: string };
type Row = UploadDraft & { subjectId: string; type: DocTypeValue; titleValue: string; error?: string };

const GENERIC_PHOTO = /^(img|image|photo|pxl|dsc|capture)[\W_]*[\d_ -]*$/i;
const today = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" });

function initialTitle(d: UploadDraft): string {
  if (d.suggestedType === "photo" && GENERIC_PHOTO.test(d.title)) return `Photo du tableau, ${today.format(new Date())}`;
  return d.title;
}

export function UploadFlow({ subjects }: { subjects: SubjectOpt[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [errors, setErrors] = useState<{ fileName: string; error: string }[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [created, setCreated] = useState<{ id: string; title: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const subjectById = new Map(subjects.map((s) => [s.id, s]));

  async function send(list: FileList | File[]) {
    const files = Array.from(list);
    if (!files.length) return;
    setErrors([]);
    setCreated([]);
    setProgress({ done: 0, total: files.length });
    // Un fichier par appel : reste sous la limite de corps des server actions.
    for (const [i, file] of files.entries()) {
      if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
        setErrors((e) => [...e, { fileName: file.name, error: `Fichier trop volumineux (${MAX_UPLOAD_MB} Mo maximum)` }]);
      } else {
        const fd = new FormData();
        fd.append("files", file);
        try {
          const res = await uploadFiles(fd);
          setErrors((e) => [...e, ...res.errors]);
          setRows((r) => [
            ...r,
            ...res.drafts.map((d) => ({
              ...d,
              subjectId: d.suggestedSubjectId ?? "",
              type: d.suggestedType,
              titleValue: initialTitle(d),
            })),
          ]);
        } catch {
          setErrors((e) => [...e, { fileName: file.name, error: "Envoi interrompu. Vérifiez la connexion puis réessayez." }]);
        }
      }
      setProgress({ done: i + 1, total: files.length });
    }
    setProgress(null);
  }

  function update(tmpId: string, patch: Partial<Row>) {
    setRows((r) => r.map((row) => (row.tmpId === tmpId ? { ...row, ...patch, error: undefined } : row)));
  }

  async function confirmAll() {
    setConfirming(true);
    try {
      const res = await confirmUploads(
        rows.map((r) => ({ tmpId: r.tmpId, subjectId: r.subjectId || null, title: r.titleValue, type: r.type })),
      );
      const failed = new Map(res.errors.map((e) => [e.tmpId, e.error]));
      if (res.created.length === 1 && failed.size === 0) {
        router.push(docHref(res.created[0].id));
        return;
      }
      setCreated((c) => [...c, ...res.created]);
      if (res.errors.some((e) => !e.tmpId)) setErrors((e) => [...e, ...res.errors.map((x) => ({ fileName: "", error: x.error }))]);
      setRows((r) => r.filter((row) => failed.has(row.tmpId)).map((row) => ({ ...row, error: failed.get(row.tmpId) })));
      router.refresh();
    } finally {
      setConfirming(false);
    }
  }

  const busy = progress !== null || confirming;

  return (
    <div className="flex flex-col gap-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) send(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center gap-4 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors ${
          dragging ? "border-focus bg-sunken" : "border-line-strong bg-surface"
        }`}
      >
        <p className="text-[15px] text-ink-2">
          <span className="hidden sm:inline">Glissez vos fichiers ici, ou </span>
          <span className="sm:hidden">Choisissez des fichiers ou </span>
          <span className="sm:hidden">photographiez le tableau.</span>
          <span className="hidden sm:inline">choisissez-les sur l&apos;ordinateur.</span>
        </p>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button
            type="button"
            id="photo"
            onClick={() => cameraInput.current?.click()}
            disabled={busy}
            className="btn btn-primary h-12 text-[15px] sm:order-2 sm:h-9 sm:text-sm"
          >
            <IconCamera size={18} /> Prendre une photo
          </button>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className="btn h-12 text-[15px] sm:order-1 sm:h-9 sm:text-sm"
          >
            <IconUpload size={18} /> Choisir des fichiers
          </button>
        </div>
        <p className="text-[13px] text-ink-3">
          PDF, Markdown, C, Python, texte, images, Word, PowerPoint. {MAX_UPLOAD_MB} Mo maximum par fichier.
        </p>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={UPLOAD_ACCEPT}
          hidden
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files) send(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files) send(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {progress && (
        <p role="status" className="text-[14px] text-ink-2">
          Envoi {Math.min(progress.done + 1, progress.total)} sur {progress.total}…
        </p>
      )}

      {errors.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 rounded-lg border border-danger/30 bg-danger-bg p-3 text-[14px] text-danger">
          {errors.map((e, i) => (
            <li key={i}>
              {e.fileName && <strong className="font-medium">{e.fileName} : </strong>}
              {e.error}
            </li>
          ))}
        </ul>
      )}

      {created.length > 0 && (
        <section role="status" className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
          <p className="font-medium text-ok">
            {created.length} document{created.length > 1 ? "s ajoutés" : " ajouté"} à la bibliothèque
          </p>
          <ul className="flex flex-col gap-1 text-[14px]">
            {created.map((c) => (
              <li key={c.id}>
                <Link href={docHref(c.id)} className="underline underline-offset-2">
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rows.length > 0 && (
        <section aria-labelledby="review-title" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="review-title" className="text-[15px] font-semibold">
              Vérifier avant d&apos;ajouter
            </h2>
            <button type="button" onClick={confirmAll} disabled={busy} className="btn btn-primary">
              {confirming ? "Ajout…" : rows.length > 1 ? `Tout ajouter (${rows.length})` : "Ajouter à la bibliothèque"}
            </button>
          </div>
          <ul className="flex flex-col gap-2">
            {rows.map((r) => {
              const s = subjectById.get(r.subjectId);
              return (
                <li
                  key={r.tmpId}
                  className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3"
                  style={{ boxShadow: `inset 4px 0 0 ${s?.color ?? "var(--line-strong)"}` }}
                >
                  <div className="flex items-start gap-2 pl-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[13px] text-ink-2" title={r.fileName}>
                        {r.fileName}
                      </p>
                      <p className="text-[12.5px] text-ink-3">
                        {formatSize(r.size)}
                        {r.suggestedSubjectId
                          ? r.subjectId === r.suggestedSubjectId
                            ? ", matière proposée d'après le nom"
                            : ""
                          : ", aucune matière reconnue"}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon -mt-1 -mr-1 h-8 w-8"
                      aria-label={`Retirer ${r.fileName}`}
                      onClick={() => setRows((rs) => rs.filter((x) => x.tmpId !== r.tmpId))}
                    >
                      <IconClose size={16} />
                    </button>
                  </div>
                  <div className="grid gap-2 pl-2 sm:grid-cols-[1fr_12rem_10rem]">
                    <label className="label">
                      <span className="sr-only sm:not-sr-only sm:text-[12.5px]">Titre</span>
                      <input
                        className="input h-9"
                        value={r.titleValue}
                        maxLength={300}
                        aria-label="Titre"
                        onChange={(e) => update(r.tmpId, { titleValue: e.target.value })}
                      />
                    </label>
                    <label className="label">
                      <span className="sr-only sm:not-sr-only sm:text-[12.5px]">Matière</span>
                      <select
                        className="input h-9"
                        value={r.subjectId}
                        aria-label="Matière"
                        onChange={(e) => update(r.tmpId, { subjectId: e.target.value })}
                      >
                        <option value="">Sans matière</option>
                        {subjects.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="label">
                      <span className="sr-only sm:not-sr-only sm:text-[12.5px]">Type</span>
                      <select
                        className="input h-9"
                        value={r.type}
                        aria-label="Type"
                        onChange={(e) => update(r.tmpId, { type: e.target.value as DocTypeValue })}
                      >
                        {DOC_TYPE_VALUES.map((t) => (
                          <option key={t} value={t}>
                            {DOC_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {r.duplicateOfId && (
                    <p className="pl-2 text-[13.5px] text-danger">
                      Ce fichier est déjà dans la bibliothèque :{" "}
                      <Link href={docHref(r.duplicateOfId)} className="underline underline-offset-2">
                        voir le document
                      </Link>
                      . Retirez-le de la liste.
                    </p>
                  )}
                  {r.error && <p className="pl-2 text-[13.5px] text-danger">{r.error}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
