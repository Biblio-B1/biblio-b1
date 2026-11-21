// Administration des matières (RLS : écriture réservée aux administrateurs). Mêmes signatures que
// les anciennes server actions, pour SubjectForm.
import type { FormState } from "@/components/ActionForm";
import { slugify } from "@/lib/slug";
import { parseKeywordLines, subjectInputSchema, type SubjectRules } from "@/lib/subject-rules";
import { getSupabase } from "@/lib/supabase/client";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

function readInput(fd: FormData): { ok: true; name: string; color: string; rules: SubjectRules } | { ok: false; error: string } {
  let keywords: Record<string, number>;
  try {
    keywords = parseKeywordLines(str(fd, "keywords"));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Mots-clés invalides." };
  }
  const r = subjectInputSchema.safeParse({
    name: str(fd, "name"),
    color: str(fd, "color"),
    pathPatterns: str(fd, "pathPatterns")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
    keywords,
  });
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "Données invalides." };
  return { ok: true, name: r.data.name, color: r.data.color.toLowerCase(), rules: { pathPatterns: r.data.pathPatterns, keywords: r.data.keywords } };
}

export async function updateSubjectAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const v = readInput(fd);
  if (!v.ok) return { error: v.error };
  const { data, error } = await getSupabase().from("subjects").update({ name: v.name, color: v.color, rules: v.rules }).eq("id", id).select("id");
  if (error || !data?.length) return { error: "Enregistrement impossible (réservé aux administrateurs)." };
  return { message: "Enregistré." };
}

export async function createSubjectAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const v = readInput(fd);
  if (!v.ok) return { error: v.error };
  const supabase = getSupabase();
  const { data: existing } = await supabase.from("subjects").select("slug");
  const taken = new Set((existing ?? []).map((r) => r.slug as string));
  const base = slugify(v.name);
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  const { error } = await supabase.from("subjects").insert({ name: v.name, slug, color: v.color, rules: v.rules });
  if (error) return { error: "Ajout impossible (réservé aux administrateurs)." };
  return { message: "Matière ajoutée." };
}

/** Supprime une matière : ses documents et exercices passent « sans matière » (on delete set null). */
export async function deleteSubjectAction(id: string): Promise<void> {
  await getSupabase().from("subjects").delete().eq("id", id);
}
