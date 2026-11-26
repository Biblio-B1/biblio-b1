// Compte Outlook lié (table outlook_links, ligne de l'élève seulement).
import { getSupabase } from "@/lib/supabase/client";
import type { OutlookAccount } from "@/lib/outlook-link";

export type LinkedOutlook = OutlookAccount & { linkedAt: Date };

export async function getLinkedOutlook(): Promise<LinkedOutlook | null> {
  const supabase = getSupabase();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data, error } = await supabase.from("outlook_links").select("email, name, linked_at").eq("user_id", u.user.id).maybeSingle();
  if (error) throw new Error(`Outlook : ${error.message}`);
  if (!data) return null;
  const r = data as { email: string; name: string | null; linked_at: string };
  return { email: r.email, name: r.name, linkedAt: new Date(r.linked_at) };
}

export async function saveLinkedOutlook(a: OutlookAccount): Promise<void> {
  const supabase = getSupabase();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Non connecté.");
  const { error } = await supabase
    .from("outlook_links")
    .upsert({ user_id: u.user.id, email: a.email.slice(0, 254), name: a.name?.slice(0, 200) ?? null, linked_at: new Date().toISOString() });
  if (error) throw new Error("Le compte Outlook n'a pas pu être enregistré.");
}

export async function unlinkOutlook(): Promise<void> {
  const supabase = getSupabase();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  const { error } = await supabase.from("outlook_links").delete().eq("user_id", u.user.id);
  if (error) throw new Error("Impossible de délier le compte Outlook.");
}
