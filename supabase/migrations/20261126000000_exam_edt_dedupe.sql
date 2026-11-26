-- Contrôles de l'emploi du temps en double : Index-Education met le nom de l'élève dans l'identifiant
-- de séance (« Cours-2037424-20-DUPONT_Jean-Index-Education »), donc une ligne par élève lié.
-- On garde une ligne par séance, identifiée sans le nom (« Cours-2037424-20 »), et on reporte
-- les alertes déjà envoyées sur la nouvelle clé pour ne pas les renvoyer.

begin;

create temporary table exam_edt_map on commit drop as
select id, edt_uid as old_uid,
       regexp_replace(edt_uid, '^(Cours-[0-9]+-[0-9]+)-.+-Index-Education$', '\1') as new_uid,
       row_number() over (
         partition by regexp_replace(edt_uid, '^(Cours-[0-9]+-[0-9]+)-.+-Index-Education$', '\1')
         order by created_at, id
       ) as rank
from public.exams
where source = 'edt';

insert into public.channel_alerts (key, sent_at)
select 'edt:' || m.new_uid || substr(a.key, length('edt:' || m.old_uid) + 1), min(a.sent_at)
from public.channel_alerts a
join exam_edt_map m on a.key like 'edt:' || m.old_uid || ':%'
where m.old_uid <> m.new_uid
group by 1
on conflict (key) do nothing;

-- Les pièces jointes ajoutées sur une copie passent sur la ligne gardée.
update public.exam_attachments x set exam_id = keep.id
from exam_edt_map dup
join exam_edt_map keep on keep.new_uid = dup.new_uid and keep.rank = 1
where x.exam_id = dup.id and dup.rank > 1;

delete from public.exams e using exam_edt_map m where e.id = m.id and m.rank > 1;

update public.exams e set edt_uid = m.new_uid
from exam_edt_map m
where e.id = m.id and m.rank = 1 and m.old_uid <> m.new_uid;

commit;
