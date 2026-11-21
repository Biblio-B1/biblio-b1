"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { IconDownload } from "@/components/layout/Icons";
import { Spine } from "@/components/layout/Spine";
import { DeleteDocumentButton } from "@/components/library/DeleteDocumentButton";
import { CodeView } from "@/components/viewers/CodeView";
import { ImageGallery } from "@/components/viewers/ImageGallery";
import { MarkdownView } from "@/components/viewers/MarkdownView";
import { PdfViewer } from "@/components/viewers/PdfViewer";
import { signedFileUrl, useSignedUrl } from "@/lib/api/files";
import {
  canDeleteDocument,
  deleteDocument,
  getDocument,
  getProfileName,
  listSiblingImages,
  listSubjects,
  setDocumentSubject,
} from "@/lib/api/library";
import type { Document } from "@/lib/api/types";
import { useData } from "@/lib/api/use-data";
import { DOC_TYPE_LABELS, formatDate } from "@/lib/labels";

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const CODE_LANG: Record<string, string> = { ".c": "c", ".h": "c", ".py": "python", ".txt": "text" };

const extOf = (p: string) => (/\.[^./]+$/.exec(p)?.[0] ?? "").toLowerCase();
const fileNameOf = (doc: Document) => {
  const ext = extOf(doc.filePath);
  const base = doc.title.endsWith(ext) ? doc.title.slice(0, -ext.length) : doc.title;
  return `${(base || "fichier").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 150)}${ext}`;
};

