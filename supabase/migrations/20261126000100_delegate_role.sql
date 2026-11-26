-- Rôle « délégué(e) » : un élève qui modère pour la classe, sans les droits d'administration
-- (comptes, matières, rôles restent à l'administrateur).
--  - devoirs, projets finaux et contrôles : supprime ceux de n'importe qui (et leurs pièces jointes) ;
--  - bibliothèque : renomme, change de matière ou de catégorie, supprime n'importe quel document ;
--  - signalements de tests d'exercices : les voit, corrige les tests, les marque traités.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'delegate', 'member'));

-- Administrateur ou délégué(e), compte actif.
create function public.is_moderator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active' and role in ('admin', 'delegate'))
$$;
revoke all on function public.is_moderator() from public, anon;
grant execute on function public.is_moderator() to authenticated, service_role;

-- Devoirs et projets finaux.
drop policy homeworks_update on public.homeworks;
create policy homeworks_update on public.homeworks for update to authenticated
  using (public.is_moderator() or (public.is_active() and author_id = auth.uid()))
  with check (public.is_moderator() or (public.is_active() and author_id = auth.uid()));
drop policy homeworks_delete on public.homeworks;
create policy homeworks_delete on public.homeworks for delete to authenticated
  using (public.is_moderator() or (public.is_active() and author_id = auth.uid()));
drop policy homework_attachments_delete on public.homework_attachments;
create policy homework_attachments_delete on public.homework_attachments for delete to authenticated
  using (public.is_moderator() or (public.is_active() and author_id = auth.uid()));

-- Contrôles (ceux de l'emploi du temps restent intouchables).
drop policy exams_update on public.exams;
create policy exams_update on public.exams for update to authenticated
  using (source = 'manual' and (public.is_moderator() or (public.is_active() and author_id = auth.uid())))
  with check (source = 'manual' and (public.is_moderator() or (public.is_active() and author_id = auth.uid())));
drop policy exams_delete on public.exams;
create policy exams_delete on public.exams for delete to authenticated
  using (source = 'manual' and (public.is_moderator() or (public.is_active() and author_id = auth.uid())));
drop policy exam_attachments_delete on public.exam_attachments;
create policy exam_attachments_delete on public.exam_attachments for delete to authenticated
  using (public.is_moderator() or (public.is_active() and author_id = auth.uid()));

-- Bibliothèque.
drop policy documents_update on public.documents;
create policy documents_update on public.documents for update to authenticated
  using (public.is_moderator() or (public.is_active() and author_id = auth.uid()))
  with check (public.is_moderator() or (public.is_active() and author_id = auth.uid()));
drop policy documents_delete on public.documents;
create policy documents_delete on public.documents for delete to authenticated
  using (public.is_moderator() or (public.is_active() and author_id = auth.uid()));
drop policy exercises_admin_update on public.exercises;
create policy exercises_admin_update on public.exercises for update to authenticated
  using (public.is_moderator()) with check (public.is_moderator());
drop policy exercises_admin_delete on public.exercises;
create policy exercises_admin_delete on public.exercises for delete to authenticated using (public.is_moderator());
-- Document importé du PC supprimé : la synchronisation ne doit pas le remettre.
drop policy import_exclusions_admin on public.import_exclusions;
create policy import_exclusions_admin on public.import_exclusions for all to authenticated
  using (public.is_moderator()) with check (public.is_moderator());
drop policy files_delete on storage.objects;
create policy files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'files' and (public.is_moderator() or (public.is_active() and owner = auth.uid())));

create or replace function public.documents_category_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.category is distinct from old.category and auth.uid() is not null and not public.is_moderator() then
    raise exception 'Seul un administrateur ou un délégué peut changer la catégorie d''un document';
  end if;
  return new;
end;
$$;

-- Signalements de tests et correction des tests.
drop policy exercise_checks_admin on public.exercise_checks;
create policy exercise_checks_admin on public.exercise_checks for update to authenticated
  using (public.is_moderator()) with check (public.is_moderator());
drop policy check_reports_select on public.check_reports;
create policy check_reports_select on public.check_reports for select to authenticated
  using (public.is_moderator() or (public.is_active() and user_id = auth.uid()));
drop policy check_reports_admin on public.check_reports;
create policy check_reports_admin on public.check_reports for update to authenticated
  using (public.is_moderator()) with check (public.is_moderator());
