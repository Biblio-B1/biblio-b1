"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/components/ActionForm";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import {
  createHomework,
  deleteHomework,
  MAX_HOMEWORK_ATTACHMENT_BYTES,
  MAX_HOMEWORK_ATTACHMENT_MB,
} from "@/server/homeworks";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Erreur inattendue.");

export async function createHomeworkAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const subjectId = String(formData.get("subjectId") ?? "");
  const dueDate = String(formData.get("dueDate") ?? "");
  const title = String(formData.get("title") ?? "");
  const englishGroup = String(formData.get("englishGroup") ?? "");
  const rawFile = formData.get("attachment");

  let attachment: { buf: Buffer; originalName: string } | undefined;
  if (rawFile instanceof File && rawFile.name.trim().length > 0) {
    if (rawFile.size === 0) {
      return { error: "La pièce jointe est vide." };
    }
    if (rawFile.size > MAX_HOMEWORK_ATTACHMENT_BYTES) {
      return { error: `La pièce jointe dépasse la limite de ${MAX_HOMEWORK_ATTACHMENT_MB} Mo.` };
    }
    attachment = {
      buf: Buffer.from(await rawFile.arrayBuffer()),
      originalName: rawFile.name,
    };
  }

  try {
    createHomework(
      getDb(),
      {
        subjectId,
        dueDate,
        title,
        englishGroup: englishGroup || null,
        attachment,
      },
      user.id,
    );
  } catch (e) {
    return { error: errMsg(e) };
  }

  revalidatePath("/", "layout");
  return { message: "Devoir enregistré et partagé avec toute la promo." };
}

export async function deleteHomeworkAction(id: string): Promise<{ error?: string }> {
  await requireUser();
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { error: "Identifiant de devoir invalide." };
  try {
    deleteHomework(getDb(), parsed.data);
  } catch (e) {
    return { error: errMsg(e) };
  }
  revalidatePath("/", "layout");
  return {};
}
