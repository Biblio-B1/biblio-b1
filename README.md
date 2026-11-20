# Biblio B1

Plateforme d'étude auto-hébergée pour la promo B1 : bibliothèque de cours (PDF, Markdown, code C, photos, Word, PowerPoint), exercices avec suivi de progression, annales, notes et questions/réponses entre membres, recherche globale (`Ctrl K`). Une seule application Next.js 15 + une base SQLite : aucun service cloud.

Tout est stocké dans un dossier (`storage/` par défaut) : base `data.db`, fichiers déposés, clone du dépôt du professeur.

## Prérequis

Node.js 22 LTS (22.18 ou plus récent, requis par les moteurs d'exécution des exercices), git, et une chaîne de compilation (certains modules natifs, comme `better-sqlite3`, se compilent à l'installation si aucun binaire précompilé n'existe).

### Sur ChromeOS (Linux / Crostini)

1. Activez Linux : Paramètres ChromeOS → Développeurs → Environnement de développement Linux → Activer.
2. Dans le terminal Linux :

   ```sh
   sudo apt update
   sudo apt install -y build-essential python3 git curl sqlite3
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   # rouvrez le terminal, puis :
   nvm install 22
   node -v   # v22.18 ou plus
   ```

   (`sqlite3` est facultatif : il sert aux sauvegardes ; sans lui le script utilise Node.)

### Sur Windows (développement)

Node 22 LTS (22.18+) et git suffisent ; utilisez PowerShell ou Git Bash.

## Installation

```sh
git clone <url-du-depot> ~/biblio-b1
cd ~/biblio-b1
npm ci
cp .env.example .env
```

Éditez `.env` (voir ci-dessous), puis pour essayer en développement : `npm run dev` → <http://localhost:3000>.

## Configuration (`.env`)

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `ADMIN_INVITE_CODE` | Code secret demandé sur `/setup` pour créer le premier administrateur. **Obligatoire en production** (vide ou `change-me` : le serveur refuse de démarrer). | _(vide)_ |
| `APP_URL` | Adresse publique de l'application, **sans `/` final** (ex. `http://192.168.1.20:3000`), utilisée pour les liens d'invitation. Sans elle, les liens reprennent l'adresse du navigateur de l'administrateur : depuis `localhost` ou `penguin.linux.test`, ils ne marchent pas pour les camarades (`/admin/invites` affiche alors un avertissement ; le lien reste modifiable avant copie). | _(adresse de la requête)_ |
| `SESSION_SECRET` | **Réservé, non utilisé actuellement** : les sessions sont des jetons aléatoires dont seule l'empreinte est stockée, aucun secret n'est nécessaire. Peut rester à sa valeur par défaut. | valeur de dev |
| `PORT` | Port d'écoute. | `3000` |
| `STORAGE_PATH` | Dossier de stockage : base SQLite, fichiers déposés, clone du dépôt du professeur. | `./storage` |
| `C_PROF_REPO_URL` | Dépôt GitHub des cours du professeur, cloné puis importé par `npm run import`. | `https://github.com/S-L-A-K-E-R/C_courses` |
| `LOCAL_COURSES_PATH` | Dossier local de cours importé par `npm run import` : chaque sous-dossier de premier niveau devient une matière. Lu seulement, jamais modifié. | `./sources/local` |
| `COOKIE_SECURE` | `true` pour marquer le cookie de session « Secure » (obligatoire derrière HTTPS). Laissez `false` en HTTP sur le réseau local, sinon la connexion échoue. | `false` |
| `OLLAMA_URL` | Adresse d'Ollama pour le service de pré-calcul (`npm run solver`). Sur le Chromebook : `http://<IP-du-PC>:11434` (sur le PC, lancer Ollama avec `OLLAMA_HOST=0.0.0.0` et ouvrir le port 11434 du pare-feu Windows au réseau local). | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | Modèle Ollama local utilisé pour écrire les solutions de référence et les entrées de test. | `qwen3.8:27b` |
| `SOLVER_TIMEOUT_MS` | Délai maximal (ms) d'une exécution de la solution de référence, compilation comprise. | `5000` |

Une chaîne vide dans `.env` équivaut à variable non définie.

## Premier lancement

1. Ouvrez l'application, par exemple <http://localhost:3000>. Tant qu'aucun compte n'existe, `/login` affiche un lien vers **`/setup`** (ou ouvrez directement `/setup`).
2. Saisissez le `ADMIN_INVITE_CODE` du `.env`, votre nom, e-mail et mot de passe : vous êtes administrateur. `/setup` se ferme ensuite.
3. **Inviter des membres** : menu *Invitations* (`/admin/invites`) → créez une invitation (nombre d'utilisations, durée), copiez le lien `/invite/<jeton>` et envoyez-le à la promo. Définissez `APP_URL` (adresse joignable par les camarades, par exemple `http://<IP-ChromeOS>:3000`) pour que le lien soit correct ; sinon corrigez l'adresse dans le champ avant de copier. Une invitation peut être révoquée ; un lien expiré, révoqué ou épuisé est refusé.
4. Les matières se gèrent sous `/admin/subjects`.

Deux rôles seulement : `admin` et `member`.

## Importer des cours

```sh
npm run import
```

- clone/met à jour le dépôt `C_PROF_REPO_URL` (toutes ses ressources vont dans la matière « Algorithmique et Prog C ») ;
- lit `LOCAL_COURSES_PATH` : **un dossier de premier niveau = une matière**, les fichiers à la racine sont classés automatiquement (à confirmer ensuite dans l'interface) ;
- extrait le texte, découpe les exercices, apparie les corrigés aux énoncés ;
- est idempotent (empreinte sha256) : relancer ne crée aucun doublon ;
- un fichier **modifié** à la source (même chemin, contenu différent) remplace l'ancien document (compté « mis à jour ») : la progression est reportée sur les exercices de même numéro et les fils de questions/réponses sont conservés (rattachés à l'exercice correspondant, sinon au document).

Nettoyage des fichiers parasites déjà importés (captures, miniatures, dossiers d'outils…) :

```sh
npm run prune -- --dry-run   # affiche ce qui serait supprimé, sans rien modifier
npm run prune                # supprime documents exclus et matières vides
```

Attention : `npm run prune` supprime **toute matière vide absente de la liste par défaut**, y compris une matière qu'un administrateur vient de créer sous `/admin/subjects` et qui n'a encore aucun document. Vérifiez avec `--dry-run` d'abord.

Reconstruire l'index de recherche (après un import ancien ou pour réparer) :

```sh
npm run reindex
```

## Exercices exécutables

### Ce que voient les étudiants
Sur la page d'un exercice de programmation, un éditeur de code (C, Python ou JavaScript) permet d'écrire, d'exécuter et de **vérifier** sa solution sans quitter le site. Le code s'exécute **dans le navigateur de l'étudiant** (WebAssembly), jamais sur le serveur. Au premier usage, le navigateur télécharge les moteurs une seule fois puis les garde en cache : ≈ 27 Mo pour le C, ≈ 6 Mo pour Python (JavaScript : rien).

### Comment fonctionne la vérification
Un modèle d'IA local (Ollama) **pré-calcule** pour chaque exercice un jeu de vérification : langage, solution de référence et 4 à 6 tests (entrée → sortie attendue), le premier étant visible. La correction du professeur sert de référence si c'est du C qui compile ; sinon le modèle écrit la solution. Les sorties attendues sont toujours **calculées en exécutant la référence** (deux fois, pour écarter les solutions non déterministes) avec les mêmes moteurs que le navigateur. Ce pré-calcul se fait hors ligne : les étudiants n'attendent jamais le modèle.

- Tant que les tests n'ont pas été relus par un administrateur, l'exercice affiche le badge **« non vérifiés »** (tests écrits par l'IA, donc faillibles).
- Les étudiants peuvent **signaler** des tests erronés ; les signalements non traités apparaissent côté administrateur, dans les « Outils administrateur » de l'exercice (auteur, date, message, bouton « Marquer comme traité ») et sur la page **Administration → Signalements** (`/admin/reports`), avec un lien vers chaque exercice.
- Les administrateurs peuvent corriger les tests (en choisissant le langage si le pré-calcul n'en a pas fixé) ou valider ceux du pré-calcul (seulement s'il en a produit) : le badge disparaît, et le solveur n'y touche plus. « Relancer le pré-calcul » sur des tests validés demande confirmation et retire la validation.
- Exercice sans calcul vérifiable (question de cours, schéma…) : pas d'éditeur de vérification. Exercice pas encore traité : « en préparation ».

### Le service de pré-calcul (`npm run solver`)
Pour chaque exercice en file, le service obtient langage, référence et entrées de test, puis les sorties attendues.

```sh
npm run solver                         # boucle longue (service)
npm run solver -- --once               # un exercice puis arrêt
npm run solver -- --limit 10           # au plus 10 exercices
npm run solver -- --exercise <id>      # (re)calculer un exercice précis
npm run solver -- --enqueue-missing    # met en file les exercices sans vérification
npm run solver -- --retry-failed       # remet en file les échecs
npm run solver:status                  # compte par statut (base ouverte en lecture seule)
```

Chaque exercice est mis en file **dès sa création** (import, dépôt) : le service, qui interroge la file en continu, le traite sans redémarrage. Au démarrage, il rattrape seulement les exercices restés sans ligne de vérification (base antérieure à la fonctionnalité, copie partielle ; `--enqueue-missing` le fait aussi explicitement) et reprend les traitements interrompus depuis plus de 30 min. Un exercice qui reçoit plus tard la correction du professeur est remis en file (sauf tests validés) pour que cette référence soit utilisée. Si Ollama est injoignable, les exercices restent en file et le service réessaie (60 s, puis délai doublé jusqu'à 15 min). Un modèle introuvable (`OLLAMA_MODEL` erroné, `ollama pull` oublié) arrête le service avec un message clair (code 1). Ctrl+C est sans danger : la ligne en cours est rendue à la file et le travail reprend où il s'était arrêté. `solver:status` affiche le nombre d'exercices `ready`, `no_code`, `unsupported`, `failed`, `running`, `pending` et non encore mis en file.

### Sécurité du pré-calcul
Les solutions de référence écrites par le modèle sont du **code non fiable** : un document importé peut contenir des instructions cachées (injection d'invite) qui pousseraient le modèle à écrire un programme malveillant. Le solveur exécute donc chaque référence (C, Python et JavaScript) dans un **processus enfant isolé** par le [modèle de permissions de Node](https://nodejs.org/api/permissions.html) (`node --permission`) :

- lecture limitée au code des moteurs (`src/lib/runners/` et les paquets `@yowasp/clang`, `pyodide`, `@bjorn3/browser_wasi_shim` de `node_modules`) : **ni `storage/` (base `data.db`, fichiers), ni `.env`**, ni le reste du dépôt ;
- aucune écriture de fichier, aucun processus enfant, aucun worker, aucun module natif ;
- environnement vide (les variables chargées depuis `.env` ne sont pas transmises) ;
- arrêt forcé du processus au délai (`SOLVER_TIMEOUT_MS`), puis recréation.

Limites connues : le modèle de permissions de Node (≥ 22.18) ne filtre pas le **réseau** ; un programme malveillant pourrait donc émettre des requêtes vers le réseau local, sans toutefois disposer d'aucun secret à y envoyer. Faites tourner le solveur sous un compte sans privilèges particuliers. Le code des **étudiants**, lui, ne s'exécute jamais sur le serveur (seulement dans leur navigateur).

### Préparer le PC (Windows, avec Ollama)
Le modèle est trop lourd pour le Chromebook : il tourne sur un PC de la maison.

1. Installez [Ollama](https://ollama.com) puis téléchargez le modèle (≈ 17 Go) :
   ```powershell
   ollama pull qwen3.8:27b
   ```
2. Pour que le Chromebook puisse l'appeler, exposez Ollama sur le réseau local : variable d'environnement **utilisateur** `OLLAMA_HOST` = `0.0.0.0` (Paramètres Windows → « variables d'environnement », ou `setx OLLAMA_HOST 0.0.0.0`), puis quittez et relancez Ollama.
3. Autorisez le port 11434 en entrée, **profil réseau Privé uniquement** (PowerShell en administrateur) :
   ```powershell
   New-NetFirewallRule -DisplayName "Ollama (LAN)" -Direction Inbound -Protocol TCP -LocalPort 11434 -Action Allow -Profile Private
   ```
   Le réseau doit être déclaré « Privé » dans Windows.
4. Relevez l'adresse IP du PC avec `ipconfig` (ligne « Adresse IPv4 »). Idéalement, réservez-la dans la box (bail DHCP fixe).

### Pré-calcul initial
Il faut compter ≈ 3 min par exercice sur CPU, soit **≈ 18 h pour ~350 exercices** (beaucoup d'exercices `no_code` sont plus rapides). Le travail est **reprenable** : on peut l'interrompre (Ctrl+C) et le relancer à volonté.

Recommandé : faire le pré-calcul **sur une copie du dépôt sur le PC**, puis copier la base vers le Chromebook.

```sh
# sur le PC, dans la copie du dépôt (après npm install et un npm run import)
npm run solver -- --enqueue-missing    # laissez tourner ; Ctrl+C pour arrêter, relancer pour reprendre
npm run solver:status                  # avancement, depuis un autre terminal
npm run solver -- --retry-failed       # une fois fini : retenter les échecs
```

Deux façons d'amener le résultat sur le Chromebook :

1. **Copier `storage/data.db` du PC vers le Chromebook (recommandé).** Arrêtez le site sur le Chromebook (`systemctl --user stop biblio-b1 biblio-b1-solver`), copiez `storage/data.db` (et, si des fichiers ont changé, tout le dossier `storage/`), supprimez les éventuels `data.db-wal` / `data.db-shm` du Chromebook, puis redémarrez. **Cela écrase les données du Chromebook** (comptes, progression, fils, dépôts) : faites-le **avant l'ouverture à la promo**, ou fusionnez à la main avec prudence. Les tests ne dépendent que des exercices ; les identifiants doivent donc venir du même import.
2. **Pré-calculer directement pour le Chromebook**, plus tard, en laissant le service du Chromebook appeler Ollama sur le PC via `OLLAMA_URL` (voir ci-dessous). Aucune copie, mais le PC doit rester allumé ≈ 18 h, et les nouveaux exercices seront traités au fil de l'eau.

### Sur le Chromebook
1. Dans `.env` : `OLLAMA_URL=http://<IP-du-PC>:11434` (et `OLLAMA_MODEL` si vous changez de modèle). Testez : `curl http://<IP-du-PC>:11434/api/tags`.
2. Installez l'unité systemd du solveur :
   ```sh
   cp deploy/biblio-b1-solver.service ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now biblio-b1-solver
   journalctl --user -u biblio-b1-solver -f     # journaux
   ```
3. Quand le PC est éteint, les exercices restent « en préparation » et le service réessaie ; ils sont traités dès que le PC revient. Les nouveaux exercices importés ensuite sont mis en file dès leur création et traités au fil de l'eau, sans redémarrer le service.

## Production

```sh
npm run build
npm start        # charge .env puis écoute sur PORT (scripts/start.mjs)
```

En production (`NODE_ENV=production`, positionné par `next start`), `ADMIN_INVITE_CODE` doit être défini (ni vide ni `change-me`) et toutes les variables doivent être valides (ex. `APP_URL` sans `/` final) : sinon `npm start` s'arrête aussitôt (code de sortie 1) avec un message explicite, et le service systemd passe en échec (`systemctl --user status biblio-b1`, `journalctl --user -u biblio-b1`).

### Démarrage automatique (systemd, unité utilisateur)

```sh
mkdir -p ~/.config/systemd/user
cp deploy/biblio-b1.service ~/.config/systemd/user/
# adaptez WorkingDirectory si le dépôt n'est pas dans ~/biblio-b1
systemctl --user daemon-reload
systemctl --user enable --now biblio-b1
loginctl enable-linger "$USER"        # démarre aussi sans session ouverte
systemctl --user status biblio-b1
journalctl --user -u biblio-b1 -f     # journaux
```

Pensez à faire `npm run build` avant le premier démarrage du service.

## Accès

- **Depuis ChromeOS** : <http://penguin.linux.test:3000> (ou `http://localhost:3000`).
- **Depuis les autres appareils du réseau local** : Paramètres ChromeOS → Développeurs → Environnement de développement Linux → **Redirection de ports** → ajoutez le port `3000` (TCP) et activez-le. Trouvez l'adresse IP du Chromebook (Paramètres → Réseau → Wi-Fi → propriétés) puis ouvrez `http://<IP-ChromeOS>:3000`.
- En HTTP simple, gardez `COOKIE_SECURE=false`. Si vous placez l'application derrière un proxy HTTPS (Caddy, nginx…), mettez `COOKIE_SECURE=true`.
- Ne l'exposez pas directement sur Internet : pas de HTTPS ni de limitation de débit intégrés.

## Sauvegardes

```sh
scripts/backup.sh               # → ./backups/biblio-b1-AAAAMMJJ-HHMMSS.tar.gz
scripts/backup.sh /chemin/dest  # autre dossier de destination
KEEP=30 scripts/backup.sh       # conserver 30 archives au lieu de 14
```

L'archive contient `storage/` : la base `data.db` (copie cohérente via `sqlite3 .backup`, ou `VACUUM INTO` avec Node si `sqlite3` est absent, serveur en marche) et les fichiers déposés. Le clone du dépôt du professeur n'est pas sauvegardé : `npm run import` le retélécharge.

Pour automatiser, ajoutez une ligne à `crontab -e`. cron ne charge ni `~/.bashrc` ni nvm : `node` n'y est pas dans le `PATH`, donc **installez `sqlite3`** (`sudo apt install sqlite3`, utilisé en priorité) :

```cron
30 3 * * * cd ~/biblio-b1 && mkdir -p backups && scripts/backup.sh >> backups/backup.log 2>&1
```

Sans `sqlite3`, chargez nvm dans la ligne cron pour que le repli Node fonctionne :

```cron
30 3 * * * . "$HOME/.nvm/nvm.sh" && cd ~/biblio-b1 && mkdir -p backups && scripts/backup.sh >> backups/backup.log 2>&1
```

**Restauration** :

L'archive contient un dossier `storage/` ; restaurez-le à l'emplacement de `STORAGE_PATH` (ici lu dans `.env`, `./storage` par défaut) :

```sh
systemctl --user stop biblio-b1
STORAGE=$(sed -n 's/^STORAGE_PATH=//p' .env | tail -n 1); STORAGE=${STORAGE:-./storage}
mv "$STORAGE" "$STORAGE.old"                 # garder l'existant au cas où
mkdir -p /tmp/bb1-restore
tar -xzf backups/biblio-b1-XXXXXXXX-XXXXXX.tar.gz -C /tmp/bb1-restore
mv /tmp/bb1-restore/storage "$STORAGE"
rmdir /tmp/bb1-restore
npm run import                              # re-clone le dépôt du professeur (non sauvegardé)
systemctl --user start biblio-b1
```

Copiez de préférence l'archive sur une clé USB ou un autre appareil : une sauvegarde sur le même disque ne protège pas d'une panne du Chromebook.

## Mise à jour

```sh
cd ~/biblio-b1
git pull
npm ci
npm run build
systemctl --user restart biblio-b1
```

Les migrations de base s'appliquent automatiquement au démarrage.

## Dépannage

- **`better-sqlite3` : « Could not locate the bindings file » / erreur de module natif** (après changement de version de Node) : `npm rebuild better-sqlite3` ; vérifiez que `build-essential` et `python3` sont installés.
- **`EADDRINUSE` : port déjà utilisé** : un autre processus occupe le port. `ss -ltnp | grep 3000` pour l'identifier, ou changez `PORT` dans `.env`. Si le service systemd tourne déjà, ne lancez pas `npm start` en parallèle.
- **« Configuration de production refusée »** / **« Configuration invalide »** : définissez `ADMIN_INVITE_CODE` dans `.env` (ni vide ni `change-me`) et corrigez la variable citée dans le message.
- **Les liens d'invitation ne s'ouvrent pas chez les camarades** : ils pointent vers `localhost` ou `penguin.linux.test` ; définissez `APP_URL` dans `.env` puis redémarrez.
- **Connexion impossible en HTTP** : vérifiez `COOKIE_SECURE=false`.
- **Le service ne trouve pas `npm`** (nvm) : l'unité source `~/.nvm/nvm.sh` avant de lancer `npm start` (`~/.bashrc` n'est pas lu en shell non interactif). Si nvm est installé ailleurs, ou pour viser une version précise, mettez le chemin absolu : `ExecStart=/home/<vous>/.nvm/versions/node/<version>/bin/npm start` (la version active : `nvm which default`, puis remplacez `/bin/node` par `/bin/npm`) ; puis `systemctl --user daemon-reload && systemctl --user restart biblio-b1`.
- **Uploads refusés** : formats `.pdf .md .c .h .py .txt .jpg .jpeg .png .webp .docx .pptx`, 50 Mo maximum.
- **Import : « synchronisation du dépôt impossible »** : pas d'accès réseau à GitHub ; l'import local fonctionne quand même.

## Développement

```sh
npm run dev      # serveur de développement
npm test         # tests (vitest, base SQLite en mémoire)
npx tsc --noEmit # vérification des types
```
