-- Pièces jointes des contrôles et projets finaux (plusieurs par contrôle). Fichiers dans le bucket
-- privé « files » (uploads/<auteur>/…), comme les pièces jointes des devoirs.
-- Tout compte actif peut en joindre à n'importe quel contrôle (y compris ceux de l'emploi du temps) ;
-- seul l'auteur de la pièce jointe ou un admin la retire.

create table public.exam_attachments (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  path text not null check (path like 'uploads/%'),
  name text not null check (char_length(name) between 1 and 255),
  mime text not null,
  size integer not null check (size > 0),
  author_id uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index exam_attachments_exam_idx on public.exam_attachments (exam_id);

alter table public.exam_attachments enable row level security;
create policy exam_attachments_select on public.exam_attachments for select to authenticated using (public.is_active());
create policy exam_attachments_insert on public.exam_attachments for insert to authenticated
  with check (
    public.is_active() and author_id = auth.uid()
    and path like 'uploads/' || auth.uid()::text || '/%'
  );
create policy exam_attachments_delete on public.exam_attachments for delete to authenticated
  using (public.is_admin() or (public.is_active() and author_id = auth.uid()));
