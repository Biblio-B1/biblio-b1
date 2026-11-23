-- Biblio B1 sur Supabase : schéma, droits (RLS), stockage privé, recherche, file du solveur.
-- Principe : un visiteur ou un compte « pending » ne lit rien (sauf son propre profil) ; un compte
-- « active » lit tout le contenu partagé ; l'administrateur (role admin + active) gère le reste.
-- La clé service_role (scripts du PC, Edge Functions) contourne la RLS.

create extension if not exists unaccent with schema extensions;

-- Recherche en français, sans tenir compte des accents ni de la casse.
create text search configuration public.fr (copy = pg_catalog.french);
alter text search configuration public.fr
  alter mapping for hword, hword_part, word with extensions.unaccent, french_stem;

-- ---------------------------------------------------------------------------------------------
-- Profils (1 par compte Supabase Auth)
-- ---------------------------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 40 and position('@' in name) = 0),
  role text not null default 'member' check (role in ('admin', 'member')),
  status text not null default 'pending' check (status in ('active', 'pending')),
  created_at timestamptz not null default now()
);
create unique index profiles_name_lower_idx on public.profiles (lower(name));

create function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active')
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active' and role = 'admin')
$$;

-- Inscription : profil créé « pending » avec le nom complet fourni à signUp (options.data.name).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name) values (new.id, trim(coalesce(new.raw_user_meta_data ->> 'name', '')));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Seul un administrateur change le rôle ou le statut (les scripts service_role, sans auth.uid(), passent).
create function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.status is distinct from old.status or new.id is distinct from old.id)
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'Seul un administrateur peut modifier le rôle ou le statut d''un compte';
  end if;
  return new;
end;
$$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- Demandes de compte en attente, avec l'e-mail (stocké dans auth.users, illisible par le site) :
-- réservé aux administrateurs, vide pour tout autre appelant.
create function public.pending_requests()
returns table (id uuid, name text, email text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, u.email::text, p.created_at
    from public.profiles p join auth.users u on u.id = p.id
   where p.status = 'pending' and public.is_admin()
   order by p.created_at
$$;

alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------------------------
-- Contenu partagé
-- ---------------------------------------------------------------------------------------------
create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  color text not null default '#6b7280',
  rules jsonb,
  created_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null check (type in ('course', 'photo', 'exercise', 'exam', 'note')),
  subject_id uuid references public.subjects (id) on delete set null,
  subject_confirmed boolean not null default false,
  file_path text not null,
  mime text not null,
  sha256 text not null unique,
  text text not null default '',
  source text not null check (source in ('upload', 'local', 'github')),
  source_path text,
  tags jsonb not null default '[]'::jsonb,
  author_id uuid references public.profiles (id) on delete set null,
  correction_of_id uuid references public.documents (id) on delete set null,
  created_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('public.fr', coalesce(title, '')), 'A') || setweight(to_tsvector('public.fr', coalesce(text, '')), 'B')
  ) stored
);
create index documents_subject_idx on public.documents (subject_id);
create index documents_search_idx on public.documents using gin (search);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  number integer not null,
  title text not null,
  statement text not null,
  solution text,
  hints jsonb,
  lang text not null default 'fr' check (lang in ('fr', 'en')),
  group_key text not null,
  subject_id uuid references public.subjects (id) on delete set null,
  created_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('public.fr', coalesce(title, '')), 'A') || setweight(to_tsvector('public.fr', coalesce(statement, '')), 'B')
  ) stored
);
create index exercises_document_idx on public.exercises (document_id);
create index exercises_group_idx on public.exercises (group_key);
create index exercises_search_idx on public.exercises using gin (search);

create table public.progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  status text not null default 'todo' check (status in ('todo', 'doing', 'mastered')),
  updated_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('document', 'exercise')),
  target_id uuid not null,
  question text not null,
  kind text not null default 'question' check (kind in ('question', 'note')),
  is_synthesis boolean not null default false,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('public.fr', coalesce(question, ''))) stored
);
create index threads_target_idx on public.threads (target_type, target_id);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null,
  image_path text,
  pinned boolean not null default false,
  is_summary boolean not null default false,
  created_at timestamptz not null default now()
);
create index posts_thread_idx on public.posts (thread_id);

