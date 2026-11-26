-- Annonce immédiate des devoirs et contrôles ajoutés sur le site.
--  - channel_flush() : appelée par le site juste après un ajout (pièces jointes comprises) ; demande à
--    la fonction `channel` de publier la file d'envoi tout de suite, sans attendre le passage de 5 min.
--    Ne fait rien s'il n'y a rien à publier (pas d'appel inutile).
--  - channel_claim_outbox() : la fonction réserve les lignes qu'elle publie (claimed_at), pour qu'un
--    passage planifié et une publication immédiate simultanés n'envoient pas deux fois le même message.

alter table public.channel_outbox add column claimed_at timestamptz;

create function public.channel_claim_outbox(settle_seconds int default 0)
returns table (id bigint, kind text, ref uuid, created_at timestamptz)
language sql volatile security definer set search_path = public as $$
  update public.channel_outbox o
     set claimed_at = now()
   where o.id in (
     select c.id from public.channel_outbox c
      where c.sent_at is null
        and (c.claimed_at is null or c.claimed_at < now() - interval '2 minutes')
        and c.created_at < now() - make_interval(secs => settle_seconds)
      order by c.id
      limit 1000
      for update skip locked
   )
  returning o.id, o.kind, o.ref, o.created_at
$$;
revoke all on function public.channel_claim_outbox(int) from public, anon, authenticated;
grant execute on function public.channel_claim_outbox(int) to service_role;

create function public.channel_flush() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active() then
    return;
  end if;
  if not exists (select 1 from public.channel_outbox where sent_at is null and claimed_at is null) then
    return;
  end if;
  perform net.http_post(
    url := 'https://iwztvxkovnvcqgiaqacq.supabase.co/functions/v1/channel',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'channel_cron_secret')
    ),
    body := '{"outboxOnly": true}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;
revoke all on function public.channel_flush() from public, anon;
grant execute on function public.channel_flush() to authenticated;
