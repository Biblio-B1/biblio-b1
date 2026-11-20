# Exercices exécutables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les étudiants écrivent et vérifient leur code (C, Python, JavaScript) directement sur la page d'un exercice, contre des tests pré-calculés en tâche de fond par une IA locale (Ollama).

**Architecture:** Moteurs d'exécution WebAssembly partagés (`src/lib/runners/*`) utilisables dans Node (pré-calcul des sorties attendues) et dans un Web Worker (code étudiant). Un service `npm run solver` traite une file SQLite (`exercise_checks`) en appelant Ollama. La page `/training/[id]` ajoute un éditeur CodeMirror et le verdict.

**Tech Stack:** existant (Next.js 15, better-sqlite3, Drizzle, zod, vitest) + paquet clang/WASI WebAssembly (choisi en Task 1), `pyodide`, CodeMirror 6 (`@codemirror/*`, `@uiw/react-codemirror` ou équivalent), API HTTP d'Ollama (fetch natif).

**Spec:** `docs/superpowers/specs/2026-11-20-exercices-executables-design.md`

## Global Constraints
- Variables : `OLLAMA_URL` (défaut `http://127.0.0.1:11434`), `OLLAMA_MODEL` (défaut `qwen3.8:27b`), `SOLVER_TIMEOUT_MS` (défaut `5000`, délai par exécution). Ne jamais modifier `.env` ni `.env.example` (documenter dans le README).
- Langages exacts : `c`, `python`, `javascript`. Statuts exacts : `pending`, `running`, `ready`, `no_code`, `unsupported`, `failed`.
- Le code étudiant ne s'exécute **jamais** sur le serveur. Aucun CDN : tous les fichiers WASM servis depuis `public/` (copiés par script comme le worker pdf.js).
- Comparaison de sortie : espaces de fin de ligne et lignes vides finales ignorés ; `\r\n` = `\n`.
- Interface en français ; toute page `(app)` et toute action serveur appellent `requireUser` (tests structurels existants).
- IDs UUID texte. Les tests n'accèdent jamais à `./storage` ni au réseau (Ollama simulé par un faux serveur/fetch injecté).
- Commits terminés par une ligne vide + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` ; ne jamais indexer `.env`, `.env.example`, `.claude/`.

## Review Focus
- Boucle infinie / programme qui lit plus d'entrée que fournie → arrêt au délai, message clair, pas de blocage du serveur ni de l'onglet (tests Task 1 et Task 4).
- Réponse Ollama invalide (JSON cassé, champs manquants, code qui ne compile pas) → nouvelle tentative puis `failed`, jamais de crash du service (test Task 3).
- Ollama injoignable → l'exercice reste `pending`, le service attend et réessaie (test Task 3).
- Solution de référence non déterministe (aléatoire, heure) → exercice `failed` avec raison, pas de tests instables (test Task 3).
- Exercice supprimé pendant son traitement → aucune erreur, ligne de file disparue (cascade) (test Task 3).

---

### Task 1: Moteurs d'exécution WebAssembly (spike + implémentation)

**Files:** Create `src/lib/runners/types.ts`, `src/lib/runners/c.ts`, `src/lib/runners/python.ts`, `src/lib/runners/javascript.ts`, `src/lib/runners/index.ts`, `src/lib/runners/compare.ts`, `scripts/copy-runtimes.mjs` ; Modify `package.json` (postinstall/predev/prebuild appellent aussi copy-runtimes) ; Test `tests/runners.test.ts`.

**Interfaces — Produces:**
- `type Language = 'c' | 'python' | 'javascript'`
- `type RunResult = { ok: boolean; stdout: string; stderr: string; phase: 'compile' | 'run'; timedOut: boolean; exitCode: number | null; durationMs: number }`
- `runCode(lang: Language, code: string, stdin: string, opts?: { timeoutMs?: number }): Promise<RunResult>` — fonctionne dans Node (vitest, solver) ; même logique réutilisée par le Worker navigateur (Task 4) via un point d'entrée sans dépendance Node.
- `outputsMatch(actual: string, expected: string): boolean` (règle de comparaison des Global Constraints).

- [ ] **Step 1 (spike):** évaluer 2–3 options pour le C (ex. `@yowasp/clang`, binji `wasm-clang`, tcc WASM) : doit compiler un programme C99 avec `stdio.h`, `stdlib.h`, `string.h`, `math.h`, lire stdin, tourner dans Node ET dans un navigateur, fichiers servables localement. Python : `pyodide` (Node + navigateur). Écrire la décision (paquet, taille, temps de compilation mesuré) dans le rapport.
- [ ] **Step 2: Tests (RED)** `tests/runners.test.ts` : C somme de deux entiers lus sur stdin → `"5\n"` pour `"2 3"` ; C erreur de syntaxe → `ok=false, phase='compile'`, stderr non vide ; C `while(1);` → `timedOut=true` en ≤ timeout+2 s ; Python `print(int(input())*2)` avec `"21"` → `"42\n"` ; Python exception → `ok=false, phase='run'` ; JavaScript lecture stdin (fournir un `input()`/`readline` documenté) ; `outputsMatch("a  \nb\n\n", "a\r\nb")` vrai, `outputsMatch("1","2")` faux.
- [ ] **Step 3:** `npm test -- tests/runners.test.ts` → FAIL.
- [ ] **Step 4:** Implémenter ; le délai s'applique via `worker_threads` (Node) / `Worker` (navigateur) terminé à l'échéance.
- [ ] **Step 5:** tests PASS ; `npm run build` OK.
- [ ] **Step 6:** Commit `feat: moteurs d'exécution WebAssembly (C, Python, JS)`.