/** Texte du document : extrait à l'import, sinon lu depuis le fichier (petits fichiers seulement). */
async function readText(doc: Document): Promise<string | null> {
  if (doc.text) return doc.text;
  try {
    const res = await fetch(await signedFileUrl(doc.filePath));
    if (!res.ok || Number(res.headers.get("content-length") ?? 0) > MAX_TEXT_BYTES) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function DownloadButton({ doc, className, children }: { doc: Document; className: string; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      aria-label="Télécharger"
      onClick={async () => {
        setBusy(true);
        try {
          window.location.href = await signedFileUrl(doc.filePath, { download: fileNameOf(doc) });
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </button>
  );
}

function DownloadCard({ doc, note }: { doc: Document; note: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-line bg-surface p-5">
      <p className="text-ink-2">{note}</p>
      <DownloadButton doc={doc} className="btn btn-primary">
        <IconDownload size={16} /> Télécharger
      </DownloadButton>
    </div>
  );
}

function Viewer({ doc }: { doc: Document }) {
  const ext = extOf(doc.filePath);
  const isText = doc.mime === "text/markdown" || ext in CODE_LANG;
  const pdfUrl = useSignedUrl(doc.mime === "application/pdf" ? doc.filePath : null);
  const text = useData(() => (isText ? readText(doc) : Promise.resolve(null)), [doc.id, isText]);
  const images = useData(async () => {
    if (!doc.mime.startsWith("image/")) return null;
    const siblings = await listSiblingImages(doc);
    const list = siblings.some((s) => s.id === doc.id) ? siblings : [doc, ...siblings];
    return Promise.all(list.map(async (s) => ({ id: s.id, title: s.title, src: await signedFileUrl(s.filePath).catch(() => "") })));
  }, [doc.id]);

  if (doc.mime === "application/pdf") {
    if (pdfUrl === null) return <div className="h-[60vh] animate-pulse rounded-lg border border-line bg-sunken" />;
    return pdfUrl ? <PdfViewer url={pdfUrl} /> : <DownloadCard doc={doc} note="Le fichier est indisponible pour le moment." />;
  }
  if (doc.mime.startsWith("image/")) {
    if (!images.data) return <div className="h-[50vh] animate-pulse rounded-lg border border-line bg-sunken" />;
    return <ImageGallery images={images.data} initialId={doc.id} />;
  }
  if (isText) {
    if (text.loading) return <div className="h-40 animate-pulse rounded-lg border border-line bg-sunken" />;
    if (text.data === null) return <DownloadCard doc={doc} note="Fichier trop volumineux pour l'aperçu." />;
    if (doc.mime === "text/markdown") {
      return (
        <article className="rounded-lg border border-line bg-surface px-5 py-6 md:px-10 md:py-8">
          <MarkdownView source={text.data} />
        </article>
      );
    }
    return <CodeView code={text.data} lang={CODE_LANG[ext]} />;
  }
  if (doc.mime === DOCX) {
    const paras = doc.text
      .split(/\n{2,}|\r?\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!paras.length) return <DownloadCard doc={doc} note="Aucun texte lisible dans ce document Word." />;
    return (
      <article className="flex flex-col gap-4 rounded-lg border border-line bg-surface px-5 py-6 md:px-10 md:py-8">
        <p className="text-[13px] text-ink-3">Texte extrait du document Word (mise en forme non conservée).</p>
        <div className="prose-bb">
          {paras.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </article>
    );
  }
  if (doc.mime === PPTX) {
    return <DownloadCard doc={doc} note="Les présentations PowerPoint ne sont pas prévisualisées. Téléchargez le fichier pour l'ouvrir." />;
  }
  return <DownloadCard doc={doc} note="Aperçu indisponible pour ce format." />;
}

function DocView() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const { profile } = useAuth();
  const { data, error, reload } = useData(async () => {
    const [doc, subjects] = await Promise.all([getDocument(id), listSubjects()]);
    const author = doc?.authorId ? await getProfileName(doc.authorId) : null;
    return { doc, subjects, author };
  }, [id]);

  if (error) return <p role="alert" className="text-danger">{error}</p>;
  if (!data) return <p className="text-sm text-ink-3">Chargement…</p>;
  const { doc, subjects, author } = data;
  if (!doc) return <p className="text-ink-2">Document introuvable.</p>;

  const subject = subjects.find((s) => s.id === doc.subjectId);
  const canDelete = profile ? canDeleteDocument(doc, profile) : false;
  const needsReview = !doc.subjectConfirmed || !doc.subjectId;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <Spine color={subject?.color ?? null} className="mt-1.5 h-7" />
          <div className="min-w-0 flex-1">
            <h1 className="page-title break-words">{doc.title}</h1>
            <p className="mt-1 text-[14px] text-ink-2">
              {DOC_TYPE_LABELS[doc.type]}, {subject?.name ?? "sans matière"}
              {author ? `, déposé par ${author}` : doc.source !== "upload" ? ", importé" : ""} le {formatDate(doc.createdAt)}
            </p>
          </div>
          <DownloadButton doc={doc} className="btn btn-icon shrink-0 sm:w-auto sm:px-3">
            <IconDownload size={16} />
            <span className="hidden sm:inline">Télécharger</span>
          </DownloadButton>
          {canDelete && (
            <DeleteDocumentButton
              id={doc.id}
              action={async () => {
                await deleteDocument(doc);
                router.replace("/library");
              }}
            />
          )}
        </div>

        <form
          action={async (fd) => {
            await setDocumentSubject(doc.id, String(fd.get("subjectId") ?? "") || null);
            reload();
          }}
          className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[14px] ${
            needsReview ? "border-line-strong bg-surface" : "border-transparent px-0 py-0"
          }`}
        >
          <label htmlFor="subjectId" className="text-ink-2">
            {needsReview ? (doc.subjectId ? "Matière proposée :" : "Choisir une matière :") : "Matière :"}
          </label>
          <select id="subjectId" name="subjectId" defaultValue={doc.subjectId ?? ""} className="input h-8 w-auto min-w-0 flex-1 text-[14px] sm:flex-none">
            <option value="">Sans matière</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button className={`btn h-8 ${needsReview ? "btn-primary" : ""}`}>{needsReview ? "Confirmer" : "Changer"}</button>
        </form>
      </header>

      <Viewer doc={doc} />
    </div>
  );
}

export default function DocPage() {
  return (
    <Suspense fallback={null}>
      <DocView />
    </Suspense>
  );
}
