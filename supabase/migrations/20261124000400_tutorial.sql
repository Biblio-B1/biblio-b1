-- Tutoriel de première connexion : date à laquelle l'élève l'a terminé ou passé (null : à montrer).
-- Modifiable par l'élève lui-même (politique profiles_update ; le garde ne bloque que rôle et statut).
alter table public.profiles add column tutorial_done_at timestamptz;