### Task 2: Données, file d'attente et mise en file automatique

**Files:** Modify `src/server/db/schema.ts` (+ migration drizzle) ; Create `src/server/checks.ts` ; Modify `src/server/exercises.ts` (mise en file à la création) ; Test `tests/checks.test.ts`.

**Interfaces — Produces:**
- Tables `exercise_checks`, `check_reports`, `code_attempts` (colonnes de la spec).
- `type CheckTest = { input: string; expected: string; visible: boolean }`
- `enqueueCheck(db, exerciseId)` (idempotent), `enqueueAllMissing(db): number`, `claimNextPending(db): ExerciseCheck | null` (passe en `running` atomiquement), `releaseStale(db, olderThanMs)` (remet `running` bloqués en `pending`), `saveCheckResult(db, exerciseId, result)`, `getCheck(db, exerciseId)`, `verifyCheck(db, exerciseId, adminId)`, `updateTests(db, exerciseId, tests, adminId)`, `reportCheck(db, exerciseId, userId, message)`, `saveAttempt(db, userId, exerciseId, language, code, passed)` (passe la progression à `doing`, ou `mastered` si `passed`), `getAttempt(db, userId, exerciseId)`.
- [ ] **Step 1: Tests (RED):** création d'un exercice via `createExercises` → ligne `pending` ; `enqueueCheck` deux fois → une ligne ; `claimNextPending` renvoie le plus ancien et le passe `running`, second appel concurrent → autre ligne ou null ; `releaseStale` ; `saveAttempt(passed=true)` → progression `mastered` ; suppression d'exercice → lignes supprimées (cascade) ; `updateTests` refusé pour un membre.
- [ ] **Step 2–4:** FAIL → implémenter → PASS.
- [ ] **Step 5:** Commit `feat: file de vérification des exercices`.

### Task 3: Service de pré-calcul Ollama (`npm run solver`)

**Files:** Create `src/server/solver/prompt.ts`, `src/server/solver/ollama.ts`, `src/server/solver/solve.ts`, `scripts/solver.ts` ; Modify `package.json` (script `solver`), `src/server/env-schema.mjs` (3 variables) ; Test `tests/solver.test.ts`.

