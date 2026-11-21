# Biblio B1 sur github.io + Supabase — conception

Date : 2026-11-21 · Statut : approuvée par l'utilisateur (« Oui, vas-y »)

## Intention

Ne plus héberger de serveur (Chromebook ou PC allumé, Tailscale, systemd) : la promo accède au site
par une adresse fixe `https://biblio-b1.github.io/biblio-b1/`. Le site reste une bibliothèque d'étude
privée de la promo : documents du prof (dont certains « NE PAS DIFFUSER ») visibles **seulement une
fois connecté**, entraînement avec exécution de code, emploi du temps Boostcamp, questions, devoirs.

## Exigences de l'utilisateur (verbatim résumé)

1. Accès par un lien github.io, aucun serveur hébergé.
2. Une fois connecté, chacun a accès à **tous** les documents.
3. Chacun peut lier son emploi du temps (lien `.ics` Boostcamp).
4. **À chaque connexion**, l'administrateur reçoit une notification avec le nom de la personne.
5. À la création de compte, le mot de passe est **saisi deux fois** (confirmation).
6. Première inscription : l'administrateur **valide** l'accès (déjà en place, notification ntfy).
   Les reconnexions suivantes ne redemandent **jamais** d'accès.
7. **Session de 15 minutes** : ensuite, reconnexion avec son mot de passe.
8. Qwen (Ollama sur le PC de l'administrateur) continue de pré-calculer les vérifications, et traite
   automatiquement chaque nouvel exercice.

## Non-objectifs

- Pas de serveur Node/Next en production ; pas de Tailscale, pas de systemd.
- Pas de garantie que les étudiants ne voient pas les sorties attendues des tests cachés : toute la
  vérification se fait dans le navigateur (accepté : site d'entraînement, pas d'examen).
- Pas d'hébergement des documents sur GitHub (dépôt public = code uniquement).

## Anti-objectifs (échec même si « ça marche »)

- Un document lisible sans compte validé (URL de fichier devinable, table lisible en anonyme).
- Un secret dans le dépôt public (topic ntfy, clé `service_role`, clé de chiffrement, liens `.ics`).
- Un compte en attente qui peut lire quoi que ce soit.

## Contraintes mesurées

- Organisation GitHub `Biblio-B1` en offre **gratuite**, dépôt **privé** : GitHub Pages exige un dépôt
  **public** → le dépôt devient public (confirmation explicite de l'utilisateur avant, historique
  vérifié sans secret).
- Supabase gratuit : 500 Mo de base (actuel : 6,5 Mo), 1 Go de fichiers (actuel : 139 Mo),
  50 000 utilisateurs actifs/mois ; projet mis en pause après 7 jours sans requête.
- GitHub Pages : site ≤ 1 Go, fichiers ≤ 100 Mo ; moteurs WASM 113 Mo au total, plus gros fichier
  72 Mo (`llvm.core.wasm`) : OK. Pas d'en-têtes HTTP personnalisés (pas de COOP/COEP : les moteurs
  actuels n'en ont pas besoin).
- Next.js 15 en **export statique** (`output: "export"`, `basePath: "/biblio-b1"`) : pas de server
  actions, pas de route handlers, pas de middleware, pas de pages dynamiques non générées → routes à
  identifiant via paramètres de requête (`/doc?id=…`, `/training/exercise?id=…`).

## Approches considérées

| Approche | Pour | Contre |
|---|---|---|
| **github.io + Supabase** (retenue) | Aucun serveur, adresse fixe, gratuit, comptes/RLS/stockage privé intégrés | Réécriture de toute la couche serveur ; dépôt public |
| github.io → redirection vers le serveur actuel | Presque rien à réécrire | Une machine doit rester allumée : contraire à l'exigence 1 |
| Hébergeur cloud gratuit (Render, Fly…) | Réécriture moyenne | Pas github.io ; SQLite non persistant, mise en veille |

Choix de l'utilisateur : github.io + Supabase.

## Architecture

```
Navigateur (github.io, pages statiques Next)
  ├─ supabase-js : Auth (e-mail + mot de passe), Postgres (RLS), Storage (bucket privé)
  ├─ moteurs WASM (clang, Pyodide, JS) : exécution et vérification du code, inchangés
  └─ Edge Functions Supabase :
       ├─ notify   : notification ntfy (connexion, demande de compte) — topic secret côté serveur
       └─ calendar : lier / synchroniser un flux .ics (fetch côté serveur, lien chiffré)
PC de l'administrateur (clé service_role dans .env local, jamais publiée)
  ├─ npm run import  : dépôt du prof + dossiers locaux → Postgres + Storage
  ├─ npm run solver  : Qwen (Ollama) lit les exercices en attente dans Postgres, écrit les tests
  └─ npm run migrate:supabase : transfert unique de la base SQLite et de storage/ actuels
```

### Comptes et sessions

- Supabase Auth, e-mail + mot de passe, **confirmation d'e-mail désactivée** (la validation admin
  la remplace). Formulaire d'inscription : e-mail, pseudo, mot de passe, **confirmation** (doivent
  être identiques, vérifié dans le navigateur avant envoi).
