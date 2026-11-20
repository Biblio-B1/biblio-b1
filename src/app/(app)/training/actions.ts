"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { PROGRESS_STATUSES } from "@/server/db/schema";
import { checkExerciseCode, type ExerciseCheckResult } from "@/server/exercise-check";
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

const checkSchema = z.object({
  exerciseId: z.uuid(),
  code: z.string().max(20_000, "Le code est trop long (20 000 caractères maximum)."),
});

/** Vérifie le code soumis pour un exercice et renvoie une correction détaillée en cas d'erreur. */
export async function checkExerciseCodeAction(
  exerciseId: string,
  code: string,
): Promise<{ result?: ExerciseCheckResult; error?: string }> {
  await requireUser();
  const parsed = checkSchema.safeParse({ exerciseId, code });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Entrée invalide." };
  }
  try {
    const result = checkExerciseCode(getDb(), parsed.data.exerciseId, parsed.data.code);
    return { result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Impossible de vérifier le code." };
  }
}
