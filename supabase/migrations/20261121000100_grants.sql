-- Droits d'accès aux tables : les projets Supabase récents n'en accordent plus par défaut.
-- Comptes connectés (authenticated) et scripts du PC (service_role) : accès aux tables, filtré
-- ligne par ligne par la RLS. Visiteurs (anon) : aucun droit, rien n'est lisible sans compte.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;

-- claim_check reste réservé au solveur (service_role), recherche et demandes aux comptes connectés.
revoke execute on function public.claim_check() from public, anon, authenticated;
grant execute on function public.claim_check() to service_role;
revoke execute on function public.search(text), public.pending_requests() from anon;
