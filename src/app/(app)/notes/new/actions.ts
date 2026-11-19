"use server";

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { documents, subjects } from "@/server/db/schema";
import { createDocument } from "@/server/documents";
import { saveUpload } from "@/server/storage";

export type NoteState = { error?: string } | null;

const schema = z.object({
  title: z.string().trim().min(1, "Donnez un titre à la fiche.").max(300, "Titre trop long."),
  subjectId: z.union([z.literal(""), z.string().min(1).max(100)]),
  body: z.string().trim().min(1, "La fiche est vide.").max(500_000, "Fiche trop longue."),
});

/** Enregistre une fiche Markdown écrite en ligne (document de type `note`). */
export async function createNoteAction(_prev: NoteState, fd: FormData): Promise<NoteState> {
  const user = await requireUser();
  const parsed = schema.safeParse({
    title: fd.get("title") ?? "",
    subjectId: fd.get("subjectId") ?? "",
    body: fd.get("body") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  const db = getDb();
  const subjectId = parsed.data.subjectId || null;
  if (subjectId && !db.select({ id: subjects.id }).from(subjects).where(eq(subjects.id, subjectId)).get()) {
    return { error: "Matière inconnue." };
  }
  const body = `${parsed.data.body}\n`;
  const buf = Buffer.from(body, "utf8");
  const sha256 = createHash("sha256").update(buf).digest("hex");
  if (db.select({ id: documents.id }).from(documents).where(eq(documents.sha256, sha256)).get()) {
    return { error: "Une fiche identique existe déjà." };
  }
  const saved = saveUpload(buf, "fiche.md");
  const doc = createDocument(db, {
    title: parsed.data.title,
    type: "note",
    subjectId,
    subjectConfirmed: true,
    filePath: saved.filePath,
    mime: saved.mime,
    sha256: saved.sha256,
    text: body,
    source: "upload",
    authorId: user.id,
  });
  revalidatePath("/", "layout");
  redirect(`/doc/${doc.id}`);
}
