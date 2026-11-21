-- Recherche v2 : colonnes de filtrage (matière, type, auteur, date) et extrait sûr à afficher en HTML
-- (texte échappé avant le surlignage <mark>…</mark>, le texte venant de documents déposés).
drop function if exists public.search(text);

create function public.html_escape(s text) returns text
language sql immutable as $$
  select replace(replace(replace(coalesce(s, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
$$;

create function public.search(q text)
returns table (
  entity text,
  id uuid,
  title text,
  snippet text,
  rank real,
  subject_id uuid,
  doc_type text,
  author_id uuid,
  created_at timestamptz
)
language sql stable security invoker set search_path = public as $$
  with query as (select websearch_to_tsquery('public.fr', q) as tsq),
  opts as (select 'StartSel=<mark>, StopSel=</mark>, MaxWords=18, MinWords=6'::text as o)
  select * from (
    select 'document'::text, d.id, d.title,
           ts_headline('public.fr', public.html_escape(d.text), query.tsq, opts.o),
           ts_rank(d.search, query.tsq), d.subject_id, d.type, d.author_id, d.created_at
      from public.documents d, query, opts where d.search @@ query.tsq
    union all
    select 'exercise'::text, e.id, e.title,
           ts_headline('public.fr', public.html_escape(e.statement), query.tsq, opts.o),
           ts_rank(e.search, query.tsq), e.subject_id, 'exercise'::text, null::uuid, e.created_at
      from public.exercises e, query, opts where e.search @@ query.tsq
    union all
    select 'thread'::text, th.id, th.question, public.html_escape(th.question),
           ts_rank(th.search, query.tsq), null::uuid, 'note'::text, th.author_id, th.created_at
      from public.threads th, query where th.search @@ query.tsq
  ) r (entity, id, title, snippet, rank, subject_id, doc_type, author_id, created_at)
  order by rank desc
  limit 100
$$;

revoke execute on function public.search(text) from anon;
grant execute on function public.search(text) to authenticated;
