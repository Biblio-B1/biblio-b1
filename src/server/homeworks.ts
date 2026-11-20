import fs from "node:fs";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { normalize } from "./classify";
import type { Db } from "./db/client";
import { homeworks, subjects, users } from "./db/schema";
import { env } from "./env";
import { resolveStoragePath, saveUpload } from "./storage";

export const MAX_HOMEWORK_ATTACHMENT_MB = 30;
export const MAX_HOMEWORK_ATTACHMENT_BYTES = MAX_HOMEWORK_ATTACHMENT_MB * 1024 * 1024;

export type HomeworkRow = {
  id: string;
  subjectId: string;
  subjectName: string;
  subjectSlug: string;
  subjectColor: string;
  title: string;
  dueDate: string;
  englishGroup: string | null;
  attachmentPath: string | null;
  attachmentName: string | null;
  attachmentMime: string | null;
  attachmentSize: number | null;
  authorId: string | null;
  authorName: string | null;
  createdAt: Date;
};

export type CreateHomeworkInput = {
  subjectId: string;
  title: string;
  dueDate: string;
  englishGroup?: string | null;
  attachment?: { buf: Buffer; originalName: string };
};

export function isEnglishSubject(subject: { name: string; slug: string }): boolean {
  const n = normalize(subject.name);
  const s = normalize(subject.slug);
  return n.includes("anglais") || n.includes("english") || s.includes("anglais") || s.includes("english");
}

function isValidIsoDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d;
}

const createHomeworkSchema = z.object({
  subjectId: z.string().trim().min(1, "Veuillez choisir une matière.").max(100),
  title: z
    .string()
    .trim()
    .min(1, "Veuillez décrire le devoir à faire.")
    .max(2000, "Description trop longue (2000 caractères max)."),
  dueDate: z
    .string()
    .trim()
    .refine(isValidIsoDate, "Date de rendu invalide (format AAAA-MM-JJ attendu)."),
  englishGroup: z
    .string()
    .trim()
    .max(120, "Nom de groupe trop long (120 caractères max).")
    .nullish(),
});

export function listHomeworks(db: Db): HomeworkRow[] {
  return db
    .select({
      id: homeworks.id,
      subjectId: homeworks.subjectId,
      subjectName: subjects.name,
      subjectSlug: subjects.slug,
      subjectColor: subjects.color,
      title: homeworks.title,
      dueDate: homeworks.dueDate,
      englishGroup: homeworks.englishGroup,
      attachmentPath: homeworks.attachmentPath,
      attachmentName: homeworks.attachmentName,
      attachmentMime: homeworks.attachmentMime,
      attachmentSize: homeworks.attachmentSize,
      authorId: homeworks.authorId,
      authorName: users.name,
      createdAt: homeworks.createdAt,
    })
    .from(homeworks)
    .innerJoin(subjects, eq(homeworks.subjectId, subjects.id))
    .leftJoin(users, eq(homeworks.authorId, users.id))
    .orderBy(asc(homeworks.dueDate), asc(homeworks.createdAt))
    .all();
}

export function createHomework(
  db: Db,
  input: CreateHomeworkInput,
  authorId: string,
  root: string = env.STORAGE_PATH,
): HomeworkRow {
  const parsed = createHomeworkSchema.safeParse({
    subjectId: input.subjectId,
    title: input.title,
    dueDate: input.dueDate,
    englishGroup: input.englishGroup,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Données du devoir invalides.");
  }
  const data = parsed.data;
  const subject = db.select().from(subjects).where(eq(subjects.id, data.subjectId)).get();
  if (!subject) throw new Error("Matière introuvable.");

  const english = isEnglishSubject(subject);
  const group = english ? (data.englishGroup?.trim() || null) : null;
  if (english && !group) {
    throw new Error("Veuillez préciser quel groupe d'anglais est concerné.");
  }

  let saved: { filePath: string; mime: string; name: string; size: number } | null = null;
  if (input.attachment) {
    const { buf, originalName } = input.attachment;
    if (buf.length === 0) throw new Error("La pièce jointe est vide.");
    if (buf.length > MAX_HOMEWORK_ATTACHMENT_BYTES) {
      throw new Error(`La pièce jointe dépasse la limite de ${MAX_HOMEWORK_ATTACHMENT_MB} Mo.`);
    }
    const cleanName = (originalName.split(/[\\/]/).pop() ?? originalName).trim() || "piece-jointe";
    const uploaded = saveUpload(buf, cleanName, root);
    saved = {
      filePath: uploaded.filePath,
      mime: uploaded.mime,
      name: cleanName.slice(0, 255),
      size: buf.length,
    };
  }

  let createdId: string;
  try {
    const inserted = db
      .insert(homeworks)
      .values({
        subjectId: subject.id,
        title: data.title,
        dueDate: data.dueDate,
        englishGroup: group,
        attachmentPath: saved?.filePath ?? null,
        attachmentName: saved?.name ?? null,
        attachmentMime: saved?.mime ?? null,
        attachmentSize: saved?.size ?? null,
        authorId,
      })
      .returning()
      .get();
    createdId = inserted.id;
  } catch (e) {
    if (saved) {
      try {
        fs.rmSync(resolveStoragePath(saved.filePath, root), { force: true });
      } catch {
        // fichier déjà absent
      }
    }
    throw e;
  }

  return listHomeworks(db).find((h) => h.id === createdId)!;
}

export function deleteHomework(db: Db, id: string, root: string = env.STORAGE_PATH): void {
  const deleted = db
    .delete(homeworks)
    .where(eq(homeworks.id, id))
    .returning({ attachmentPath: homeworks.attachmentPath })
    .get();
  if (!deleted) throw new Error("Devoir introuvable.");
  if (deleted.attachmentPath) {
    try {
      fs.rmSync(resolveStoragePath(deleted.attachmentPath, root), { force: true });
    } catch {
      // fichier déjà absent
    }
  }
}
