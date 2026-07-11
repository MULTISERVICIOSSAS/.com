#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/multiservicios}"
BRANCH="${BRANCH:-main}"
SERVICE_NAME="${SERVICE_NAME:-multiservicios}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8090/api/health}"

cd "$APP_DIR"
PREVIOUS_COMMIT="$(git rev-parse HEAD)"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

if [ -f requirements.txt ] && [ -s requirements.txt ]; then
  python3 -m pip install --user -r requirements.txt || true
fi

sudo systemctl restart "$SERVICE_NAME"
sudo systemctl reload nginx

healthy=0
for _ in $(seq 1 20); do
  if curl --fail --silent --show-error "$HEALTH_URL" | grep -q '"ok": true'; then
    healthy=1
    break
  fi
  sleep 1
done

if [ "$healthy" -ne 1 ]; then
  echo "El backend no respondio; restaurando $PREVIOUS_COMMIT" >&2
  git reset --hard "$PREVIOUS_COMMIT"
  sudo systemctl restart "$SERVICE_NAME"
  exit 1
fi

echo "Deploy OK: $APP_DIR on branch $BRANCH ($HEALTH_URL)"
