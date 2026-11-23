-- Professeurs retirés de l'annuaire : masqués plutôt que supprimés, sinon le relevé automatique
-- des emplois du temps (register_teachers) les recréerait. Seul un administrateur masque ou réaffiche.
alter table public.teachers add column hidden boolean not null default false;

create function public.teachers_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.hidden is distinct from old.hidden and auth.uid() is not null and not public.is_admin() then
    raise exception 'Seul un administrateur peut retirer un professeur de l''annuaire';
  end if;
  return new;
end;
$$;
create trigger teachers_guard before update on public.teachers
  for each row execute function public.teachers_guard();

update public.teachers set hidden = true
 where lower(name) in ('bouveret grimaud', 'm. réus gérard', 'mme asselah kenza katia', 'mme el memi malak');
