"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { approveUser, rejectUser } from "@/server/auth/signup";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";

const idSchema = z.uuid();

export async function approveUserAction(fd: FormData): Promise<void> {
  await requireUser("admin");
  const id = idSchema.safeParse(fd.get("id"));
  if (!id.success) return;
  approveUser(getDb(), id.data);
  revalidatePath("/", "layout"); // pastille du menu Administration
}

export async function rejectUserAction(fd: FormData): Promise<void> {
  await requireUser("admin");
  const id = idSchema.safeParse(fd.get("id"));
  if (!id.success) return;
  rejectUser(getDb(), id.data);
  revalidatePath("/", "layout");
}
