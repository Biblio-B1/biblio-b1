// Annuaire des professeurs (table teachers, RLS : comptes validés ; suppression : admin).
import type { FoundTeacher } from "@/lib/teachers";
import { getSupabase } from "@/lib/supabase/client";

export type Teacher = { id: string; name: string; email: string | null; subjects: string[] };

export async function listTeachers(): Promise<Teacher[]> {
  const { data, error } = await getSupabase().from("teachers").select("id, name, email, subjects").order("name");
  if (error) throw new Error(`Professeurs : ${error.message}`);
  return (data ?? []) as Teacher[];
}

/** Ajoute les professeurs relevés dans l'emploi du temps (sans doublon ; matières fusionnées). */
export async function registerTeachers(found: FoundTeacher[]): Promise<void> {
  if (found.length === 0) return;
  const { error } = await getSupabase().rpc("register_teachers", { items: found });
  if (error) throw new Error(`Professeurs : ${error.message}`);
}

export async function addTeacher(name: string, email: string | null): Promise<void> {
  const { error } = await getSupabase().from("teachers").insert({ name, email });
  if (error) throw new Error(/duplicate key/i.test(error.message) ? "Ce professeur est déjà dans la liste." : "Ajout impossible.");
}

export async function setTeacherEmail(id: string, email: string | null): Promise<void> {
  const { error } = await getSupabase()
    .from("teachers")
    .update({ email, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(/check/i.test(error.message) ? "Adresse e-mail invalide." : "Enregistrement impossible.");
}

export async function deleteTeacher(id: string): Promise<void> {
  const { error } = await getSupabase().from("teachers").delete().eq("id", id);
  if (error) throw new Error("Suppression impossible.");
}
