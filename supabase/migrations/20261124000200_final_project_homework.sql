-- Projet final : n'est plus un type de contrôle mais une case à cocher sur un devoir. Le devoir reste
-- un devoir (page Devoirs, pièce jointe, date de rendu) ; le canal Telegram l'annonce comme projet
-- final et le rappelle comme un contrôle (3, 2, 1 semaine(s) avant et la veille).
alter table public.homeworks add column is_final_project boolean not null default false;

-- L'onglet Contrôles ne contient plus que des contrôles (aucun projet n'y avait été saisi).
update public.exams set kind = 'controle' where kind <> 'controle';
alter table public.exams drop constraint exams_kind_check;
alter table public.exams add constraint exams_kind_check check (kind = 'controle');
