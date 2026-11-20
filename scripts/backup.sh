#!/bin/sh
# Sauvegarde de Biblio B1 : archive datée de STORAGE_PATH (base SQLite + fichiers déposés).
# La base est copiée de façon cohérente (sqlite3 .backup, sinon VACUUM INTO via better-sqlite3),
# même si le serveur tourne. Les ~14 dernières archives sont conservées.
#
# Usage : scripts/backup.sh [dossier-de-destination]     (défaut : ./backups)
# Variables : STORAGE_PATH (défaut ./storage, lu dans .env si présent), KEEP (défaut 14)
set -eu

cd "$(dirname "$0")/.."

if [ -z "${STORAGE_PATH:-}" ] && [ -f .env ]; then
  STORAGE_PATH=$(sed -n 's/^STORAGE_PATH=//p' .env | tail -n 1 | tr -d '\r"' || true)
fi
STORAGE="${STORAGE_PATH:-./storage}"
DEST="${1:-./backups}"
KEEP="${KEEP:-14}"

[ -f "$STORAGE/data.db" ] || { echo "Base introuvable : $STORAGE/data.db" >&2; exit 1; }
mkdir -p "$DEST"

STAMP=$(date +%Y%m%d-%H%M%S)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM
mkdir "$TMP/storage"

# 1. Copie cohérente de la base (jamais un simple cp : le mode WAL peut la rendre incohérente).
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$STORAGE/data.db" ".backup '$TMP/storage/data.db'"
else
  SRC="$STORAGE/data.db" OUT="$TMP/storage/data.db" node -e '
    const Database = require("better-sqlite3");
    const db = new Database(process.env.SRC, { readonly: true });
    db.exec("VACUUM INTO \x27" + process.env.OUT.replace(/\x27/g, "\x27\x27") + "\x27");
    db.close();'
fi

# 2. Fichiers déposés (le clone du dépôt du professeur se re-télécharge : exclu).
for entry in "$STORAGE"/*; do
  name=$(basename "$entry")
  case "$name" in data.db|data.db-wal|data.db-shm|sources) continue ;; esac
  cp -R "$entry" "$TMP/storage/$name"
done

ARCHIVE="$DEST/biblio-b1-$STAMP.tar.gz"
tar -czf "$ARCHIVE" -C "$TMP" storage
echo "Sauvegarde créée : $ARCHIVE"

# 3. Rotation : ne garder que les $KEEP plus récentes.
ls -1t "$DEST"/biblio-b1-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f "$old"
  echo "Ancienne sauvegarde supprimée : $old"
done
