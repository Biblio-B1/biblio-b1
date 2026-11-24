# Biblio B1

Bibliothèque d'étude de la promo B1 : cours du professeur et des dossiers de cours, exercices
exécutables avec vérification automatique, questions et réponses, devoirs, emploi du temps Boostcamp.

**Adresse : <https://biblio-b1.github.io/biblio-b1/>**

## Architecture

```
Navigateur ── pages statiques (GitHub Pages, ce dépôt)
   │            moteurs d'exécution C / Python / JavaScript (WebAssembly, dans le navigateur)
   └─ Supabase : comptes, base Postgres (droits RLS), fichiers privés, fonctions
                 notify + telegram (bot Telegram) · calendar (.ics) · admin-users
PC de l'administrateur (clé secrète dans .env, jamais publiée)
   ├─ npm run import  : dépôt du prof + dossiers de cours → base de travail SQLite (storage/)
   ├─ npm run sync    : base de travail ↔ Supabase
   └─ npm run solver  : Qwen (Ollama) pré-calcule les vérifications des exercices
```

- **Aucun serveur à héberger** : le site est un export statique de Next.js publié par GitHub Actions
  à chaque push sur `main` (`.github/workflows/pages.yml`).
- **Sécurité** : la barrière est la RLS de Supabase (`supabase/migrations/`). Un visiteur ou un compte
  en attente ne lit rien ; un compte validé lit tout le contenu partagé et n'écrit que ce qui est à
  lui ; seul un administrateur gère matières, comptes, vérifications et signalements. Les fichiers
  sont dans un espace privé, servis par liens signés d'une heure. Testé par `tests/supabase/rls.test.ts`.

## Comptes

- **Créer un compte** : e-mail, prénom et nom, mot de passe saisi deux fois. Le compte est **en attente**
  tant que l'administrateur ne l'a pas accepté (Administration → Demandes de compte) ; ensuite, la
  personne se reconnecte simplement avec son mot de passe.
