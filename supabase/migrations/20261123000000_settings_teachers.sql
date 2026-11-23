-- Paramètres et annuaire des professeurs.
-- 1. Emploi du temps : plusieurs calendriers par membre (Boostcamp et Outlook), affichés ensemble.
-- 2. Professeurs : noms relevés dans les emplois du temps (« Enseignant : … »), e-mails renseignés
--    par les membres. Lecture et écriture réservées aux comptes validés ; suppression : admin.

alter table public.calendar_links add column source text not null default 'boostcamp'
  check (source in ('boostcamp', 'outlook'));
alter table public.calendar_links drop constraint calendar_links_pkey;
alter table public.calendar_links add primary key (user_id, source);

create table public.teachers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  email text check (email is null or (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  subjects text[] not null default '{}',
  updated_by uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index teachers_name_lower_idx on public.teachers (lower(name));

alter table public.teachers enable row level security;
create policy teachers_select on public.teachers for select to authenticated using (public.is_active());
create policy teachers_insert on public.teachers for insert to authenticated with check (public.is_active());
create policy teachers_update on public.teachers for update to authenticated
  using (public.is_active()) with check (public.is_active());
create policy teachers_delete on public.teachers for delete to authenticated using (public.is_admin());
grant select, insert, update, delete on public.teachers to authenticated;
grant all on public.teachers to service_role;

-- Ajoute les professeurs relevés dans un emploi du temps (nouveaux noms, nouvelles matières).
-- Security invoker : la RLS s'applique (compte validé requis).
create function public.register_teachers(items jsonb) returns void
language sql volatile security invoker set search_path = public as $$
  insert into public.teachers as t (name, subjects)
  select trim(i ->> 'name'), coalesce(array(select jsonb_array_elements_text(i -> 'subjects')), '{}')
    from jsonb_array_elements(items) i
   where char_length(trim(i ->> 'name')) between 2 and 80
  on conflict ((lower(name))) do update
    set subjects = array(select distinct s from unnest(t.subjects || excluded.subjects) s order by s)
    where not (excluded.subjects <@ t.subjects)
$$;
revoke execute on function public.register_teachers(jsonb) from public, anon;
grant execute on function public.register_teachers(jsonb) to authenticated;
