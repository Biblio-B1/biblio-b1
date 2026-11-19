import fs from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, like } from "drizzle-orm";
import { notFound } from "next/navigation";
import { IconDownload } from "@/components/layout/Icons";
import { Spine } from "@/components/layout/Spine";
import { CodeView } from "@/components/viewers/CodeView";
import { ImageGallery } from "@/components/viewers/ImageGallery";
import { MarkdownView } from "@/components/viewers/MarkdownView";
import { PdfViewer } from "@/components/viewers/PdfViewer";
import { DOC_TYPE_LABELS, fileUrl, formatDate } from "@/lib/labels";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { documents, users } from "@/server/db/schema";
import { getDocument, type Document } from "@/server/documents";
import { resolveStoragePath } from "@/server/storage";
import { listSubjects } from "@/server/subjects";
import { setSubjectAction } from "../actions";

type Params = Promise<{ id: string }>;

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const CODE_LANG: Record<string, string> = { ".c": "c", ".h": "c", ".py": "python", ".txt": "text" };

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

export async function generateMetadata({ params }: { params: Params }) {
  await requireUser();
  const { id } = await params;
  return { title: (isUuid(id) && getDocument(getDb(), id)?.title) || "Document" };
}

async function readText(doc: Document): Promise<string | null> {
  try {
    const abs = resolveStoragePath(doc.filePath);
    const stat = await fs.stat(abs);
    if (stat.size > MAX_TEXT_BYTES) return null;
    return await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }
}

async function docxParagraphs(doc: Document): Promise<string[] | null> {
  try {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ path: resolveStoragePath(doc.filePath) });
    return value
      .split(/\n{2,}|\r?\n/)
      .map((p) => p.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

function DownloadCard({ doc, note }: { doc: Document; note: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-line bg-surface p-5">
      <p className="text-ink-2">{note}</p>
      <a href={fileUrl(doc.filePath, true)} className="btn btn-primary">
        <IconDownload size={16} /> Télécharger
      </a>
    </div>
  );
}

async function Viewer({ doc }: { doc: Document }) {
  const ext = path.extname(doc.filePath).toLowerCase();
  if (doc.mime === "application/pdf") return <PdfViewer url={fileUrl(doc.filePath)} />;
  if (doc.mime.startsWith("image/")) {
    const siblings = getDb()
      .select({ id: documents.id, title: documents.title, filePath: documents.filePath })
      .from(documents)
      .where(
        and(
          doc.subjectId ? eq(documents.subjectId, doc.subjectId) : eq(documents.id, doc.id),
          like(documents.mime, "image/%"),
        ),
      )
      .orderBy(desc(documents.createdAt))
      .limit(50)
      .all();
    const list = siblings.some((s) => s.id === doc.id) ? siblings : [doc, ...siblings];
    return <ImageGallery images={list.map((s) => ({ id: s.id, title: s.title, src: fileUrl(s.filePath) }))} initialId={doc.id} />;
  }
  if (doc.mime === "text/markdown") {
    const text = await readText(doc);
    if (text === null) return <DownloadCard doc={doc} note="Fichier trop volumineux pour l'aperçu." />;
    return (
      <article className="rounded-lg border border-line bg-surface px-5 py-6 md:px-10 md:py-8">
        <MarkdownView source={text} />
      </article>
    );
  }
  if (ext in CODE_LANG) {
    const text = await readText(doc);
    if (text === null) return <DownloadCard doc={doc} note="Fichier trop volumineux pour l'aperçu." />;
    return <CodeView code={text} lang={CODE_LANG[ext]} />;
  }
  if (doc.mime === DOCX) {
    const paras = await docxParagraphs(doc);
    if (!paras?.length) return <DownloadCard doc={doc} note="Aucun texte lisible dans ce document Word." />;
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

export default async function DocPage({ params }: { params: Params }) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = getDb();
  const doc = getDocument(db, id);
  if (!doc) notFound();
  const subjects = listSubjects(db);
  const subject = subjects.find((s) => s.id === doc.subjectId);
  const author = doc.authorId
    ? db.select({ name: users.name }).from(users).where(eq(users.id, doc.authorId)).get()?.name
    : undefined;
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
          <a href={fileUrl(doc.filePath, true)} className="btn btn-icon shrink-0 sm:w-auto sm:px-3" aria-label="Télécharger">
            <IconDownload size={16} />
            <span className="hidden sm:inline">Télécharger</span>
          </a>
        </div>

        <form
          action={setSubjectAction}
          className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[14px] ${
            needsReview ? "border-line-strong bg-surface" : "border-transparent px-0 py-0"
          }`}
        >
          <input type="hidden" name="id" value={doc.id} />
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