- **Notifications Telegram** (bot privé de l'administrateur) : à chaque demande de compte, avec
  boutons **Accepter / Refuser** directement dans le message, et **à chaque connexion**, avec le nom
  de la personne (« Prénom Nom »). ntfy.sh n'est pas utilisable : il limite par adresse IP et les
  fonctions Supabase sortent par des IP partagées (quota épuisé, erreur 429).
- **Session** : reste ouverte jusqu'à ce qu'on se déconnecte (pas de délai d'inactivité).
- Connexion par e-mail (pas par nom).

## Installer Supabase (une fois)

1. Projet Supabase gratuit ; **Authentication → Providers → Email : désactiver « Confirm email »**
   (la validation par l'administrateur la remplace).
2. Outil Supabase (dans ce dossier) : `npx supabase login`, puis
   `npx supabase link --project-ref <ref>`.
3. Base : appliquer les migrations dans l'ordre (`npx supabase db push`, ou si la connexion directe à
   la base est bloquée : `npx supabase db query --remote --file supabase/migrations/<fichier>.sql`).
4. Bot Telegram : créer un bot avec [@BotFather](https://t.me/BotFather) (jeton `123456:ABC…`),
   lui écrire `/start`, puis relever l'identifiant de la conversation (`getUpdates`).
5. Secrets des fonctions (jamais dans le dépôt) : `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
   `TELEGRAM_WEBHOOK_SECRET` (valeur aléatoire), `CALENDAR_ENCRYPTION_KEY` (64 caractères
   hexadécimaux), `APP_URL` (`https://biblio-b1.github.io/biblio-b1`) —
   `npx supabase secrets set --env-file <fichier>`.
6. Fonctions : `npx supabase functions deploy notify telegram calendar admin-users channel --use-api`
   (`telegram` sans vérification de jeton Supabase : voir `supabase/config.toml`), puis brancher le
   webhook du bot : `setWebhook` vers `https://<ref>.supabase.co/functions/v1/telegram` avec
   `secret_token` = `TELEGRAM_WEBHOOK_SECRET` et
   `allowed_updates` = `["message", "callback_query", "my_chat_member", "channel_post"]` (les deux
   derniers : bot nommé administrateur d'un canal, et commande `/relier` écrite dans le canal).
7. Canal Telegram de la classe (documents, devoirs, contrôles, changements d'emploi du temps) :
   - secret `CHANNEL_CRON_SECRET` (valeur aléatoire), déployer `channel` (sans vérification de jeton) ;
   - tâche planifiée, toutes les 5 minutes : extensions `pg_cron` et `pg_net`, la même valeur dans
     Vault (`select vault.create_secret('<valeur>', 'channel_cron_secret')`), puis
     `cron.schedule('biblio-channel', '*/5 * * * *', …net.http_post(…/functions/v1/channel, en-tête
     x-cron-secret lu dans vault.decrypted_secrets…))` ;
   - créer le canal dans Telegram et y nommer le bot **administrateur** (droit de publier) : le bot
     envoie à l'administrateur un bouton « Utiliser ce canal pour la classe » (sinon, écrire
     `/relier` dans le canal). Un groupe Telegram fonctionne aussi.
   - publications : chaque document, devoir, contrôle ou projet final (devoir coché « projet final »)
     ajouté ; rappels des contrôles
     et projets finaux 3, 2 et 1 semaine(s) avant puis la veille (à partir de 17 h), des devoirs la
     veille ; changements d'emploi du temps.
8. L'adresse du projet et la clé **publiable** (`sb_publishable_…`, publique par conception) sont
   dans `src/lib/supabase/client.ts` (surchargeables par `NEXT_PUBLIC_SUPABASE_URL` /
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`). **Ne jamais y mettre la clé secrète.**

## Le PC de l'administrateur

Node.js ≥ 22.18. `npm ci`, puis un fichier `.env` (modèle : `.env.example`) :

| Variable | Rôle |
| --- | --- |
| `SUPABASE_URL` | Adresse du projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé **secrète** (`sb_secret_…`) : écriture sans RLS. Ne jamais la publier ni l'envoyer. |
| `TELEGRAM_BOT_TOKEN`, `CALENDAR_ENCRYPTION_KEY` | Mêmes valeurs que les secrets des fonctions |
| `C_PROF_REPO_URL` | Dépôt GitHub des cours du professeur |
| `LOCAL_COURSES_PATH` | Dossier de cours : un sous-dossier = une matière |
| `STORAGE_PATH` | Base de travail SQLite et fichiers (`./storage`) |
| `OLLAMA_URL`, `OLLAMA_MODEL`, `SOLVER_TIMEOUT_MS` | Solveur Qwen |

### Importer des cours puis publier

```sh
npm run import   # dépôt du prof + LOCAL_COURSES_PATH → base de travail (idempotent, sha256)
npm run sync     # → site : matières, documents + fichiers, exercices, vérifications
```

- `import` extrait le texte, découpe les exercices et apparie les corrigés ; un dossier de premier
  niveau = une matière.
- `sync` est idempotent. Il rapatrie aussi les documents supprimés sur le site (exclus des
  prochains imports) et les exercices déposés ou relancés sur le site.
- Premier transfert vers un projet neuf : inscris-toi sur le site, puis
  `npm run sync -- --admin-email <ton e-mail>` (compte passé administrateur et validé, progression
  et calendrier de l'ancien site repris).
- `npm run prune -- --dry-run` / `npm run prune` : nettoyage des fichiers parasites importés.

### Pré-calcul des vérifications (Qwen)

```sh
ollama pull qwen3.8:27b
npm run solver                  # boucle longue ; Ctrl+C sans danger, reprise où il s'était arrêté
npm run solver:status           # avancement
npm run solver -- --retry-failed
```

Le solveur rapatrie de Supabase les exercices en attente (déposés sur le site ou relancés par un
admin) et y envoie chaque résultat : rien d'autre à faire. ≈ 3 min par exercice sur CPU.

Pour chaque exercice : langage, solution de référence (correction du prof si c'est du C qui compile,
sinon écrite par le modèle) et 4 à 6 tests dont les sorties attendues sont **calculées en exécutant
la référence**. Les tests restent « non vérifiés » tant qu'un administrateur ne les a pas validés ;
les étudiants peuvent signaler un test faux (Administration → Signalements).

### Sécurité du pré-calcul

Les références écrites par le modèle sont du **code non fiable** (injection d'invite possible via un
document importé). Le solveur les exécute dans un **processus enfant isolé** (`node --permission`) :
lecture limitée au code des moteurs (ni `storage/`, ni `.env`), aucune écriture, aucun processus
enfant, worker ni module natif, environnement vide, arrêt forcé au délai, `process._debugProcess`,
`_debugEnd`, `kill` et `_kill` retirés et `--disable-sigusr1`. Limites : le réseau n'est pas filtré ;
un programme malveillant pourrait fausser ses propres sorties attendues (elles restent « non
vérifiées »). Le code des étudiants, lui, ne s'exécute que dans leur navigateur.

## Exercices exécutables

Éditeur C, Python ou JavaScript : exécuter et **vérifier** sa solution dans le navigateur
(WebAssembly ; au premier usage ≈ 27 Mo pour le C, ≈ 6 Mo pour Python, ensuite en cache). Tant que
les tests d'un exercice ne sont pas prêts, on peut écrire et exécuter son code, sans vérification.
Les sorties attendues des tests cachés sont envoyées au navigateur (site d'entraînement, pas d'examen).

## Emploi du temps

Chaque membre colle **son** lien d'abonnement `.ics` (Boostcamp / Hyperplanning) sur la page Emploi
du temps. La fonction `calendar` le lit côté serveur (adresse HTTPS publique uniquement, taille
bornée), le chiffre (AES-256-GCM, `CALENDAR_ENCRYPTION_KEY`) et garde les événements ; la page se
resynchronise chaque minute. Ce lien est personnel et secret : jamais dans `.env`, `.env.example`
ni un commit.

## Développement

```sh
npm run dev        # http://localhost:3000 (même projet Supabase que le site publié)
npm test           # vitest (dont les droits RLS, dans un Postgres en mémoire)
npx tsc --noEmit
npm run build      # export statique dans out/ (NEXT_PUBLIC_BASE_PATH=/biblio-b1 pour Pages)
```

Supabase gratuit met le projet en pause après 7 jours sans aucune requête ; le premier accès le
réveille (quelques secondes).