-- Documents importés supprimés à la main : leur sha256 n'est plus ré-importé.
create table public.import_exclusions (
  sha256 text primary key,
  source_path text,
  deleted_at timestamptz not null default now(),
  deleted_by uuid
);

create table public.exercise_checks (
  exercise_id uuid primary key references public.exercises (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'ready', 'no_code', 'unsupported', 'failed')),
  language text check (language in ('c', 'python', 'javascript')),
  reference_code text,
  reference_source text check (reference_source in ('prof', 'ai')),
  tests jsonb not null default '[]'::jsonb,
  verified boolean not null default false,
  verified_by uuid,
  model text,
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index exercise_checks_status_idx on public.exercise_checks (status, updated_at);

create table public.check_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  message text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index check_reports_exercise_idx on public.check_reports (exercise_id);

create table public.code_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  language text not null check (language in ('c', 'python', 'javascript')),
  code text not null,
  passed boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (user_id, exercise_id)
);

create table public.homeworks (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  title text not null,
  due_date date not null,
  english_group text,
  attachment_path text,
  attachment_name text,
  attachment_mime text,
  attachment_size integer,
  author_id uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index homeworks_due_date_idx on public.homeworks (due_date);
create index homeworks_subject_idx on public.homeworks (subject_id);

-- Emploi du temps : écrit par l'Edge Function calendar (service_role), lu par son propriétaire.
create table public.calendar_links (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  encrypted_url text not null,
  events jsonb not null default '[]'::jsonb,
  synced_at timestamptz not null default now()
);

-- Chaque nouvel exercice est mis en file pour le solveur Qwen.
create function public.enqueue_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.exercise_checks (exercise_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger exercises_enqueue_check after insert on public.exercises
  for each row execute function public.enqueue_check();

-- ---------------------------------------------------------------------------------------------
-- Droits (RLS)
-- ---------------------------------------------------------------------------------------------
alter table public.subjects enable row level security;
create policy subjects_select on public.subjects for select to authenticated using (public.is_active());
create policy subjects_admin on public.subjects for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.documents enable row level security;
create policy documents_select on public.documents for select to authenticated using (public.is_active());
create policy documents_insert on public.documents for insert to authenticated
  with check (public.is_active() and author_id = auth.uid() and source = 'upload');
create policy documents_update on public.documents for update to authenticated
  using (public.is_admin() or (public.is_active() and author_id = auth.uid()))
  with check (public.is_admin() or (public.is_active() and author_id = auth.uid()));
create policy documents_delete on public.documents for delete to authenticated
  using (public.is_admin() or (public.is_active() and author_id = auth.uid()));

alter table public.exercises enable row level security;
create policy exercises_select on public.exercises for select to authenticated using (public.is_active());
create policy exercises_insert on public.exercises for insert to authenticated
  with check (public.is_admin() or (public.is_active() and exists (
    select 1 from public.documents d where d.id = document_id and d.author_id = auth.uid())));
create policy exercises_admin_update on public.exercises for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy exercises_admin_delete on public.exercises for delete to authenticated using (public.is_admin());

alter table public.progress enable row level security;
create policy progress_own on public.progress for all to authenticated
  using (public.is_active() and user_id = auth.uid()) with check (public.is_active() and user_id = auth.uid());

alter table public.threads enable row level security;
create policy threads_select on public.threads for select to authenticated using (public.is_active());
create policy threads_insert on public.threads for insert to authenticated
  with check (public.is_active() and author_id = auth.uid());
create policy threads_update on public.threads for update to authenticated
  using (public.is_admin() or (public.is_active() and author_id = auth.uid()))
  with check (public.is_admin() or (public.is_active() and author_id = auth.uid()));
create policy threads_delete on public.threads for delete to authenticated
  using (public.is_admin() or (public.is_active() and author_id = auth.uid()));

alter table public.posts enable row level security;
create policy posts_select on public.posts for select to authenticated using (public.is_active());
create policy posts_insert on public.posts for insert to authenticated
  with check (public.is_active() and author_id = auth.uid());
-- Épingler / marquer comme synthèse : auteur du message, auteur du fil ou administrateur.
create policy posts_update on public.posts for update to authenticated
  using (public.is_admin() or (public.is_active() and (author_id = auth.uid() or exists (
    select 1 from public.threads th where th.id = thread_id and th.author_id = auth.uid()))))
  with check (public.is_admin() or (public.is_active() and (author_id = auth.uid() or exists (
    select 1 from public.threads th where th.id = thread_id and th.author_id = auth.uid()))));
create policy posts_delete on public.posts for delete to authenticated
  using (public.is_admin() or (public.is_active() and author_id = auth.uid()));

alter table public.import_exclusions enable row level security;
create policy import_exclusions_admin on public.import_exclusions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.exercise_checks enable row level security;
create policy exercise_checks_select on public.exercise_checks for select to authenticated using (public.is_active());
create policy exercise_checks_admin on public.exercise_checks for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.check_reports enable row level security;
create policy check_reports_select on public.check_reports for select to authenticated
  using (public.is_admin() or (public.is_active() and user_id = auth.uid()));
create policy check_reports_insert on public.check_reports for insert to authenticated
  with check (public.is_active() and user_id = auth.uid());
create policy check_reports_admin on public.check_reports for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.code_attempts enable row level security;
create policy code_attempts_own on public.code_attempts for all to authenticated
  using (public.is_active() and user_id = auth.uid()) with check (public.is_active() and user_id = auth.uid());

alter table public.homeworks enable row level security;
create policy homeworks_select on public.homeworks for select to authenticated using (public.is_active());
create policy homeworks_insert on public.homeworks for insert to authenticated
  with check (public.is_active() and author_id = auth.uid());
create policy homeworks_update on public.homeworks for update to authenticated
  using (public.is_admin() or (public.is_active() and author_id = auth.uid()))
  with check (public.is_admin() or (public.is_active() and author_id = auth.uid()));
create policy homeworks_delete on public.homeworks for delete to authenticated
  using (public.is_admin() or (public.is_active() and author_id = auth.uid()));

alter table public.calendar_links enable row level security;
create policy calendar_links_own_select on public.calendar_links for select to authenticated using (user_id = auth.uid());
create policy calendar_links_own_delete on public.calendar_links for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------------------------
-- Stockage privé : bucket « files » (documents, images des messages, pièces jointes des devoirs)
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('files', 'files', false) on conflict (id) do nothing;

create policy files_select on storage.objects for select to authenticated
  using (bucket_id = 'files' and public.is_active());
create policy files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and public.is_active()
    and (storage.foldername(name))[1] = 'uploads' and (storage.foldername(name))[2] = auth.uid()::text);
create policy files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'files' and (public.is_admin() or (public.is_active() and owner = auth.uid())));

