-- Mode invité : bouton « Visiter en invité » sur la page de connexion (connexion anonyme Supabase,
-- à activer dans Authentication → Sign In / Providers → « Allow anonymous sign-ins »).
--  - un compte anonyme reçoit un profil role 'guest', status 'active' : il lit tout le contenu partagé ;
--  - il n'écrit rien : politiques RESTRICTIVES sur toutes les tables de `public` et sur
--    storage.objects (insertion, modification, suppression refusées), quelles que soient les
--    politiques permissives existantes ;
--  - il n'apparaît pas dans l'annuaire des élèves.
-- Toute nouvelle table devra recevoir les mêmes politiques (voir la boucle ci-dessous).

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'delegate', 'member', 'guest'));

create function public.is_guest() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'guest')
$$;
revoke all on function public.is_guest() from public, anon;
grant execute on function public.is_guest() to authenticated, service_role;

-- Inscription : compte anonyme → invité actif ; sinon profil « pending » comme avant.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((to_jsonb(new) ->> 'is_anonymous')::boolean, false) then
    insert into public.profiles (id, name, role, status)
    values (new.id, 'Invité ' || left(replace(new.id::text, '-', ''), 8), 'guest', 'active');
  else
    insert into public.profiles (id, name) values (new.id, trim(coalesce(new.raw_user_meta_data ->> 'name', '')));
  end if;
  return new;
end;
$$;

-- Lecture seule pour les invités, sur toutes les tables protégées par la RLS.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and rowsecurity loop
    execute format('create policy guest_no_insert on public.%I as restrictive for insert to authenticated with check (not public.is_guest())', t.tablename);
    execute format('create policy guest_no_update on public.%I as restrictive for update to authenticated using (not public.is_guest()) with check (not public.is_guest())', t.tablename);
    execute format('create policy guest_no_delete on public.%I as restrictive for delete to authenticated using (not public.is_guest())', t.tablename);
  end loop;
end;
$$;

create policy guest_no_insert on storage.objects as restrictive for insert to authenticated with check (not public.is_guest());
create policy guest_no_update on storage.objects as restrictive for update to authenticated using (not public.is_guest()) with check (not public.is_guest());
create policy guest_no_delete on storage.objects as restrictive for delete to authenticated using (not public.is_guest());

-- Annuaire : les invités n'y figurent pas.
create or replace function public.directory_students()
returns table (id uuid, name text, email text, role text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, case when p.show_email then u.email::text end, p.role, p.created_at
    from public.profiles p join auth.users u on u.id = p.id
   where p.status = 'active' and p.role <> 'guest' and public.is_active()
   order by lower(p.name)
$$;
