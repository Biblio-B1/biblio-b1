-- Canal Telegram de la classe. Tables réservées à l'Edge Function `channel` (service_role) :
-- RLS activée sans aucune politique, donc illisibles depuis le site.
--  - channel_outbox : documents et devoirs ajoutés, en attente de publication (remplie par triggers) ;
--  - timetable_watch : dernier état connu des séances Boostcamp à venir (détection des changements) ;
--  - channel_alerts : alertes de contrôle déjà publiées (pas de doublon) ;
--  - app_settings : réglages (identifiant du canal, état du dernier relevé).
-- La tâche planifiée (pg_cron + pg_net) qui appelle la fonction est créée à part (README), car
-- elle contient un secret.

create table public.channel_outbox (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('document', 'homework')),
  ref uuid not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index channel_outbox_pending_idx on public.channel_outbox (created_at) where sent_at is null;

create table public.timetable_watch (
  uid text primary key,
  snap jsonb not null,
  start_at timestamptz not null,
  last_seen timestamptz not null default now()
);

create table public.channel_alerts (
  key text primary key,
  sent_at timestamptz not null default now()
);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.channel_outbox enable row level security;
alter table public.timetable_watch enable row level security;
alter table public.channel_alerts enable row level security;
alter table public.app_settings enable row level security;
revoke all on public.channel_outbox, public.timetable_watch, public.channel_alerts, public.app_settings from authenticated, anon;

create function public.channel_enqueue() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.channel_outbox (kind, ref) values (tg_argv[0], new.id);
  return new;
end;
$$;
create trigger documents_channel after insert on public.documents
  for each row execute function public.channel_enqueue('document');
create trigger homeworks_channel after insert on public.homeworks
  for each row execute function public.channel_enqueue('homework');