-- ---------------------------------------------------------------------------------------------
-- Recherche (Ctrl+K) : soumise à la RLS de l'appelant (security invoker).
-- ---------------------------------------------------------------------------------------------
create function public.search(q text)
returns table (kind text, id uuid, title text, snippet text, rank real)
language sql stable security invoker set search_path = public as $$
  with query as (select websearch_to_tsquery('public.fr', q) as tsq)
  select * from (
    select 'document'::text, d.id, d.title,
           ts_headline('public.fr', d.text, query.tsq, 'MaxWords=18, MinWords=6'), ts_rank(d.search, query.tsq)
      from public.documents d, query where d.search @@ query.tsq
    union all
    select 'exercise'::text, e.id, e.title,
           ts_headline('public.fr', e.statement, query.tsq, 'MaxWords=18, MinWords=6'), ts_rank(e.search, query.tsq)
      from public.exercises e, query where e.search @@ query.tsq
    union all
    select 'thread'::text, th.id, th.question, th.question, ts_rank(th.search, query.tsq)
      from public.threads th, query where th.search @@ query.tsq
  ) r (kind, id, title, snippet, rank)
  order by rank desc
  limit 30
$$;

-- ---------------------------------------------------------------------------------------------
-- File du solveur Qwen (PC, clé service_role) : prend une vérification en attente.
-- ---------------------------------------------------------------------------------------------
create function public.claim_check() returns setof public.exercise_checks
language sql volatile security invoker set search_path = public as $$
  update public.exercise_checks
     set status = 'running', attempts = attempts + 1, updated_at = now()
   where exercise_id = (
     select exercise_id from public.exercise_checks
      where status = 'pending' and verified = false
      order by updated_at
      limit 1
      for update skip locked)
  returning *
$$;
revoke execute on function public.claim_check() from public, anon, authenticated;
grant execute on function public.claim_check() to service_role;
