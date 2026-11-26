-- Compte Outlook (Microsoft) lié par l'élève : seulement l'adresse, pour afficher « Lié : … ».
-- Table à part (et non profiles, lisible par toute la classe) : chacun ne voit que sa ligne.
-- Aucun jeton n'est conservé.
create table public.outlook_links (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  email text not null check (length(email) <= 254 and email like '%@%'),
  name text check (name is null or length(name) <= 200),
  linked_at timestamptz not null default now()
);

alter table public.outlook_links enable row level security;
create policy outlook_links_own on public.outlook_links for all to authenticated
  using (user_id = auth.uid() and public.is_active())
  with check (user_id = auth.uid() and public.is_active());
grant select, insert, update, delete on public.outlook_links to authenticated, service_role;
