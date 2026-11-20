"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { reportCheck, requeueCheck, saveAttempt, updateTests, verifyCheck, type CheckTest } from "@/server/checks";
import { getDb } from "@/server/db/client";
import { CHECK_LANGUAGES } from "@/server/db/schema";

type Result = { error?: string; message?: string };

const idSchema = z.uuid();

const attemptSchema = z.object({
  exerciseId: z.uuid(),
  language: z.enum(CHECK_LANGUAGES),
  code: z.string().max(100_000),
  passed: z.boolean(),
});

function revalidate(exerciseId: string) {
  revalidatePath("/training");
  revalidatePath(`/training/${exerciseId}`);
}

function errorText(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : "";
  if (m === "forbidden") return "Action réservée aux administrateurs.";
  if (m === "not_found") return "Exercice introuvable.";
  if (m === "invalid") return "Données invalides.";
  return fallback;
}

/**
 * Enregistre le code de l'étudiant et met à jour sa progression (`doing`, ou `mastered` si réussi).
 * `passed` est déclaré par le navigateur (la vérification s'y exécute) : progression personnelle.
 */
export async function saveAttemptAction(exerciseId: string, language: string, code: string, passed: boolean): Promise<Result> {
  const user = await requireUser();
  const p = attemptSchema.safeParse({ exerciseId, language, code, passed });
  if (!p.success) return { error: "Code ou langage invalide." };
  try {
    saveAttempt(getDb(), user.id, p.data.exerciseId, p.data.language, p.data.code, p.data.passed);
  } catch (e) {
    return { error: errorText(e, "Enregistrement impossible.") };
  }
  revalidate(p.data.exerciseId);
  return {};
}

/** Signale un test faux (tout membre connecté). */
export async function reportCheckAction(exerciseId: string, message: string): Promise<Result> {
  const user = await requireUser();
  const id = idSchema.safeParse(exerciseId);
  if (!id.success) return { error: "Exercice introuvable." };
  try {
    reportCheck(getDb(), id.data, user.id, typeof message === "string" ? message : "");
  } catch (e) {
    return { error: errorText(e, "Signalement impossible.").replace("Données invalides.", "Message vide ou trop long (2 000 caractères max).") };
  }
  return { message: "Merci, le signalement a été envoyé." };
}

/** Admin : valide les tests tels quels. */
export async function verifyCheckAction(exerciseId: string): Promise<Result> {
  const user = await requireUser();
  const id = idSchema.safeParse(exerciseId);
  if (!id.success) return { error: "Exercice introuvable." };
  try {
    verifyCheck(getDb(), id.data, { id: user.id, role: user.role });
  } catch (e) {
    return { error: errorText(e, "Validation impossible.") };
  }
  revalidate(id.data);
  return { message: "Tests validés." };
}

/** Admin : remplace les tests à partir d'un JSON `[{input, expected, visible}]` (validé par zod). */
export async function updateTestsAction(exerciseId: string, json: string): Promise<Result> {
  const user = await requireUser();
  const id = idSchema.safeParse(exerciseId);
  if (!id.success) return { error: "Exercice introuvable." };
  let tests: unknown;
  try {
    tests = JSON.parse(typeof json === "string" ? json : "");
  } catch {
    return { error: "JSON invalide." };
  }
  try {
    updateTests(getDb(), id.data, tests as CheckTest[], { id: user.id, role: user.role });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const issue = e.issues[0];
      const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
      return { error: `Tests invalides${where} : ${issue?.message ?? "format attendu [{input, expected, visible}]"}` };
    }
    return { error: errorText(e, "Enregistrement impossible.") };
  }
  revalidate(id.data);
  return { message: "Tests enregistrés et validés." };
}

/** Admin : remet l'exercice en file du pré-calcul (`pending`). */
export async function retryCheckAction(exerciseId: string): Promise<Result> {
  const user = await requireUser();
  if (user.role !== "admin") return { error: "Action réservée aux administrateurs." };
  const id = idSchema.safeParse(exerciseId);
  if (!id.success) return { error: "Exercice introuvable." };
  let r: ReturnType<typeof requeueCheck>;
  try {
    r = requeueCheck(getDb(), id.data);
  } catch {
    return { error: "Exercice introuvable." };
  }
  if (r === "verified") return { error: "Tests validés par un administrateur : modifiez-les plutôt que de relancer le pré-calcul." };
  if (r === "busy") return { error: "Pré-calcul en cours : réessayez quand il sera terminé." };
  revalidate(id.data);
  return { message: "Exercice remis en file du pré-calcul." };
}
