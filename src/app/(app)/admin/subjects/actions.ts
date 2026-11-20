"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ActionForm";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { createSubject, deleteSubject, parseKeywordLines, updateSubject, type SubjectInput } from "@/server/subjects";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

function readInput(fd: FormData): SubjectInput {
  return {
    name: str(fd, "name"),
    color: str(fd, "color"),
    pathPatterns: str(fd, "pathPatterns")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
    keywords: parseKeywordLines(str(fd, "keywords")),
  };
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Données invalides.");

export async function updateSubjectAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  await requireUser("admin");
  try {
    updateSubject(getDb(), id, readInput(fd));
  } catch (e) {
    return { error: errMsg(e) };
  }
  revalidatePath("/", "layout");
  return { message: "Enregistré." };
}

export async function createSubjectAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireUser("admin");
  try {
    createSubject(getDb(), readInput(fd));
  } catch (e) {
    return { error: errMsg(e) };
  }
  revalidatePath("/", "layout");
  return { message: "Matière ajoutée." };
}

export async function deleteSubjectAction(id: string): Promise<void> {
  await requireUser("admin");
  try {
    deleteSubject(getDb(), id);
  } catch {
    return;
  }
  revalidatePath("/", "layout");
}
