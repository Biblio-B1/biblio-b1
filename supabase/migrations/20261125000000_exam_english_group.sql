-- Contrôles d'anglais : groupe concerné (plusieurs groupes d'anglais), comme pour les devoirs.
-- Obligatoire sur le site pour une matière d'anglais ; pour l'emploi du temps Boostcamp, repris du
-- champ « TD » de la séance.
alter table public.exams add column english_group text
  check (english_group is null or char_length(english_group) <= 120);
