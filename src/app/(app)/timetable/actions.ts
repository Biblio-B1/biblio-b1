"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { CalendarError, getCalendar, linkCalendar, unlinkCalendar } from "@/server/boostcamp/calendar";
import type { FormState } from "@/components/ActionForm";

const urlSchema = z.string().trim().min(1, "Collez le lien iCalendar fourni par Boostcamp.").max(2048, "Le lien est trop long.");

export async function linkCalendarAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = urlSchema.safeParse(formData.get("calendarUrl"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Lien invalide." };
  try {
    const events = await linkCalendar(getDb(), user.id, parsed.data);
    revalidatePath("/timetable");
    return { message: `Calendrier lié : ${events.length} événement${events.length === 1 ? "" : "s"} synchronisé${events.length === 1 ? "" : "s"}.` };
  } catch (error) {
    if (error instanceof CalendarError) {
      revalidatePath("/timetable");
      return { error: error.message };
    }
    throw error;
  }
}

export async function syncCalendarAction(_previous: FormState, _formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    const calendar = await getCalendar(getDb(), user.id, true);
    if (!calendar) return { error: "Aucun calendrier n’est lié." };
    revalidatePath("/timetable");
    return { message: `${calendar.events.length} événement${calendar.events.length === 1 ? "" : "s"} synchronisé${calendar.events.length === 1 ? "" : "s"}.` };
  } catch (error) {
    if (error instanceof CalendarError) {
      revalidatePath("/timetable");
      return { error: error.message };
    }
    throw error;
  }
}

export async function unlinkCalendarAction(): Promise<void> {
  const user = await requireUser();
  unlinkCalendar(getDb(), user.id);
  revalidatePath("/timetable");
}
