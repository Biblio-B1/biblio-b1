-- Catégorie choisie à la main (par un administrateur, depuis la bibliothèque). null : catégorie
-- détectée automatiquement (titre, dossier d'origine…). La synchronisation du PC ne touche pas
-- cette colonne (elle n'écrit que les siennes).
alter table public.documents add column category text
  check (category is null or category in ('course', 'exercises', 'corrections', 'exams', 'projects', 'notes', 'photos', 'syllabus'));

-- Seul un administrateur change la catégorie (l'auteur peut modifier le reste de son document).
create function public.documents_category_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.category is distinct from old.category and auth.uid() is not null and not public.is_admin() then
    raise exception 'Seul un administrateur peut changer la catégorie d''un document';
  end if;
  return new;
end;
$$;
create trigger documents_category_guard before update on public.documents
  for each row execute function public.documents_category_guard();
