-- Plusieurs pièces jointes par devoir (et projet final), comme pour les contrôles. Fichiers dans le
-- bucket privé « files » (uploads/<auteur>/…). Tout compte actif peut en joindre à un devoir ;
-- seul l'auteur de la pièce jointe ou un admin la retire.
-- Les anciennes colonnes homeworks.attachment_* (une seule pièce jointe) sont recopiées ici, puis
-- ne sont plus utilisées par le site.

create table public.homework_attachments (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references public.homeworks (id) on delete cascade,
  path text not null check (path like 'uploads/%'),
  name text not null check (char_length(name) between 1 and 255),
  mime text not null,
  size integer not null check (size > 0),
  author_id uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index homework_attachments_homework_idx on public.homework_attachments (homework_id);

alter table public.homework_attachments enable row level security;
create policy homework_attachments_select on public.homework_attachments for select to authenticated using (public.is_active());
create policy homework_attachments_insert on public.homework_attachments for insert to authenticated
  with check (
    public.is_active() and author_id = auth.uid()
    and path like 'uploads/' || auth.uid()::text || '/%'
  );
create policy homework_attachments_delete on public.homework_attachments for delete to authenticated
  using (public.is_admin() or (public.is_active() and author_id = auth.uid()));

insert into public.homework_attachments (homework_id, path, name, mime, size, author_id, created_at)
select id, attachment_path, attachment_name, coalesce(attachment_mime, 'application/octet-stream'),
       greatest(coalesce(attachment_size, 1), 1), author_id, created_at
from public.homeworks
where attachment_path is not null and attachment_name is not null;

-- « Fait » : chaque élève coche ses devoirs ; personne d'autre ne voit ni ne modifie ses coches.
create table public.homework_done (
  homework_id uuid not null references public.homeworks (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  done_at timestamptz not null default now(),
  primary key (homework_id, user_id)
);
create index homework_done_user_idx on public.homework_done (user_id);

alter table public.homework_done enable row level security;
create policy homework_done_select on public.homework_done for select to authenticated
  using (user_id = auth.uid() and public.is_active());
create policy homework_done_insert on public.homework_done for insert to authenticated
  with check (user_id = auth.uid() and public.is_active());
create policy homework_done_delete on public.homework_done for delete to authenticated
  using (user_id = auth.uid());
