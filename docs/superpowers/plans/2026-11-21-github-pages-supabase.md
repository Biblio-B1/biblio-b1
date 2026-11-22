# Biblio B1 sur github.io + Supabase — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **L'utilisateur a demandé : pas de sous-agents → superpowers:executing-plans, en ligne.**

**Goal:** Servir Biblio B1 en pages statiques sur `https://biblio-b1.github.io/biblio-b1/`, avec Supabase (Auth, Postgres + RLS, Storage, Edge Functions) à la place du serveur Next/SQLite, sans perdre les données ni Qwen.

**Architecture:** L'app Next existante passe en export statique ; ses pages serveur deviennent des composants client qui lisent Supabase via supabase-js, la sécurité reposant sur la RLS. Trois Edge Functions (Deno) couvrent ce qui exige un secret : notifications ntfy, calendriers `.ics`, refus d'un compte. Les scripts du PC (import, solveur Qwen, migration) écrivent dans Supabase avec la clé `service_role`.

**Tech Stack:** Next.js 15.5 (`output: "export"`), React 19, `@supabase/supabase-js` 2.x, Supabase CLI (migrations SQL, Edge Functions Deno), `@electric-sql/pglite` (tests RLS), vitest, GitHub Actions (Pages).

**Spec:** `docs/superpowers/specs/2026-11-21-github-pages-supabase-design.md`

## Global Constraints

- Adresse : `https://biblio-b1.github.io/biblio-b1/` → `basePath: "/biblio-b1"`, `output: "export"`, `trailingSlash: true`, `images.unoptimized: true`.
- Aucune server action, aucun route handler, aucun middleware, aucune page dynamique `[param]` dans l'app exportée : identifiants en paramètre de requête (`?id=`).
- Variables de build publiques seulement : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `NTFY_TOPIC`, `CALENDAR_ENCRYPTION_KEY`) : `.env` local du PC ou secrets des Edge Functions, **jamais** dans le dépôt ni dans le bundle.
- Compte `pending` ou visiteur : ne lit **rien** (sauf son propre profil). Compte `active` : lit tout le contenu partagé. Admin : `role = 'admin'` et `status = 'active'`.
- Mot de passe : 8 à 200 caractères, saisi deux fois à l'inscription (identiques). Pseudo : 2 à 40 caractères, sans `@`, unique sans tenir compte de la casse.
- Session : déconnexion après **15 minutes sans activité** (`INACTIVITY_MS = 15 * 60_000`), y compris à la réouverture de l'onglet.
- Notifications ntfy : « Biblio B1 : <pseudo> s'est connecté » à chaque connexion par mot de passe ; « Biblio B1 : nouvelle demande de compte » à l'inscription. Un échec n'empêche jamais la connexion.
- Fichiers : bucket Storage **privé** `files`, lus par URL signée de 1 h (`SIGNED_URL_TTL = 3600`).
- Textes de l'interface en français ; tests en vitest ; commit + push après chaque tâche (`feat/github-pages`), jamais `.env`, `.claude/`, ni la modification locale de `.env.example`.

## Review Focus

