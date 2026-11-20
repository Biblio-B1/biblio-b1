"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import {
  reportCheck,
  requeueCheck,
  resolveReport,
  saveAttempt,
  updateTests,
  verifyCheck,
  type CheckLanguage,
  type CheckTest,
} from "@/server/checks";
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
  if (m === "unverifiable") return "Validation impossible : le pré-calcul n'a pas produit de tests (statut autre que « ready »). Modifiez les tests à la main.";
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
    const unverifiable = e instanceof Error && e.message === "invalid";
    return { error: errorText(unverifiable ? new Error("unverifiable") : e, "Validation impossible.") };
  }
  revalidate(id.data);
  return { message: "Tests validés." };
}

/**
 * Admin : remplace les tests à partir d'un JSON `[{input, expected, visible}]` (validé par zod).
 * `language` : obligatoire si le pré-calcul n'a pas encore fixé de langage. L'exercice devient
 * `ready` et validé.
 */
export async function updateTestsAction(exerciseId: string, json: string, language?: string | null): Promise<Result> {
  const user = await requireUser();
  const id = idSchema.safeParse(exerciseId);
  if (!id.success) return { error: "Exercice introuvable." };
  const lang = z.enum(CHECK_LANGUAGES).nullish().safeParse(language === "" ? null : language);
  if (!lang.success) return { error: "Langage invalide." };
  let tests: unknown;
  try {
    tests = JSON.parse(typeof json === "string" ? json : "");
  } catch {
    return { error: "JSON invalide." };
  }
  try {
    updateTests(getDb(), id.data, tests as CheckTest[], { id: user.id, role: user.role }, (lang.data ?? null) as CheckLanguage | null);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const issue = e.issues[0];
      const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
      return { error: `Tests invalides${where} : ${issue?.message ?? "format attendu [{input, expected, visible}]"}` };
    }
    if (e instanceof Error && e.message === "invalid") return { error: "Choisissez le langage des tests." };
    return { error: errorText(e, "Enregistrement impossible.") };
  }
  revalidate(id.data);
  return { message: "Tests enregistrés et validés." };
}

/**
 * Admin : remet l'exercice en file du pré-calcul (`pending`). Sur des tests validés, il faut
 * `confirm: true` (confirmation explicite) : la validation est alors retirée.
 */
export async function retryCheckAction(exerciseId: string, confirm?: boolean): Promise<Result> {
  const user = await requireUser();
  if (user.role !== "admin") return { error: "Action réservée aux administrateurs." };
  const id = idSchema.safeParse(exerciseId);
  if (!id.success) return { error: "Exercice introuvable." };
  let r: ReturnType<typeof requeueCheck>;
  try {
    r = requeueCheck(getDb(), id.data, { unverify: confirm === true });
  } catch {
    return { error: "Exercice introuvable." };
  }
  if (r === "verified") return { error: "Tests validés par un administrateur : confirmez pour retirer la validation et relancer le pré-calcul." };
  if (r === "busy") return { error: "Pré-calcul en cours : réessayez quand il sera terminé." };
  revalidate(id.data);
  return { message: "Exercice remis en file du pré-calcul." };
}

/** Admin : marque un signalement comme traité. */
export async function resolveReportAction(reportId: string): Promise<Result> {
  const user = await requireUser();
  if (user.role !== "admin") return { error: "Action réservée aux administrateurs." };
  const id = idSchema.safeParse(reportId);
  if (!id.success) return { error: "Signalement introuvable." };
  let exerciseId: string;
  try {
    exerciseId = resolveReport(getDb(), id.data, { id: user.id, role: user.role });
  } catch (e) {
    return { error: e instanceof Error && e.message === "not_found" ? "Signalement introuvable." : errorText(e, "Action impossible.") };
  }
  revalidate(exerciseId);
  revalidatePath("/admin/reports");
  return { message: "Signalement marqué comme traité." };
}