**Interfaces:**
- Consumes: `runCode`, `outputsMatch` (Task 1) ; fonctions de `checks.ts` (Task 2) ; `exercises` + document corrigé apparié (`solution` de l'exercice).
- Produces: `askModel(prompt, schema, { url, model, fetchImpl? }): Promise<unknown>` (POST `/api/generate`, `stream:false`, `format: <JSON schema>`, `think:false`) ; `solveExercise(db, exerciseId, deps): Promise<'ready'|'no_code'|'unsupported'|'failed'>` ; CLI `--once`, `--limit N`, `--exercise <id>`, `--retry-failed`, `--enqueue-missing`.

- [ ] **Step 1: Tests (RED)** avec `fetchImpl` simulé : réponse valide C → `ready`, tests stockés avec sorties calculées par `runCode`, premier visible ; `needsCode:false` → `no_code` ; langage hors liste → `unsupported` ; code qui ne compile pas puis corrigé à la 2e tentative → `ready`, `attempts=2` ; 3 échecs → `failed` avec erreur ; JSON invalide → nouvelle tentative ; fetch qui rejette (ECONNREFUSED) → reste `pending`, `solveExercise` signale « indisponible » sans exception ; solution non déterministe (sorties différentes sur 2 exécutions) → `failed` ; correction du prof contenant du code C valide → utilisée (`reference_source='prof'`) sans appel au modèle.
- [ ] **Step 2–4:** FAIL → implémenter (prompt en français : énoncé, contraintes « programme complet, stdin→stdout, pas d'aléatoire, 4 à 6 tests dont un cas limite ») → PASS.
- [ ] **Step 5:** Commit `feat: service de pré-calcul des vérifications (Ollama)`.

### Task 4: Éditeur et vérification sur la page d'exercice

**Files:** Create `src/components/training/CodeExercise.tsx`, `src/components/training/runner.worker.ts`, `src/app/(app)/training/check-actions.ts` ; Modify `src/app/(app)/training/[id]/page.tsx`, `src/app/(app)/training/actions.ts` si besoin.

**Interfaces — Consumes:** `runCode` (via le Worker, fichiers WASM servis par `public/`), `outputsMatch`, `getCheck`, `saveAttempt`, `getAttempt`, `reportCheck`, `verifyCheck`, `updateTests`.
- [ ] **Step 1:** Actions serveur (zod, `requireUser`) : `saveAttemptAction(exerciseId, language, code, passed)`, `reportCheckAction`, `verifyCheckAction` (admin), `updateTestsAction` (admin), `retryCheckAction` (admin → `pending`). Tests unitaires de la logique si extraite.
- [ ] **Step 2:** UI : badge langage ; CodeMirror (thèmes clair/sombre, mode du langage) ; code initial = dernier essai sinon gabarit ; « Exécuter » avec zone d'entrée ; « Vérifier » → liste des tests ✅/❌ (entrée/sortie attendue/obtenue visibles seulement pour le test visible) ; message de délai dépassé ; états `pending/running` (« Vérification en préparation »), `no_code/unsupported/failed` (« Pas de vérification automatique », correction affichée) ; bandeau « Tests générés par IA — non vérifiés » ; « Signaler un test faux » ; outils admin (valider, éditer les tests en JSON simple, relancer).
- [ ] **Step 3:** Vérification navigateur sur une COPIE temporaire de la base (STORAGE_PATH temporaire, admin temporaire) avec un exercice auquel on injecte un `exercise_checks` prêt : code juste → tout ✅ et statut « Maîtrisé » ; code faux → ❌ ; boucle infinie → message de délai, onglet réactif ; mobile 375 px ; thème sombre. Arrêter le serveur, supprimer le dossier temporaire.
- [ ] **Step 4:** `npm test`, `npm run build` ; Commit `feat: éditeur de code et vérification des exercices`.

### Task 5: Déploiement, README et essai réel

**Files:** Create `deploy/biblio-b1-solver.service` ; Modify `README.md`.
- [ ] **Step 1:** Unité systemd du solveur (même schéma nvm que `biblio-b1.service`, `ExecStart … npm run solver`, `Restart=always`).
- [ ] **Step 2:** README : section « Exercices exécutables » — rôle d'Ollama, modèle `qwen3.8:27b` sur le PC, `OLLAMA_HOST=0.0.0.0` + règle de pare-feu Windows (port 11434, réseau privé) sur le PC, `OLLAMA_URL=http://<IP-du-PC>:11434` sur le Chromebook, `npm run solver -- --enqueue-missing`, suivi de l'avancement, copie de `storage/` du PC vers le Chromebook après le pré-calcul.
- [ ] **Step 3: Essai réel** sur ce PC contre l'Ollama local (`qwen3.8:27b`) et la VRAIE base `./storage` : `npm run solver -- --enqueue-missing` puis `--limit 5` ; rapporter pour chacun : statut, langage, nombre de tests, durée. (Ne crée aucun compte ; écrit seulement dans `exercise_checks`.)
- [ ] **Step 4:** Commit `docs: exercices exécutables (solveur, déploiement)`.
