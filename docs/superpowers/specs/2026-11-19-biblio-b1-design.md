# Biblio B1 — Document de conception

Référence fonctionnelle complète : `consignes.md`. Ce document fixe les choix d'architecture validés le 2026-11-19.

## Intention
Plateforme web auto-hébergée (ChromeOS / Crostini) pour la promo B1 : bibliothèque de cours classée par matière, espace d'entraînement alimenté par import automatique, entraide Q&A, recherche instantanée. Accès sur invitation.

## Objectifs / non-objectifs
- Objectifs : tout ce que liste `consignes.md` §3–§7.
- Non-objectifs v1 : OCR des PDF scannés, conversion .pptx/.docx en PDF (LibreOffice trop lourd), temps réel (websockets), notifications e-mail.
- Anti-objectifs : dépendance à un service cloud, déploiement complexe, doublons à chaque ré-import.

## Approches envisagées
1. **Next.js App Router monolithique + SQLite (retenue)** — un seul processus, API par route handlers / server actions, démarrage `npm start`. Écosystème riche (react-pdf, cmdk, Shiki).
2. SvelteKit + SQLite — plus léger, mais écosystème de composants (visionneuse PDF, palette de commandes) moins fourni.
3. API séparée (Fastify) + SPA — deux processus à gérer sur Crostini, sans bénéfice ici.

## Stack
- Next.js (App Router) + TypeScript strict, Tailwind CSS, primitives Radix UI.
- SQLite : `better-sqlite3` + Drizzle ORM ; table virtuelle FTS5 (`search_index`) mise à jour à chaque création/modification.
- Validation des entrées : `zod`.
- Auth : mots de passe `@node-rs/argon2`, sessions en base, cookie httpOnly/SameSite=Lax.
- Fichiers : `./storage/uploads/` (dépôts), `./storage/sources/` (clone du dépôt C), `./storage/data.db`.

## Modèle de données (principal)
users, sessions, invites (jeton haché, max_uses, uses, expires_at, revoked), subjects (nom, slug, couleur, règles de classement JSON), documents (titre, type, matière, chemin, mime, sha256, texte extrait, source: upload|local|github, auteur), exercises (document source, numéro, titre, énoncé, correction, indices, langue, groupe FR/EN), progress (user, exercise, statut todo|doing|mastered), threads (cible: document|exercise, question, auteur), posts (markdown, image optionnelle, épinglé, note de synthèse), search_index (FTS5).

## Classification automatique
Score par matière = motifs regex sur nom/chemin (poids fort) + mots-clés pondérés dans le texte extrait. Matière au score max proposée ; confirmation/correction en un clic. Règles éditables par l'admin.

## Pipeline d'import (`npm run import`)
1. Clone ou `pull` de `C_PROF_REPO_URL` via `simple-git`.
2. Scan de `./sources/local/` (dossiers de cours locaux) et du clone.
3. Décompression des .zip dans un dossier temporaire du storage.
4. Extraction de texte : `pdfjs-dist` (PDF), `mammoth` (.docx), lecture directe (.md, .c, .h, .txt). .pptx : stocké en téléchargement, sans aperçu.
5. Appariement énoncé ↔ corrigé (`(corrigé)`, `CORRECTION`, `correction`) et FR ↔ EN (paires de noms dans `LAB_GENERAL`).
6. Découpage en exercices sur les titres `Exercice N` / `Exercise N` / `Exo N`.
7. Idempotence par sha256 du fichier.
Ignorés : .exe, .o, .cbp, .depend, `000_TEMPLATE`.

Correspondance du dépôt prof : `ARCHIVE/2026/NN_*` → chapitres (Cours/TD/TP), `EXERCISES/` → exercices, `EXAMS/` → annales (`0. Inspirations` importé avec l'étiquette « externe »), `COURSES/`, `HOMEWORKS/`, `PROJECTS/`, `SYLLABUS/` → cours/projets.

## UI
Style épuré Notion/Linear ; Inter pour l'interface, JetBrains Mono pour le code ; thème clair blanc cassé / sombre contrasté via `class="dark"` ; responsive avec bouton d'appareil photo (`capture="environment"`) sur mobile. Visionneuses : `react-pdf`, Markdown (`react-markdown` + Shiki + KaTeX), galerie zoomable. Recherche `Ctrl/Cmd+K` via `cmdk`, filtres matière / type / auteur / date.

## Déploiement
`npm install && npm run build && npm start` ; unité systemd fournie ; README : redirection de port Crostini, sauvegarde de `storage/`.

## Décisions prises par l'agent (à vérifier)
- Matières initiales : Programmation C, Systèmes Linux, Mathématiques, Architecture des ordinateurs, Anglais (modifiables).
- Dossiers locaux lus depuis `./sources/local/` (aucun présent à ce jour).
- `EXAMS/0. Inspirations` importé, étiqueté « externe ».
- Pas d'OCR en v1 : PDF scannés visibles mais non indexés.

## Laissé au constructeur
Détails de mise en page, libellés, structure exacte des composants.
