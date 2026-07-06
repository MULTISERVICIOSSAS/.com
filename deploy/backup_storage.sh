#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/multiservicios}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/multiservicios}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
ARCHIVE="$BACKUP_DIR/multiservicios-storage-$STAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

if [ ! -d "$APP_DIR/storage" ]; then
  echo "No existe $APP_DIR/storage" >&2
  exit 1
fi

tar -C "$APP_DIR" -czf "$ARCHIVE" storage
find "$BACKUP_DIR" -type f -name "multiservicios-storage-*.tar.gz" -mtime +"$KEEP_DAYS" -delete

echo "$ARCHIVE"
