# Exercices exécutables et vérification automatique — Conception

Date : 2026-11-20. Complète `2026-11-19-biblio-b1-design.md`.

## Intention
L'utilisateur veut que les étudiants fassent les exercices **directement sur le site** : quand un exercice demande du code, le site détecte le langage (C, Python ou autre), fournit un éditeur, exécute le code et **dit si c'est réussi ou non**, instantanément. Les réponses de référence sont pré-calculées par une IA locale (Ollama) **dès qu'un exercice est publié** et stockées, pour que la vérification soit immédiate.

## Objectifs
- Pré-calcul en tâche de fond, dès l'ajout d'un exercice (import ou dépôt), d'un « jeu de vérification » : langage, solution de référence, tests (entrée → sortie attendue).
- Pré-calcul initial des ~356 exercices existants sur le PC Windows de l'utilisateur (32 Go, `qwen3.8:27b` Q4_K_M, ~3,7 tokens/s, ~3–4 min/exercice), puis base copiée sur le Chromebook.
- Sur le Chromebook (6,4 Go libres), le service de pré-calcul appelle l'Ollama du PC via le réseau (`OLLAMA_URL`) ; si le PC est éteint, les exercices restent en file et sont traités plus tard.
- Côté étudiant : éditeur, bouton « Exécuter » (avec entrée libre), bouton « Vérifier » (tous les tests), verdict ✅/❌ par test, instantané, sans appel à l'IA.

## Non-objectifs (v1)
- Correction par IA au moment de la soumission ; explication d'erreur par IA.
- Langages autres que C, Python, JavaScript (les autres : correction affichée seulement).
- Exercices sans code (questions de cours, logigrammes) : pas de vérification automatique.
- Classement / notes / anti-triche (la progression est personnelle).

## Anti-objectifs
- Exécuter le code des étudiants sur le serveur.
- Appeler un service cloud payant (les modèles `:cloud` d'Ollama sont exclus).
- Bloquer le site si Ollama est indisponible.

## Approches envisagées (exécution du code)
1. **WebAssembly dans le navigateur, mêmes moteurs côté Node pour calculer les sorties attendues (retenue)** — C via un compilateur clang/WASI en WebAssembly, Python via Pyodide, JavaScript via Worker. Aucun compilateur à installer sur le serveur, code étudiant isolé dans le navigateur, résultats identiques entre la référence et l'étudiant. Coût : premier chargement lourd (10–30 Mo, mis en cache).
2. gcc/python sur le serveur dans un bac à sable — rapide, mais exécution de code non fiable sur le Chromebook (risque) et dépendance à gcc.
3. Interpréteur C en JS (sous-ensemble) — léger mais incomplet (pointeurs, structures, fichiers), résultats divergents d'un vrai compilateur.

## Conception
### Données
- `exercise_checks` (1 ligne par exercice) : `exercise_id` PK→exercises (cascade), `status` (`pending|running|ready|no_code|unsupported|failed`), `language` (`c|python|javascript|null`), `reference_code`, `reference_source` (`prof|ai`), `tests` JSON `[{input, expected, visible}]`, `verified` bool, `verified_by`, `model`, `attempts`, `error`, `updated_at`.
- `check_reports` : signalement d'un test faux (user, exercise, message, date, résolu).
- `code_attempts` : dernier code de l'étudiant par exercice (user, exercise, language, code, passed, updated_at) — pour retrouver son travail.
- Mise en file : tout exercice créé (module partagé `src/server/exercises.ts`) insère une ligne `pending`. Commande de rattrapage pour les existants.

### Service de pré-calcul (`npm run solver`)
- Boucle longue (systemd `biblio-b1-solver.service`), options `--once`, `--limit N`, `--exercise <id>`, `--retry-failed`.
- Pour chaque exercice `pending` (un à la fois) :
  1. Si la correction du prof contient du code reconnaissable → candidate de référence.
  2. Sinon appel Ollama (`OLLAMA_URL`, `OLLAMA_MODEL`, sortie JSON structurée via `format`) : `{needsCode, language, solution, tests:[{input, note}]}`. Prompt en français ; programme complet lisant l'entrée standard et écrivant sur la sortie standard ; 4 à 6 tests dont au moins un cas limite.
  3. Exécution de la référence sur chaque entrée avec les **mêmes moteurs WASM** (Node) ; délai max par exécution ; deux exécutions doivent donner la même sortie (déterminisme).
  4. Échec de compilation/exécution → l'erreur est renvoyée au modèle, 2 nouvelles tentatives max, puis `failed`.
  5. `ready` avec `tests` stockés (le premier `visible`, les autres cachés), `verified=false`.
- Ollama injoignable → l'exercice reste `pending`, attente puis nouvel essai ; jamais d'erreur visible côté site.

### Côté étudiant (page `/training/[id]`)
- Badge de langage ; éditeur de code (CodeMirror 6) avec gabarit de départ ; « Exécuter » (entrée libre) ; « Vérifier » → verdict par test, exemple visible (entrée + sortie attendue), tests cachés affichés comme « Test 2 : ✅ ».
- Comparaison des sorties : espaces de fin de ligne et lignes vides finales ignorés.
- Exécution dans un Web Worker avec délai max (boucle infinie → arrêt + message).
- Réussite → statut de progression « Maîtrisé » ; premier essai → « En cours » (décision de l'agent, modifiable).
- États : « Vérification en préparation » (`pending/running`), « Pas de vérification automatique » (`no_code/unsupported/failed`, affichage de la correction).
- Mention « Tests générés par IA — non vérifiés » tant que `verified=false` ; bouton « Signaler un test faux » (membres) ; admin : valider, modifier les tests, relancer le pré-calcul.

### Configuration
`OLLAMA_URL` (défaut `http://127.0.0.1:11434`), `OLLAMA_MODEL` (défaut `qwen3.8:27b`), `SOLVER_TIMEOUT_MS`. README : sur le PC, exposer Ollama au réseau local (`OLLAMA_HOST=0.0.0.0`, pare-feu Windows port 11434) ; sur le Chromebook, `OLLAMA_URL=http://<IP-du-PC>:11434`.

## Décisions de l'agent (à vérifier)
- Langages v1 : C, Python, JavaScript.
- Les étudiants écrivent un programme complet (entrée standard → sortie standard), même si l'énoncé parle d'une fonction ; le gabarit l'indique.
- Réussite → « Maîtrisé » automatiquement.
- Premier test visible, autres cachés.
- Une seule exécution IA à la fois ; reprise automatique après interruption.

## Laissé au constructeur
Choix précis du paquet WebAssembly pour le C (contrainte : fonctionne dans Node et le navigateur, servi localement sans CDN), mise en page, libellés.
