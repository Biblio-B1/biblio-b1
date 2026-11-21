// Dépôt de fichiers depuis le navigateur. Même déroulé que l'ancien serveur (UploadFlow inchangé) :
// 1. uploadFiles : brouillons gardés en mémoire (empreinte, texte extrait, matière proposée) ;
// 2. confirmUploads : envoi au bucket privé (uploads/<id>/…), document + exercices dans Postgres
//    (les vérifications Qwen sont mises en file par le trigger SQL).
import { classify } from "@/lib/classify";
import { getSupabase, FILES_BUCKET } from "@/lib/supabase/client";
import { guessType, mimeOf, sha256Hex, titleFromFileName, uploadStoragePath, validateUploadFile, type DocType } from "@/lib/upload-core";
import { splitExercises } from "@/server/extract/exercises";
import { detectLang, groupKey, isCorrection } from "@/server/import/pairing";
import { extractTextFromFile } from "./extract-browser";
import { listSubjects } from "./library";

export type UploadDraft = {
  tmpId: string;
  fileName: string;
  title: string;
  mime: string;
  size: number;
  suggestedSubjectId: string | null;
  suggestedType: DocType;
  duplicateOfId: string | null;
};
export type UploadResult = { drafts: UploadDraft[]; errors: { fileName: string; error: string }[] };
export type ConfirmItem = { tmpId: string; subjectId: string | null; title: string; type: DocType };
export type ConfirmResult = { created: { tmpId: string; id: string; title: string }[]; errors: { tmpId: string; error: string }[] };

const MAX_FILES = 20;
const drafts = new Map<string, { file: File; sha256: string; text: string; mime: string }>();

async function findBySha(sha256: string): Promise<string | null> {
  const { data } = await getSupabase().from("documents").select("id").eq("sha256", sha256).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function uploadFiles(formData: FormData): Promise<UploadResult> {
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  const result: UploadResult = { drafts: [], errors: [] };
  if (files.length === 0) return { ...result, errors: [{ fileName: "", error: "Aucun fichier reçu." }] };
  if (files.length > MAX_FILES) return { ...result, errors: [{ fileName: "", error: `${MAX_FILES} fichiers maximum par envoi.` }] };
  const subjects = await listSubjects();
  for (const file of files) {
    const invalid = validateUploadFile(file);
    if (invalid) {
      result.errors.push({ fileName: file.name, error: invalid });
      continue;
    }
    try {
      const sha256 = await sha256Hex(await file.arrayBuffer());
      const mime = mimeOf(file.name);
      const text = await extractTextFromFile(file, mime);
      const byName = classify({ fileName: file.name }, subjects).subjectId;
      const suggestedSubjectId = text ? (classify({ fileName: file.name, text }, subjects).subjectId ?? byName) : byName;
      const tmpId = crypto.randomUUID();
      drafts.set(tmpId, { file, sha256, text, mime });
      result.drafts.push({
        tmpId,
        fileName: file.name,
        title: titleFromFileName(file.name),
        mime,
        size: file.size,
        suggestedSubjectId,
        suggestedType: guessType(file.name),
        duplicateOfId: await findBySha(sha256),
      });
    } catch (e) {
      result.errors.push({ fileName: file.name, error: e instanceof Error ? e.message : "Erreur inattendue." });
    }
  }
  return result;
}

async function confirmOne(item: ConfirmItem, uid: string): Promise<{ id: string; title: string }> {
  const draft = drafts.get(item.tmpId);
  if (!draft) throw new Error("Brouillon introuvable ou expiré.");
  const title = item.title.trim();
  if (!title) throw new Error("Titre requis.");
  if (title.length > 300) throw new Error("Titre trop long.");
  if (await findBySha(draft.sha256)) {
    drafts.delete(item.tmpId);
    throw new Error("Ce fichier est déjà dans la bibliothèque.");
  }
  const supabase = getSupabase();
  const path = uploadStoragePath(uid, draft.sha256, draft.file.name);
  const up = await supabase.storage.from(FILES_BUCKET).upload(path, draft.file, { contentType: draft.mime, upsert: true });
  if (up.error) throw new Error("Envoi du fichier impossible.");
  const { data: doc, error } = await supabase
    .from("documents")
    .insert({
      title,
      type: item.type,
      subject_id: item.subjectId,
      subject_confirmed: true,
      file_path: path,
      mime: draft.mime,
      sha256: draft.sha256,
      text: draft.text,
      source: "upload",
      author_id: uid,
    })
    .select("id, title")
    .single();
  if (error || !doc) {
    await supabase.storage.from(FILES_BUCKET).remove([path]);
    throw new Error("Enregistrement impossible.");
  }
  // Énoncé d'exercices ou annale (pas un corrigé) : exercices découpés, vérifications mises en file.
  if ((item.type === "exercise" || item.type === "exam") && !isCorrection(draft.file.name)) {
    const parts = splitExercises(draft.text);
    if (parts.length) {
      const lang = detectLang(draft.file.name, draft.text);
      const base = groupKey(draft.file.name);
      const seen = new Map<number, number>();
      const rows = parts.map((ex) => {
        const k = (seen.get(ex.number) ?? 0) + 1;
        seen.set(ex.number, k);
        return {
          document_id: doc.id,
          number: ex.number,
          title: ex.title.slice(0, 300),
          statement: ex.body || ex.title,
          lang,
          group_key: `${base}#${ex.number}${k > 1 ? `-${k}` : ""}`,
          subject_id: item.subjectId,
        };
      });
      await supabase.from("exercises").insert(rows);
    }
  }
  drafts.delete(item.tmpId);
  return { id: doc.id as string, title: doc.title as string };
}

export async function confirmUploads(items: ConfirmItem[]): Promise<ConfirmResult> {
  const out: ConfirmResult = { created: [], errors: [] };
  if (!items.length || items.length > MAX_FILES) return { created: [], errors: [{ tmpId: "", error: "Données invalides." }] };
  const uid = (await getSupabase().auth.getUser()).data.user?.id;
  if (!uid) return { created: [], errors: [{ tmpId: "", error: "Session expirée : reconnectez-vous." }] };
  for (const item of items) {
    try {
      out.created.push({ tmpId: item.tmpId, ...(await confirmOne(item, uid)) });
    } catch (e) {
      out.errors.push({ tmpId: item.tmpId, error: e instanceof Error ? e.message : "Erreur inattendue." });
    }
  }
  return out;
}
