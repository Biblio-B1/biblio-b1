"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { subjects } from "@/server/db/schema";
import { setDocumentSubject } from "@/server/documents";

const schema = z.object({
  id: z.uuid(),
  subjectId: z.union([z.literal(""), z.string().min(1).max(100)]),
});

/** Confirme ou corrige la matière d'un document (un clic). */
export async function setSubjectAction(fd: FormData): Promise<void> {
  await requireUser();
  const parsed = schema.safeParse({ id: fd.get("id"), subjectId: fd.get("subjectId") ?? "" });
  if (!parsed.success) return;
  const db = getDb();
  const subjectId = parsed.data.subjectId || null;
  if (subjectId && !db.select({ id: subjects.id }).from(subjects).where(eq(subjects.id, subjectId)).get()) return;
  setDocumentSubject(db, parsed.data.id, subjectId);
  revalidatePath("/", "layout");
}
