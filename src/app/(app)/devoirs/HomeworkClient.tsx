"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FormState } from "@/components/ActionForm";
import { Spine } from "@/components/layout/Spine";
import { IconDownload, IconHomework } from "@/components/layout/Icons";
import { labelDate, todayKeyInParis } from "@/lib/calendar-view";
import { UPLOAD_ACCEPT, fileUrl, formatSize } from "@/lib/labels";
import type { HomeworkRow } from "@/server/homeworks";
import { createHomeworkAction, deleteHomeworkAction } from "./actions";

const MAX_ATTACHMENT_MB = 30;
const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024;

type SubjectOpt = { id: string; name: string; slug: string; color: string };

function isEnglish(subject?: SubjectOpt): boolean {
  if (!subject) return false;
  const n = subject.name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const s = subject.slug.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return n.includes("anglais") || n.includes("english") || s.includes("anglais") || s.includes("english");
}

function formatDueDate(dueDate: string): string {
  return labelDate(dueDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function HomeworkItem({ hw, onDeleted }: { hw: HomeworkRow; onDeleted: () => void }) {
  const [pending, startTransition] = useTransition();
  const [delError, setDelError] = useState<string | null>(null);

  return (
    <li
      className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4"
      style={{ boxShadow: `inset 4px 0 0 ${hw.subjectColor}` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 pl-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink">{hw.subjectName}</span>
          {hw.englishGroup && (
            <span className="rounded-full border border-focus/30 bg-focus/10 px-2.5 py-0.5 text-xs font-medium text-ink">
              Groupe : {hw.englishGroup}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <time dateTime={hw.dueDate} className="text-xs font-medium capitalize text-ink-2">
            Pour le {formatDueDate(hw.dueDate)}
          </time>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setDelError(null);
              startTransition(async () => {
                const res = await deleteHomeworkAction(hw.id);
                if (res.error) setDelError(res.error);
                else onDeleted();
              });
            }}
            className="btn btn-ghost h-7 px-2 text-xs text-danger"
          >
            {pending ? "…" : "Supprimer"}
          </button>
        </div>
      </div>

      <p className="pl-1.5 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{hw.title}</p>

      <div className="flex flex-wrap items-center justify-between gap-2 pl-1.5 text-xs text-ink-3">
        <div>
          {hw.attachmentPath && hw.attachmentName && (
            <a
              href={fileUrl(hw.attachmentPath, true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-sunken px-2.5 py-1 text-xs font-medium text-ink hover:border-line-strong"
            >
              <IconDownload size={14} />
              <span className="max-w-[18rem] truncate">{hw.attachmentName}</span>
              {hw.attachmentSize != null && (
                <span className="text-ink-3">({formatSize(hw.attachmentSize)})</span>
              )}
            </a>
          )}
        </div>
        <span>Ajouté par {hw.authorName ?? "un élève"}</span>
      </div>
      {delError && (
        <p role="alert" className="pl-1.5 text-xs text-danger">
          {delError}
        </p>
      )}
    </li>
  );
}

export function HomeworkClient({
  subjects,
  homeworks,
}: {
  subjects: SubjectOpt[];
  homeworks: HomeworkRow[];
}) {
  const router = useRouter();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [dueDate, setDueDate] = useState("");
  const [title, setTitle] = useState("");
  const [englishGroup, setEnglishGroup] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedSubject = subjects.find((s) => s.id === subjectId);
  const englishSelected = isEnglish(selectedSubject);

  const [state, formAction, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    setFileError(null);
    const file = fileRef.current?.files?.[0];
    if (file && file.size > MAX_ATTACHMENT_BYTES) {
      return { error: `La pièce jointe dépasse la limite de ${MAX_ATTACHMENT_MB} Mo.` };
    }
    const res = await createHomeworkAction(prev, fd);
    if (!res?.error) {
      setTitle("");
      setEnglishGroup("");
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    }
    return res;
  }, null);

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [router]);

  const today = todayKeyInParis();
  const upcoming = homeworks.filter((h) => h.dueDate >= today);
  const past = homeworks.filter((h) => h.dueDate < today);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="new-homework" className="rounded-lg border border-line bg-surface p-5">
        <div className="mb-4 flex items-center gap-2">
          <IconHomework size={18} className="text-ink-2" />
          <h2 id="new-homework" className="text-base font-semibold">
            Ajouter un devoir
          </h2>
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="label">
              Matière
              <div className="flex items-center gap-2">
                <Spine color={selectedSubject?.color ?? null} className="h-6" />
                <select
                  name="subjectId"
                  required
                  value={subjectId}
                  onChange={(e) => {
                    setSubjectId(e.target.value);
                    setEnglishGroup("");
                  }}
                  className="input flex-1"
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </label>

            <label className="label">
              Date de rendu
              <input
                type="date"
                name="dueDate"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="input"
              />
            </label>
          </div>

          {englishSelected && (
            <div className="flex flex-col gap-3 rounded-lg border border-focus/40 bg-focus/10 p-3.5">
              <p role="status" className="text-sm font-medium text-ink">
                Attention : il y a plusieurs groupes en anglais. Merci de préciser ci-dessous quel groupe est concerné par ce devoir.
              </p>
              <label className="label text-ink">
                Groupe d&apos;anglais concerné *
                <input
                  type="text"
                  name="englishGroup"
                  required
                  maxLength={120}
                  value={englishGroup}
                  onChange={(e) => setEnglishGroup(e.target.value)}
                  placeholder="Ex : Anglais intermédiaire Gr1, Anglais avancé Gr2…"
                  className="input"
                />
              </label>
            </div>
          )}

          <label className="label">
            Devoir à faire / Consignes
            <textarea
              name="title"
              required
              rows={3}
              maxLength={2000}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex : Terminer les exercices 1 à 3 du TD sur les requêtes SQL…"
              className="input h-auto resize-y py-2"
            />
          </label>

          <label className="label">
            <span>
              Pièce jointe <span className="font-normal text-ink-3">(optionnel, {MAX_ATTACHMENT_MB} Mo maximum)</span>
            </span>
            <input
              ref={fileRef}
              type="file"
              name="attachment"
              accept={UPLOAD_ACCEPT}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && file.size > MAX_ATTACHMENT_BYTES) {
                  setFileError(`La pièce jointe dépasse la limite de ${MAX_ATTACHMENT_MB} Mo.`);
                  e.target.value = "";
                } else {
                  setFileError(null);
                }
              }}
              className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-sunken file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-line"
            />
          </label>

          {(fileError || state?.error) && (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg p-2.5 text-sm text-danger">
              {fileError ?? state?.error}
            </p>
          )}
          {state?.message && (
            <p role="status" className="text-sm text-ok">
              {state.message}
            </p>
          )}

          <div className="flex justify-end">
            <button type="submit" disabled={pending || subjects.length === 0} className="btn btn-primary h-10 px-5">
              {pending ? "Enregistrement…" : "Publier le devoir"}
            </button>
          </div>
        </form>
      </section>

      <section aria-labelledby="upcoming-homeworks" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="upcoming-homeworks" className="text-[15px] font-semibold">
            Devoirs à venir ({upcoming.length})
          </h2>
          <span className="text-xs text-ink-3">Synchronisé pour toute la classe · maj auto 30 s</span>
        </div>
        {upcoming.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-2">
            Aucun devoir à venir pour le moment. Utilisez le formulaire ci-dessus pour en ajouter un.
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {upcoming.map((hw) => (
              <HomeworkItem key={hw.id} hw={hw} onDeleted={() => router.refresh()} />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section aria-labelledby="past-homeworks" className="flex flex-col gap-3">
          <h2 id="past-homeworks" className="text-[15px] font-semibold text-ink-2">
            Devoirs passés ({past.length})
          </h2>
          <ul className="flex flex-col gap-2.5 opacity-80">
            {past.map((hw) => (
              <HomeworkItem key={hw.id} hw={hw} onDeleted={() => router.refresh()} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
