-- Annuaire des élèves : membres validés du site. L'e-mail (stocké dans auth.users, illisible par
-- le site) n'apparaît que si l'élève l'a choisi dans ses paramètres (show_email).
alter table public.profiles add column show_email boolean not null default false;

create function public.directory_students()
returns table (id uuid, name text, email text, role text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, case when p.show_email then u.email::text end, p.role, p.created_at
    from public.profiles p join auth.users u on u.id = p.id
   where p.status = 'active' and public.is_active()
   order by lower(p.name)
$$;
revoke execute on function public.directory_students() from public, anon;
grant execute on function public.directory_students() to authenticated;
