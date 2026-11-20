"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { PROGRESS_STATUSES } from "@/server/db/schema";
import { setStatus } from "@/server/progress";

const schema = z.object({ exerciseId: z.uuid(), status: z.enum(PROGRESS_STATUSES) });

/** Change le statut de l'exercice pour l'utilisateur connecté. */
export async function setStatusAction(exerciseId: string, status: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const parsed = schema.safeParse({ exerciseId, status });
  if (!parsed.success) return { error: "Statut invalide." };
  try {
    setStatus(getDb(), user.id, parsed.data.exerciseId, parsed.data.status);
  } catch {
    return { error: "Exercice introuvable." };
  }
  revalidatePath("/training");
  revalidatePath(`/training/${parsed.data.exerciseId}`);
  return {};
}
