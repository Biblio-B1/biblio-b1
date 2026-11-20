# Biblio B1

Plateforme d'étude auto-hébergée pour la promo B1 : bibliothèque de cours (PDF, Markdown, code C, photos, Word, PowerPoint), exercices avec suivi de progression, annales, notes et questions/réponses entre membres, recherche globale (`Ctrl K`). Une seule application Next.js 15 + une base SQLite : aucun service cloud.

Tout est stocké dans un dossier (`storage/` par défaut) : base `data.db`, fichiers déposés, clone du dépôt du professeur.

## Prérequis

Node.js 20 ou plus récent, git, et une chaîne de compilation (certains modules natifs, comme `better-sqlite3`, se compilent à l'installation si aucun binaire précompilé n'existe).

### Sur ChromeOS (Linux / Crostini)

1. Activez Linux : Paramètres ChromeOS → Développeurs → Environnement de développement Linux → Activer.
2. Dans le terminal Linux :

   ```sh
   sudo apt update
   sudo apt install -y build-essential python3 git curl sqlite3
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   # rouvrez le terminal, puis :
   nvm install 22
   node -v   # v22.x
   ```

   (`sqlite3` est facultatif : il sert aux sauvegardes ; sans lui le script utilise Node.)

### Sur Windows (développement)

Node 20+ et git suffisent ; utilisez PowerShell ou Git Bash.

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
| `CALENDAR_ENCRYPTION_KEY` | Clé hexadécimale de 32 octets pour chiffrer les URL privées des flux iCalendar liés par les membres. Sans cette clé, la liaison au calendrier est désactivée. | _(vide)_ |

Une chaîne vide dans `.env` équivaut à variable non définie.

## Premier lancement

1. Ouvrez l'application, par exemple <http://localhost:3000>. Tant qu'aucun compte n'existe, `/login` affiche un lien vers **`/setup`** (ou ouvrez directement `/setup`).
2. Saisissez le `ADMIN_INVITE_CODE` du `.env`, votre nom, e-mail et mot de passe : vous êtes administrateur. `/setup` se ferme ensuite.
3. **Inviter des membres** : menu *Invitations* (`/admin/invites`) → créez une invitation (nombre d'utilisations, durée), copiez le lien `/invite/<jeton>` et envoyez-le à la promo. Définissez `APP_URL` (adresse joignable par les camarades, par exemple `http://<IP-ChromeOS>:3000`) pour que le lien soit correct ; sinon corrigez l'adresse dans le champ avant de copier. Une invitation peut être révoquée ; un lien expiré, révoqué ou épuisé est refusé.
4. Les matières se gèrent sous `/admin/subjects`.

Deux rôles seulement : `admin` et `member`.

### Emploi du temps Boostcamp

La rubrique `/timetable` peut lire un lien HTTPS de proxy iCalendar (`.ical`/`.ics`) configuré pour fournir le calendrier Boostcamp. À la première connexion, le membre ouvre Boostcamp puis colle l'URL du proxy. Elle ne demande jamais le mot de passe Boostcamp et ne prétend pas faire un SSO. Le lien du proxy est un secret : il est chiffré dans SQLite avec AES-256-GCM et la clé `CALENDAR_ENCRYPTION_KEY`. Générez une clé avec :

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Configurez cette clé sur le serveur avant que les membres ne lient leur calendrier et conservez-la dans un endroit sûr : sans elle, les abonnements déjà enregistrés ne pourront plus être déchiffrés. Les événements sont actualisés à l'ouverture de la page, au plus une fois toutes les cinq minutes, ou à la demande. Ce mécanisme est une synchronisation par lecture du proxy, pas une mise à jour push en temps réel ; le proxy doit renvoyer les occurrences des événements (les règles récurrentes `RRULE` ne sont pas développées).

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
