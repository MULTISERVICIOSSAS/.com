#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/multiservicios}"
BRANCH="${BRANCH:-main}"
SERVICE_NAME="${SERVICE_NAME:-multiservicios}"

cd "$APP_DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

if [ -f requirements.txt ] && [ -s requirements.txt ]; then
  python3 -m pip install --user -r requirements.txt || true
fi

sudo systemctl restart "$SERVICE_NAME"
sudo systemctl reload nginx

echo "Deploy OK: $APP_DIR on branch $BRANCH"
