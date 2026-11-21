// Recherche plein texte (fonction SQL `search`, soumise à la RLS) et filtres appliqués ici.
import { getSupabase } from "@/lib/supabase/client";
import { docHref, exerciseHref } from "@/lib/routes";
import type { DocType } from "./types";

export type SearchFilters = { subject?: string; kind?: string; author?: string; from?: string; to?: string };

export type SearchResult = {
  entity: "document" | "exercise" | "thread";
  refId: string;
  title: string;
  /** HTML sûr : texte échappé côté base, seuls les <mark> sont ajoutés. */
  snippet: string;
  kind: DocType;
  subjectId: string | null;
  authorId: string | null;
  createdAt: Date;
  href: string;
};

type Row = {
  entity: SearchResult["entity"];
  id: string;
  title: string;
  snippet: string;
  subject_id: string | null;
  doc_type: string;
  author_id: string | null;
  created_at: string;
};

/** Fils de discussion : renvoient vers leur document ou exercice. */
async function threadTargets(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data } = await getSupabase().from("threads").select("id, target_type, target_id").in("id", ids);
  return new Map(
    (data ?? []).map((t) => [t.id as string, t.target_type === "exercise" ? exerciseHref(t.target_id) : docHref(t.target_id)]),
  );
}

export function applyFilters(rows: SearchResult[], f: SearchFilters): SearchResult[] {
  const from = f.from ? new Date(`${f.from}T00:00:00`) : null;
  const to = f.to ? new Date(`${f.to}T23:59:59.999`) : null;
  return rows.filter(
    (r) =>
      (!f.subject || r.subjectId === f.subject) &&
      (!f.kind || r.kind === f.kind) &&
      (!f.author || r.authorId === f.author) &&
      (!from || r.createdAt >= from) &&
      (!to || r.createdAt <= to),
  );
}

export async function search(q: string, filters: SearchFilters = {}, limit = 50): Promise<SearchResult[]> {
  const term = q.trim().slice(0, 200);
  if (!term) return [];
  const { data, error } = await getSupabase().rpc("search", { q: term });
  if (error) throw new Error(`Recherche : ${error.message}`);
  const rows = (data ?? []) as Row[];
  const targets = await threadTargets(rows.filter((r) => r.entity === "thread").map((r) => r.id));
  const results = rows.map((r) => ({
    entity: r.entity,
    refId: r.id,
    title: r.title,
    snippet: r.snippet,
    kind: r.doc_type as DocType,
    subjectId: r.subject_id,
    authorId: r.author_id,
    createdAt: new Date(r.created_at),
    href: r.entity === "document" ? docHref(r.id) : r.entity === "exercise" ? exerciseHref(r.id) : (targets.get(r.id) ?? "/library"),
  }));
  return applyFilters(results, filters).slice(0, limit);
}

/** Auteurs proposés dans le filtre (membres validés). */
export async function listAuthors(): Promise<{ id: string; name: string }[]> {
  const { data } = await getSupabase().from("profiles").select("id, name").eq("status", "active").order("name");
  return (data ?? []) as { id: string; name: string }[];
}