- Table `profiles` (1 ligne par `auth.users`, créée par trigger à l'inscription) : `name`, `role`
  (`admin|member`), `status` (`pending|active`). Pseudo unique (insensible à la casse).
- **Validation** : un compte `pending` ne lit rien (RLS). L'admin voit les demandes, accepte
  (`status = active`) ou refuse (suppression du compte via Edge Function admin, car supprimer dans
  `auth.users` exige la clé `service_role`).
- **15 minutes** : déconnexion après **15 minutes sans activité** (souris, clavier, toucher,
  navigation), et à la réouverture si la dernière activité date de plus de 15 minutes. Implémenté côté
  navigateur (le délai d'inactivité serveur de Supabase est réservé aux offres payantes). Reconnexion
  avec le mot de passe, sans nouvelle validation.
- **Notification à chaque connexion** : après une connexion réussie (mot de passe), le navigateur
  appelle `notify` avec son jeton ; la fonction vérifie le jeton, lit le pseudo dans `profiles` et
  publie sur ntfy (« Biblio B1 : <pseudo> s'est connecté »). Demande de compte : même fonction
  (« <pseudo> demande un accès »). Le topic ntfy est un secret de la fonction. Un échec de
  notification ne bloque jamais la connexion.
- Premier administrateur : le compte de l'utilisateur, passé `admin` + `active` par le script de
  migration (pas de page `/setup`). Les invitations sont supprimées (remplacées par la validation).

### Données et droits (RLS)

Tables Postgres reprenant le schéma SQLite (types adaptés : `uuid`, `timestamptz`, `jsonb`,
`boolean`) : `subjects`, `documents`, `exercises`, `progress`, `threads`, `posts`,
`import_exclusions`, `exercise_checks`, `check_reports`, `code_attempts`, `homeworks`,
`calendar_links`, `profiles`. Disparaissent : `users`, `sessions`, `invites` (Supabase Auth).

Fonction SQL `is_active()` / `is_admin()` (lisent `profiles` pour `auth.uid()`). Règles :

- Lecture de tout le contenu partagé (matières, documents, exercices, vérifications, fils, messages,
  devoirs) : `is_active()`.
- Écriture « à soi » : progression, tentatives de code, lien de calendrier (lecture aussi limitée à
  soi), messages et fils dont on est l'auteur, documents déposés.
- Administration (matières, validation des comptes, vérification/édition des tests, signalements,
  suppression de documents des autres) : `is_admin()`.
- Rien pour `anon` ni pour un compte `pending`, sauf lire **son propre** profil (pour afficher
  « en attente »).
- Storage : bucket **privé** `files` ; lecture `is_active()` ; dépôt par un compte actif dans
  `uploads/<uid>/…` ; les fichiers sont servis par URL signée (durée courte), jamais publique.
- Le PC (import, solveur, migration) utilise la clé `service_role` (contourne la RLS), stockée
  uniquement dans le `.env` local.

### Recherche

FTS5 → Postgres `tsvector` (configuration `french`, `unaccent`) sur documents, exercices et fils,
exposée par une fonction RPC `search(q text)` soumise à la RLS (`security invoker`).

### Dépôt de fichiers et fiches

Le navigateur envoie le fichier au bucket, extrait le texte (pdf.js, déjà présent) et classe la matière
avec `classify.ts` (code pur, règles lues dans `subjects`), puis insère le document et ses exercices
(`extract/exercises.ts`, code pur). Les nouveaux exercices sont insérés avec une vérification
`pending` : Qwen les traite dès que le PC est allumé (le solveur interroge Postgres en boucle).
Les fiches (Markdown) et images de messages suivent le même chemin.

### Emploi du temps

Edge Function `calendar` : `link` (valide l'URL HTTPS publique, la récupère, chiffre l'URL en
AES-256-GCM avec un secret de fonction, stocke événements + URL chiffrée), `sync`, `unlink`. Le
navigateur lit ses événements dans `calendar_links` (RLS : soi uniquement). Reprend la logique de
`src/server/boostcamp/calendar.ts` (analyse ICS, garde-fous anti-SSRF, taille maximale).

### Front-end

Export statique de l'app Next existante : mêmes composants et styles ; les pages serveur deviennent
des composants client qui lisent via supabase-js ; les server actions deviennent des fonctions client
(`src/lib/api/*.ts`) ; garde d'accès côté client (`RequireAuth`, `RequireAdmin`) — la vraie barrière
reste la RLS. Routes dynamiques remplacées par des paramètres de requête. Déploiement : workflow
GitHub Actions (build + `copy-runtimes` + publication Pages) à chaque push sur `main`. La clé
publique (`anon`) et l'URL du projet sont des variables de build (non secrètes).

### Migration et transition

1. Script `migrate:supabase` : copie sujets, documents (+ fichiers vers Storage), exercices,
   vérifications Qwen, progression et fils de l'admin ; crée le profil admin.
2. Les autres comptes actuels (test) ne sont pas migrés : les camarades s'inscrivent sur github.io.
3. Le site Next actuel reste dans l'historique git (tag `serveur-node`) ; le code serveur inutile est
   retiré à la fin.

## Ce que l'utilisateur doit faire (guidé)

1. Créer un projet gratuit sur supabase.com ; fournir l'URL du projet et la clé `anon` (publiques),
   mettre la clé `service_role` dans son `.env` local.
2. Installer la CLI Supabase (déploiement des migrations SQL et des Edge Functions) ou coller le SQL
   dans l'éditeur du tableau de bord.
3. Confirmer le passage du dépôt en public, puis activer Pages (source : GitHub Actions).

## Laissé au constructeur

Découpage exact des composants client, nommage des fonctions `src/lib/api`, choix de la bibliothèque
de requêtes (aucune imposée : supabase-js direct), présentation de la page « compte en attente ».

## Décisions prises par Claude (à vérifier par l'utilisateur)

- 15 minutes **d'inactivité** (et non 15 minutes après la connexion).
- Notification à chaque connexion **par mot de passe** ; pas à chaque rafraîchissement de page.
- Invitations supprimées ; refus d'une demande = suppression du compte.
- Sorties attendues des tests visibles par un étudiant curieux (vérification dans le navigateur).
