-- Contrôles et projets finaux (onglet « Contrôles »).
--  - source 'manual' : ajouté par un élève depuis le site (annoncé dans le canal Telegram) ;
--  - source 'edt'    : séance « EVALUATION » de l'emploi du temps Boostcamp, recopiée par l'Edge
--    Function `channel` (service_role) à chaque relevé ; edt_uid = identifiant de la séance.
-- Heures : heure de Paris (start_time / end_time facultatives).

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'controle' check (kind in ('controle', 'projet')),
  subject_id uuid references public.subjects (id) on delete set null,
  subject_label text check (subject_label is null or char_length(subject_label) <= 200),
  title text not null default '' check (char_length(title) <= 300),
  exam_date date not null,
  start_time time,
  end_time time,
  location text check (location is null or char_length(location) <= 200),
  details text check (details is null or char_length(details) <= 2000),
  source text not null default 'manual' check (source in ('manual', 'edt')),
  edt_uid text unique,
  author_id uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((source = 'edt') = (edt_uid is not null)),
  check (end_time is null or start_time is null or end_time > start_time),
  check (subject_id is not null or subject_label is not null)
);
create index exams_date_idx on public.exams (exam_date);

alter table public.exams enable row level security;
create policy exams_select on public.exams for select to authenticated using (public.is_active());
create policy exams_insert on public.exams for insert to authenticated
  with check (public.is_active() and author_id = auth.uid() and source = 'manual');
create policy exams_update on public.exams for update to authenticated
  using (source = 'manual' and (public.is_admin() or (public.is_active() and author_id = auth.uid())))
  with check (source = 'manual' and (public.is_admin() or (public.is_active() and author_id = auth.uid())));
create policy exams_delete on public.exams for delete to authenticated
  using (source = 'manual' and (public.is_admin() or (public.is_active() and author_id = auth.uid())));

-- Annonce dans le canal : seulement les ajouts faits sur le site (les séances de l'emploi du temps
-- sont déjà annoncées comme « cours ajouté » et ont leurs alertes J-7 / veille).
alter table public.channel_outbox drop constraint channel_outbox_kind_check;
alter table public.channel_outbox add constraint channel_outbox_kind_check check (kind in ('document', 'homework', 'exam'));
create trigger exams_channel after insert on public.exams
  for each row when (new.source = 'manual') execute function public.channel_enqueue('exam');
