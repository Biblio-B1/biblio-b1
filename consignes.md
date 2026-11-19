# Cahier des charges — Biblio B1

## 1. Vision et contexte du projet
**Biblio B1** est une plateforme web collaborative et interactive destinée aux étudiants d'une même promotion (B1). Elle centralise l'ensemble des cours de l'année, des prises de notes, des photos de tableaux et des exercices corrigés pour apprendre, réviser et s'entraîner ensemble.

- **Organisation GitHub cible** : `Biblio B1`
- **Hébergement cible** : auto-hébergement sur un serveur local **ChromeOS (environnement Linux / Crostini)**. L'architecture doit être légère, autonome, sans dépendance cloud payante, et simple à démarrer (ex. : script unique ou Docker / systemd).

---

## 2. Directives obligatoires pour l'agent IA
1. **Lecture des skills et MCP** : avant toute action, inspecter et charger les `skills` configurés dans le projet/système ainsi que les plugins et serveurs MCP disponibles (GitHub, filesystem, parsing, etc.) pour optimiser la génération et l'intégration des données.
2. **Qualité du code** : code modulaire, typé (TypeScript recommandé), commenté sobrement, avec gestion propre des erreurs et validation des entrées.
3. **Autonomie et simplicité de déploiement** : privilégier une base de données embarquée fiable (**SQLite** via Prisma ou Drizzle) et un stockage local organisé sur le disque (`./storage/uploads/`) pour faciliter les sauvegardes sur ChromeOS.

---

## 3. Gestion des accès et système d'invitation
- **Accès restreint par lien d'invitation** :
  - L'ajout de contenu et la participation (questions/réponses) sont réservés aux utilisateurs inscrits via un **lien d'invitation unique** (jeton sécurisé à usage unique ou limité, généré par un administrateur ou membre habilité).
  - La consultation peut être réservée aux membres connectés (authentification simple email/pseudo + mot de passe haché + session sécurisée).
- **Rôles** :
  - `Admin` : génère/révoque les liens d'invitation, gère les matières, modère les contenus.
  - `Membre invité` : consulte, dépose des cours/photos/PDF, pose des questions et publie des notes/réponses.

---

## 4. Fonctionnalités principales

### A. Bibliothèque de cours et classement automatique
- **Dépôt multi-formats** : upload par glisser-déposer de fichiers PDF, Markdown (`.md`), code source (`.c`, `.h`, `.py`, etc.), images/photos de notes ou tableaux (`.jpg`, `.png`, `.webp`), et création de fiches directement en ligne.
- **Classification automatique par matière** :
  - Lors de l'ajout d'un document, un moteur d'analyse (basé sur le nom du fichier, les mots-clés extraits du texte/PDF ou des règles configurables par matière) détecte automatiquement la matière correspondante (ex. : *Programmation C*, *Systèmes Linux*, *Mathématiques*, *Architecture des ordinateurs*, *Anglais*, etc.).
  - L'utilisateur peut confirmer ou corriger la matière en un clic avant validation.
- **Visionneuse intégrée** :
  - Lecteur PDF intégré.
  - Rendu Markdown propre avec coloration syntaxique pour le code et support des formules mathématiques (KaTeX).
  - Galerie avec zoom fluide pour les photos de cours et tableaux.

### B. Espace d'entraînement et importation des sources existantes
Le projet doit inclure un **pipeline d'importation automatisé** (script CLI exécutable au démarrage ou à la demande) capable d'ingérer trois sources dès l'initialisation :
1. **Dossiers de cours locaux existants** : scanner les dossiers fournis dans le dépôt, détecter leur matière et les indexer automatiquement dans la bibliothèque.
2. **Dépôt GitHub du professeur de programmation C** :
   - Cloner ou récupérer via l'API/MCP GitHub le dépôt fourni contenant les exercices, TP et annales d'examens en C.
   - Parser la structure des dossiers pour créer des fiches d'exercices dans la matière *Programmation C* (distinction entre énoncés, fichiers squelettes `.c`/`.h` et corrections si présentes).
3. **Extraction d'exercices depuis les PDF** :
   - Analyser les fichiers PDF contenant des exercices (TD, annales, fiches de révision) pour découper et extraire chaque exercice individuellement afin de les rendre accessibles dans l'onglet « Entraînement ».
- **Suivi de progression personnel** : chaque étudiant peut marquer un exercice comme *À faire*, *En cours* ou *Maîtrisé*, et afficher/masquer la correction ou les indices.

### C. Entraide interactive : notes et Q&A sur les exercices et cours
- Sous chaque cours, page de PDF ou exercice d'entraînement, un panneau **Notes & Questions** permet aux membres invités de :
  - Poser une question précise (ex. : blocage sur un pointeur en C, incompréhension d'un théorème).
  - Répondre avec du texte formaté (Markdown, blocs de code C avec coloration syntaxique, ajout d'une photo de brouillon).
  - Épingler la meilleure réponse ou une « Note de synthèse » validée par la promo pour aider les suivants.

### D. Barre de recherche globale et instantanée
- Accessible depuis toute l'application (raccourci clavier `Ctrl+K` / `Cmd+K` + barre visible en haut).
- Recherche plein texte instantanée (SQLite FTS5 ou indexation rapide) filtrable par :
  - Matière
  - Type de contenu (Cours, Photo, Exercice C, Annale PDF, Note/Question)
  - Auteur ou date d'ajout

---

## 5. Design et expérience utilisateur (UI/UX)
- **Esthétique épurée et haute lisibilité** : interface minimaliste inspirée de Notion et Linear, sans surcharge visuelle.
- **Typographie soignée** : police sans-serif lisible pour l'interface et la lecture longue, police monospace dédiée pour le code C et les commandes terminal.
- **Thèmes** : mode clair doux (fond blanc cassé / gris très léger pour éviter la fatigue oculaire) et mode sombre contrasté, basculables en un clic.
- **Responsive** : parfaitement utilisable sur ordinateur portable (prise de notes en amphi) comme sur smartphone (consultation rapide et prise de photo directe du tableau pour upload immédiat).

---

## 6. Architecture technique recommandée (compatibilité ChromeOS)
- **Stack unifiée** : Next.js (App Router) ou SvelteKit avec TypeScript, Tailwind CSS et composants UI accessibles.
- **Base de données** : SQLite (`better-sqlite3` + Drizzle ORM ou Prisma) avec table virtuelle FTS5 pour la recherche instantanée.
- **Extraction PDF & Git** : `pdf-parse` / `pdfjs-dist` (ou script Python léger si installé sur Crostini) pour extraire le texte des PDF, et `simple-git` ou l'API GitHub pour synchroniser le dépôt du professeur de C.
- **Configuration** : un fichier `.env.example` clair documentant les variables (`ADMIN_INVITE_CODE`, `C_PROF_REPO_URL`, `PORT`, `STORAGE_PATH`).

---

## 7. Livrables attendus de l'agent
1. Application web complète, fonctionnelle et prête à démarrer (`npm install && npm run dev` ou `npm start`).
2. Script d'importation (`npm run import`) permettant d'ingérer les dossiers locaux, les PDF d'exercices et le repo GitHub de C.
3. Fichier `README.md` détaillant le lancement local et le déploiement sur serveur Linux ChromeOS (redirection de port, sauvegarde du dossier de données).