1. Accès direct à une URL de fichier ou à la table `documents` par un visiteur ou un compte `pending` → refusé (tests RLS de la tâche 1, test de l'URL signée en tâche 7).
2. Onglet laissé ouvert 20 minutes puis réutilisé, ou rouvert le lendemain → déconnecté, retour à la connexion (tests de la tâche 5).
3. Mots de passe différents dans la confirmation, ou pseudo déjà pris avec une autre casse → message clair avant tout envoi / refus serveur (tests des tâches 1 et 6).
4. ntfy injoignable, ou topic absent → la connexion réussit quand même (test de la tâche 2).
5. Lien `.ics` pointant vers une adresse privée (127.0.0.1, 10.x) ou réponse énorme → refusé par la fonction `calendar` (test de la tâche 3, logique reprise de `calendar.ts`).

---

## Lot A — Supabase (base, droits, fonctions)

### Task 1: Schéma Postgres, RLS, stockage, recherche

**Files:**
- Create: `supabase/config.toml` (via `npx supabase init`), `supabase/migrations/20261121000000_schema.sql`
- Create: `tests/supabase/harness.ts`, `tests/supabase/rls.test.ts`

**Interfaces:**
- Produces (SQL, utilisées par toutes les tâches suivantes) :
  - Tables `public.profiles(id uuid pk → auth.users, name text, role text check in ('admin','member') default 'member', status text check in ('active','pending') default 'pending', created_at timestamptz)` + index unique `lower(name)`.
  - Tables reprenant `src/server/db/schema.ts` (mêmes colonnes en snake_case, `uuid` + `gen_random_uuid()`, `timestamptz default now()`, `jsonb`, `boolean`) : `subjects`, `documents` (+ `search tsvector generated`), `exercises` (+ `search`), `progress`, `threads`, `posts`, `import_exclusions`, `exercise_checks`, `check_reports`, `code_attempts`, `homeworks`, `calendar_links(user_id pk, encrypted_url, events jsonb, synced_at)`. Clés étrangères vers utilisateur → `profiles(id)`.
  - Trigger `on_auth_user_created` : insère `profiles(id, name = raw_user_meta_data->>'name', status 'pending')`.
  - Fonctions `public.is_active() returns boolean`, `public.is_admin() returns boolean` (`security definer`, `stable`, `search_path = public`).
  - Fonction `public.search(q text) returns table(kind text, id uuid, title text, snippet text, rank real)` en `security invoker`.
  - Fonction `public.claim_check() returns exercise_checks` (`for update skip locked`, `attempts + 1`, `status 'running'`), exécutable par `service_role` seulement.
  - Trigger : insertion dans `exercises` ⇒ ligne `exercise_checks(status 'pending')`.
  - Bucket `files` privé ; politiques `storage.objects` : `select` si `is_active()`, `insert` si `is_active()` et chemin `uploads/<auth.uid()>/…`, `delete` si `is_admin()` ou propriétaire.

- [ ] **Step 1: Installer les outils** — `npm i -D supabase @electric-sql/pglite` puis `npm i @supabase/supabase-js`, `npx supabase init` (config par défaut).
- [ ] **Step 2: Écrire le harnais `tests/supabase/harness.ts`** — `createRlsDb(): Promise<{ db: PGlite; as(user: string | null): Promise<void>; signUp(email, name): Promise<string> }>` : crée dans PGlite un schéma `auth` minimal (`auth.users(id, email, raw_user_meta_data)`, `auth.uid()` lisant `current_setting('request.jwt.claim.sub', true)`), un schéma `storage` minimal (`buckets`, `objects(bucket_id, name, owner)`, `storage.foldername()`), les rôles `anon`, `authenticated`, `service_role`, puis applique la migration. `as(null)` = `set role anon` ; `as(id)` = `set role authenticated` + claim `sub`.
- [ ] **Step 3: Écrire les tests (échouent)** dans `tests/supabase/rls.test.ts` :
  - `visiteur : aucune ligne de documents, exercises, subjects, posts` → `select count(*)` = 0 et `insert` refusé.
  - `compte pending : ne lit que son profil` → documents = 0, `profiles` = 1 ligne (la sienne).
  - `compte active : lit tous les documents, mais seulement sa progression et son calendar_links`.
  - `member ne peut pas se passer admin ni active` → `update profiles set role='admin'` / `status='active'` sur soi = 0 ligne modifiée.
  - `admin valide un compte` → `update profiles set status='active' where id = <pending>` = 1 ligne.
  - `pseudo unique sans casse` → second `signUp(…, 'USER1')` lève une erreur d'unicité.
  - `storage : un compte active lit files/…, un pending non ; dépôt seulement sous uploads/<uid>/`.
  - `search('pointeur') ne renvoie rien en anonyme et renvoie le document pour un compte active`.
  - `insertion d'un exercice crée une exercise_checks pending`.
- [ ] **Step 4: Lancer** `npx vitest run tests/supabase/rls.test.ts` → FAIL (migration absente).
- [ ] **Step 5: Écrire la migration** — politiques explicites par table et par opération (`select/insert/update/delete`), aucune politique pour `anon` ; colonnes `role`/`status` de `profiles` modifiables seulement par `is_admin()` (politique `update` admin + politique `update` de soi limitée à `name` via `with check` qui compare `role`/`status` aux anciennes valeurs, ou trigger `before update` qui refuse le changement si non admin). Configuration FTS : `unaccent` + `french`.
- [ ] **Step 6: Relancer les tests** → PASS.
- [ ] **Step 7: Commit** `feat(supabase): schéma, RLS, stockage et recherche` + push.

### Task 2: Edge Function `notify`

**Files:**
- Create: `supabase/functions/_shared/notify-core.ts`, `supabase/functions/notify/index.ts`
- Test: `tests/supabase/notify-core.test.ts`

**Interfaces:**
- Produces : `buildNotification(event: "login" | "signup", name: string): { title: string; message: string; tags: string[] }` ; `publishNtfy(n, opts: { topic?: string; url: string; fetchImpl: typeof fetch }): Promise<boolean>` (reprend `src/server/notify.ts`). Fonction HTTP `POST /functions/v1/notify` corps `{ event: "login" | "signup" }`, en-tête `Authorization: Bearer <jeton utilisateur>` ; lit le pseudo dans `profiles` avec le jeton ; répond `204` même si ntfy échoue ; `401` sans jeton valide. Secrets : `NTFY_TOPIC`, `NTFY_URL` (défaut `https://ntfy.sh`), `APP_URL`.
- [ ] **Step 1: Tests (échouent)** : `buildNotification("login", "Léa")` → `{ title: "Biblio B1 : Léa s'est connecté", … }` ; `("signup", "Léa")` → titre `"Biblio B1 : nouvelle demande de compte"`, message contenant `Léa` ; `publishNtfy` sans topic → `false` sans appel ; avec un `fetchImpl` qui lève → `false` sans exception ; corps JSON avec `topic`.
- [ ] **Step 2:** `npx vitest run tests/supabase/notify-core.test.ts` → FAIL.
- [ ] **Step 3:** Implémenter `notify-core.ts` (aucune API Deno ni Node, `fetch` injecté) et `notify/index.ts` (`Deno.serve`, `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization } } })`, CORS pour `https://biblio-b1.github.io` et `http://localhost:3000`).
- [ ] **Step 4:** Tests → PASS ; `npx supabase functions serve notify` répond 401 sans jeton (vérification manuelle).
- [ ] **Step 5: Commit** `feat(supabase): fonction notify (ntfy)` + push.

### Task 3: Edge Function `calendar`

**Files:**
- Create: `supabase/functions/_shared/calendar-core.ts` (déplacé depuis `src/server/boostcamp/calendar.ts` : `parseCalendar`, `validateCalendarFeedUrl`, chiffrement AES-256-GCM via WebCrypto), `supabase/functions/calendar/index.ts`
- Modify: `tests/boostcamp-calendar.test.ts` → importe depuis `calendar-core.ts`
- Test: `tests/supabase/calendar-core.test.ts`

**Interfaces:**
- Produces : `POST /functions/v1/calendar` corps `{ action: "link", url: string } | { action: "sync" } | { action: "unlink" }`, jeton utilisateur requis et compte `active` ; écrit `calendar_links` avec la clé `service_role` côté fonction ; réponse `{ events: CalendarEvent[]; syncedAt: string } | { error: string; code?: "reauth_required" }`. Exporte `encryptUrl(url, keyHex): Promise<string>`, `decryptUrl(value, keyHex): Promise<string>`.
- [ ] **Step 1: Tests (échouent)** : aller-retour `encryptUrl`/`decryptUrl` ; texte altéré → erreur ; `validateCalendarFeedUrl("https://127.0.0.1/x.ics")` et `"https://10.0.0.2/x.ics"` → erreur « HTTPS publique » ; les cas existants de `boostcamp-calendar.test.ts` passent sur le nouveau module.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implémenter (résolution DNS : `Deno.resolveDns` dans la fonction, injectée dans le cœur pour les tests ; plafonds `MAX_FEED_BYTES = 1_000_000`, `MAX_EVENTS = 500` conservés). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(supabase): fonction calendar` + push.

### Task 4: Edge Function `admin-users` (refus d'une demande)

**Files:** Create `supabase/functions/admin-users/index.ts`. Test : `tests/supabase/admin-users.test.ts` (logique `canReject(caller, target)` exportée depuis `supabase/functions/_shared/admin-core.ts`).

**Interfaces:** `POST /functions/v1/admin-users` `{ action: "reject", userId: string }` ; appelant admin actif ; cible `pending` uniquement ; supprime via `auth.admin.deleteUser` (cascade sur `profiles`). `canReject({ role, status }, { status }): boolean`.
- [ ] **Step 1:** Tests : admin actif + cible pending → true ; member → false ; cible active → false. **Step 2:** FAIL. **Step 3:** Implémenter. **Step 4:** PASS. **Step 5: Commit** `feat(supabase): refus d'une demande de compte` + push.

## Lot B — Front statique

### Task 5: Client Supabase, export statique, session de 15 minutes

**Files:**
- Modify: `next.config.ts` (export statique, `basePath`, suppression `headers`, `serverActions`, `serverExternalPackages`)
- Create: `src/lib/supabase/client.ts`, `src/lib/auth/inactivity.ts`, `src/components/auth/AuthProvider.tsx`, `src/components/auth/RequireAuth.tsx`
- Delete: `src/middleware.ts`, `tests/middleware.test.ts`
- Test: `tests/inactivity.test.ts`

**Interfaces:**
- Produces : `getSupabase(): SupabaseClient` (singleton, `auth.persistSession: true`, `storageKey: "bb1-auth"`) ; `INACTIVITY_MS = 900_000` ; `createInactivityTracker({ now, storage, onExpire, timeoutMs }): { touch(): void; isExpired(): boolean; start(): () => void }` (dernière activité stockée sous `bb1-last-activity`, partagée entre onglets) ; `useAuth(): { session: Session | null; profile: Profile | null; loading: boolean; signOut(): Promise<void> }` avec `type Profile = { id: string; name: string; role: "admin" | "member"; status: "active" | "pending" }` ; `<RequireAuth admin?>` : redirige vers `/login` (visiteur), `/pending` (pending), `/` (non-admin sur page admin).
- [ ] **Step 1: Tests (échouent)** : tracker avec `now` simulé : actif à 14 min 59 s, expiré à 15 min ; `touch()` repousse l'échéance ; une valeur `bb1-last-activity` vieille de 20 min au démarrage → `isExpired()` vrai et `onExpire` appelé ; `storage` qui lève → aucun plantage (traité comme non expiré, puis expiration en mémoire).
- [ ] **Step 2:** FAIL. **Step 3:** Implémenter ; `AuthProvider` appelle `start()` quand une session existe et `signOut()` à l'expiration (événements `pointerdown`, `keydown`, `visibilitychange`, navigation). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(front): client Supabase et session de 15 minutes` + push.

### Task 6: Connexion, inscription confirmée, attente, validation admin

**Files:**
- Create: `src/lib/auth/signup-form.ts`, `src/app/pending/page.tsx`
- Modify: `src/app/login/page.tsx`, `src/app/signup/page.tsx`, `src/app/(app)/admin/users/page.tsx` (client), `src/components/layout/Sidebar.tsx` (pastille via requête `profiles` pending)
- Delete: `src/app/setup`, `src/app/invite`, `src/app/(app)/admin/invites`, `src/app/(auth)/actions.ts`, `src/server/auth/*`, tests associés
- Test: `tests/signup-form.test.ts`

**Interfaces:**
- Produces : `validateSignup({ email, name, password, confirm }): { ok: true; value: { email; name; password } } | { ok: false; error: string }` (mêmes messages que `registrationSchema`, plus `"Les deux mots de passe ne correspondent pas."`) ; connexion = `supabase.auth.signInWithPassword` puis `supabase.functions.invoke("notify", { body: { event: "login" } })` sans attendre l'échec ; inscription = `signUp({ email, password, options: { data: { name } } })` puis `notify` `signup`, puis page « Demande envoyée ».
- [ ] **Step 1: Tests (échouent)** : confirmation différente → l'erreur ci-dessus ; mot de passe de 7 caractères → message « au moins 8 caractères » ; pseudo `a@b` refusé ; cas valide → `ok: true` avec e-mail en minuscules.
- [ ] **Step 2:** FAIL. **Step 3:** Implémenter les pages ; un compte `pending` qui se connecte voit `/pending` (« Votre compte attend la validation… ») ; admin : Accepter = `update profiles set status='active'`, Refuser = `functions.invoke("admin-users", …)`. **Step 4:** PASS + vérification manuelle (inscription → pending → validation → accès).
- [ ] **Step 5: Commit** `feat(front): connexion, inscription confirmée et validation` + push.

### Task 7: Bibliothèque, fiche document, fichiers signés

**Files:**
- Create: `src/lib/api/library.ts`, `src/lib/api/files.ts`, `src/app/(app)/doc/page.tsx` (remplace `doc/[id]`), `src/app/(app)/library/subject/page.tsx` (remplace `library/[subject]`)
- Modify: `src/app/(app)/library/page.tsx`, `src/app/(app)/page.tsx`, `src/app/(app)/layout.tsx`, `src/components/library/*`, `src/components/viewers/*`
- Delete: `src/app/files`, `src/app/(app)/doc/[id]`, `src/app/(app)/library/[subject]`
- Test: `tests/api-files.test.ts`

**Interfaces:**
- Produces : `listSubjects()`, `countBySubject()`, `listDocuments(opts?: { subjectId?: string | null })`, `getDocument(id)`, `setDocumentSubject(id, subjectId)`, `deleteDocument(id)` (admin ou auteur ; ajoute `import_exclusions`) ; `signedFileUrl(path: string, opts?: { download?: string }): Promise<string>` (TTL `SIGNED_URL_TTL`), `storagePathOf(filePath: string): string`.
- [ ] **Step 1: Tests (échouent)** : `storagePathOf("uploads/imported/x.pdf")` → `"uploads/imported/x.pdf"` (chemins de `documents.file_path` conservés tels quels dans le bucket) ; `signedFileUrl` appelle `createSignedUrl(path, 3600, { download })` sur le bucket `files` (client simulé) et lève une erreur claire si Supabase renvoie une erreur.
- [ ] **Step 2–4:** FAIL → implémenter (pages client sous `RequireAuth`, liens `/doc?id=…`, `/library/subject?slug=…`) → PASS ; `npm run dev` : un PDF s'affiche une fois connecté, et l'URL signée copiée fonctionne puis expire.
- [ ] **Step 5: Commit** `feat(front): bibliothèque et documents via Supabase` + push.

### Task 8: Entraînement, vérifications, signalements

**Files:** Create `src/lib/api/training.ts` ; Modify `src/app/(app)/training/page.tsx`, `src/app/(app)/training/exercise/page.tsx` (remplace `training/[id]`), `src/components/training/CodeExercise.tsx` (appels API au lieu des server actions), `src/app/(app)/admin/reports/page.tsx` ; Delete `src/app/(app)/training/actions.ts`, `check-actions.ts`, `training/[id]`, `src/server/exercise-check.ts` + `ExerciseCodeEditor` (repli : éditeur exécutable même sans tests prêts, « Exécuter » seul). Test : `tests/api-training.test.ts`.

**Interfaces:** `listExercises(filters)`, `getExercise(id)`, `setProgress(exerciseId, status)`, `getCheck(exerciseId)`, `saveAttempt(exerciseId, language, code, passed)`, `reportCheck(exerciseId, message)`, admin : `verifyCheck`, `updateTests`, `retryCheck`, `resolveReport`. Formes de données identiques à celles déjà consommées par `CodeExercise` (`check`, `attempt`).
- [ ] **Step 1:** Tests des fonctions pures déplacées (`parseTests` / validation des tests édités, reprise de `check-actions.ts`) → FAIL ; **Step 2–4** implémenter → PASS ; vérification manuelle d'un exercice prêt (Vérifier → réussi).
- [ ] **Step 5: Commit** `feat(front): entraînement via Supabase` + push.

### Task 9: Questions et réponses, fiches, dépôt de fichiers

**Files:** Create `src/lib/api/threads.ts`, `src/lib/api/uploads.ts` ; Modify `src/components/qa/*`, `src/app/(app)/notes/new/*`, `src/app/(app)/upload/*` ; Delete `src/app/qa/actions.ts`, `src/app/(app)/upload/actions.ts`, `src/app/(app)/notes/new/actions.ts`. Test : `tests/api-uploads.test.ts`.

**Interfaces:** `uploadDocument(file: File, opts: { title; type; subjectId? }): Promise<{ id: string }>` : envoie vers `uploads/<uid>/<sha256>.<ext>`, extrait le texte (pdf.js navigateur, `src/server/extract/text.ts` rendu compatible navigateur pour PDF/texte), classe avec `classify()` (règles lues dans `subjects`), insère `documents` puis les exercices (`extractExercises`) — le trigger SQL crée les vérifications pending ; doublon (`sha256` existant) → message « déjà dans la bibliothèque ». Fils : `createThread`, `addPost` (image facultative vers `uploads/<uid>/posts/…`), `pinPost`, `markSynthesis`, `deletePost`, `deleteThread`.
- [ ] **Step 1:** Tests : chemin de dépôt `uploads/<uid>/<sha>.pdf` ; doublon détecté avant envoi ; fichier > 50 Mo refusé (`MAX_UPLOAD_BYTES = 50 * 1024 * 1024`) → FAIL ; **Step 2–4** → PASS ; vérification manuelle d'un dépôt PDF puis d'un message avec image.
- [ ] **Step 5: Commit** `feat(front): questions, fiches et dépôt via Supabase` + push.

### Task 10: Devoirs, emploi du temps, recherche, matières

**Files:** Create `src/lib/api/homeworks.ts`, `src/lib/api/calendar.ts`, `src/lib/api/search.ts`, `src/lib/api/subjects.ts` ; Modify `src/app/(app)/devoirs/*`, `src/app/(app)/timetable/page.tsx`, `src/app/(app)/search/page.tsx`, `src/components/layout/TopBar.tsx` (palette Ctrl+K sur `search()` RPC), `src/app/(app)/admin/subjects/*` ; Delete `src/app/api/search`, leurs `actions.ts`. Test : `tests/api-calendar.test.ts`.

**Interfaces:** `linkCalendar(url)`, `syncCalendar()`, `unlinkCalendar()` → `functions.invoke("calendar", …)` ; `getMyCalendar()` lit `calendar_links` ; `search(q)` → `rpc("search", { q })` ; devoirs et matières : CRUD direct (RLS).
- [ ] **Step 1:** Tests : `linkCalendar` transmet `{ action: "link", url }` et remonte `error` + `code` de la fonction → FAIL ; **Step 2–4** → PASS ; vérification manuelle : lier son `.ics`, la semaine s'affiche, rechargement → toujours lié.
- [ ] **Step 5: Commit** `feat(front): devoirs, emploi du temps, recherche, matières` + push.

## Lot C — PC, migration, publication

### Task 11: Import et solveur Qwen vers Supabase

**Files:** Create `src/server/supabase-admin.ts` (client `service_role`, lit `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` du `.env`) ; Modify `src/server/checks.ts`, `src/server/import/run.ts`, `src/server/exercises.ts`, `scripts/solver.ts`, `scripts/solver-status.ts`, `scripts/import.ts` ; Test : `tests/checks.test.ts`, `tests/import.test.ts`, `tests/solver.test.ts` adaptés (client Supabase simulé par une base PGlite via le harnais de la tâche 1 + `claim_check()`).

**Interfaces:** `claimNext(): Promise<CheckRow | null>` = `rpc("claim_check")` ; `saveResult(exerciseId, result)` ; l'import envoie les fichiers dans `files/uploads/imported/…` (chemins actuels conservés) et insère `documents`/`exercises` ; le solveur interroge Postgres toutes les `IDLE_MS = 10_000` comme aujourd'hui.
- [ ] **Step 1–4:** adapter les tests existants (mêmes cas : file, reprise des `running` périmés, `attempts`, `no_code`) → FAIL → implémenter → PASS.
- [ ] **Step 5: Commit** `feat(pc): import et Qwen écrivent dans Supabase` + push.

### Task 12: Migration des données actuelles

**Files:** Create `scripts/migrate-to-supabase.ts` (+ script npm `migrate:supabase`) ; Test : `tests/migrate-to-supabase.test.ts` (fonctions pures de conversion).

**Interfaces:** `toPgRow(table, sqliteRow)` (ms → ISO, 0/1 → booléen, JSON texte → objet) ; ordre : `subjects` → `documents` (+ fichiers `storage/` → bucket `files`, même chemin) → `exercises` (trigger désactivé, puis `exercise_checks` copiées telles quelles) → `import_exclusions` → `homeworks` ; profil admin : l'e-mail de l'admin SQLite reçoit `role 'admin'`, `status 'active'` après sa première inscription sur le nouveau site (option `--admin-email`). Idempotent (`upsert` sur `id`).
- [ ] **Step 1–4:** tests de conversion (dates, booléens, JSON, `tests` des vérifications) → FAIL → implémenter → PASS ; exécution réelle : comptes du tableau de bord = comptes SQLite (`356` exercices, `185+` documents).
- [ ] **Step 5: Commit** `feat(pc): migration SQLite → Supabase` + push.

### Task 13: Publication GitHub Pages

**Files:** Create `.github/workflows/pages.yml` ; Modify `README.md` (nouvelle installation : Supabase, secrets des fonctions, Pages ; suppression des parties systemd/Tailscale), `.env.example` (variables Supabase) ; Delete `deploy/`, `scripts/start.mjs`, `src/instrumentation.ts`, `src/server/db/*` et `drizzle/` une fois plus utilisés.

**Interfaces:** workflow : `on: push: branches: [main]`, `npm ci`, `npm run build` avec `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (variables du dépôt), `actions/upload-pages-artifact` sur `out/`, `actions/deploy-pages`.
- [ ] **Step 1:** `npm run build` local → dossier `out/` sans erreur, `out/runtimes/` présent, aucune occurrence de `service_role`, `NTFY_TOPIC` ni de topic dans `out/` (`grep -r`).
- [ ] **Step 2:** Vérifier l'historique avant passage en public : recherche dans `git log --all` des valeurs exactes du fichier de configuration locale et des motifs de secrets (jeton `.ics`, `sb_secret_`, JWT, topic ntfy) → aucune occurrence (sinon : réécrire l'historique, avec accord explicite).
- [ ] **Step 3:** **Demander confirmation à l'utilisateur**, puis dépôt public, Pages (source GitHub Actions), variables du dépôt ; tag `serveur-node` sur le dernier commit de l'ancien serveur.
- [ ] **Step 4:** Vérification de bout en bout sur `https://biblio-b1.github.io/biblio-b1/` : inscription (confirmation), notification, validation, accès aux documents, 15 min d'inactivité, emploi du temps, exercice vérifié.
- [ ] **Step 5: Commit** `feat: publication github.io` + push, fusion dans `main`.
