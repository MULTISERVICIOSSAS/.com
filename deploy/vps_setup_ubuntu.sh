#!/usr/bin/env bash
set -euo pipefail

APP_USER="${APP_USER:-multiservicios}"
APP_DIR="${APP_DIR:-/var/www/multiservicios}"
APP_PORT="${APP_PORT:-8090}"
CODE_PORT="${CODE_PORT:-8081}"
BRANCH="${BRANCH:-main}"
REPO_URL="${REPO_URL:-https://github.com/MULTISERVICIOSSAS/.com.git}"
DOMAIN="${DOMAIN:-}"
WWW_DOMAIN="${WWW_DOMAIN:-www.${DOMAIN}}"
CODE_DOMAIN="${CODE_DOMAIN:-code.${DOMAIN}}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@multiservicios.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
MS_SECRET_KEY="${MS_SECRET_KEY:-}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
ENABLE_SSL="${ENABLE_SSL:-0}"
INSTALL_CODE_SERVER="${INSTALL_CODE_SERVER:-1}"
CODE_SERVER_PASSWORD="${CODE_SERVER_PASSWORD:-}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Ejecuta este script como root o con sudo." >&2
  exit 1
fi

if [ -z "$DOMAIN" ]; then
  echo "Falta DOMAIN. Ejemplo: DOMAIN=multiservicios.com sudo -E bash deploy/vps_setup_ubuntu.sh" >&2
  exit 1
fi

if [ "$ADMIN_EMAIL" = "admin@multiservicios.local" ]; then
  echo "Falta ADMIN_EMAIL con el correo administrativo real." >&2
  exit 1
fi

if [ -z "$ADMIN_PASSWORD" ]; then
  ADMIN_PASSWORD="$(openssl rand -base64 24)"
  echo "ADMIN_PASSWORD generado: $ADMIN_PASSWORD"
fi

if [ -z "$MS_SECRET_KEY" ]; then
  MS_SECRET_KEY="$(openssl rand -hex 32)"
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y nginx git python3 python3-pip python3-venv curl ca-certificates openssl ufw snapd

if ! id "$APP_USER" >/dev/null 2>&1; then
  adduser --system --group --home "$APP_DIR" "$APP_USER"
fi

mkdir -p "$(dirname "$APP_DIR")"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  rm -rf "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

mkdir -p "$APP_DIR/storage/db" "$APP_DIR/storage/pdfs"
chown -R "$APP_USER:www-data" "$APP_DIR"
chmod -R u+rwX,g+rwX,o-rwx "$APP_DIR/storage"

cat >/etc/multiservicios.env <<EOF
MS_ENV=production
MS_HOST=127.0.0.1
MS_PORT=$APP_PORT
MS_ADMIN_EMAIL=$ADMIN_EMAIL
MS_ADMIN_PASSWORD=$ADMIN_PASSWORD
MS_SECRET_KEY=$MS_SECRET_KEY
MS_COOKIE_SECURE=true
MS_PUBLIC_URL=https://$DOMAIN
EOF
chmod 640 /etc/multiservicios.env
chown root:www-data /etc/multiservicios.env

install -m 0644 "$APP_DIR/deploy/systemd/multiservicios.service" /etc/systemd/system/multiservicios.service
install -m 0644 "$APP_DIR/deploy/systemd/multiservicios-backup.service" /etc/systemd/system/multiservicios-backup.service
install -m 0644 "$APP_DIR/deploy/systemd/multiservicios-backup.timer" /etc/systemd/system/multiservicios-backup.timer
sed -i "s#/var/www/multiservicios#$APP_DIR#g" /etc/systemd/system/multiservicios.service
sed -i "s#/var/www/multiservicios#$APP_DIR#g" /etc/systemd/system/multiservicios-backup.service
sed -i "s#User=multiservicios#User=$APP_USER#g" /etc/systemd/system/multiservicios.service

sed \
  -e "s/__DOMAIN__/$DOMAIN/g" \
  -e "s/__WWW_DOMAIN__/$WWW_DOMAIN/g" \
  -e "s/__APP_PORT__/$APP_PORT/g" \
  "$APP_DIR/deploy/nginx/multiservicios.conf" >/etc/nginx/sites-available/multiservicios.conf
ln -sf /etc/nginx/sites-available/multiservicios.conf /etc/nginx/sites-enabled/multiservicios.conf
rm -f /etc/nginx/sites-enabled/default

systemctl daemon-reload
systemctl enable --now multiservicios
systemctl enable --now multiservicios-backup.timer

backend_ready=0
for _ in $(seq 1 30); do
  if curl --fail --silent "http://127.0.0.1:$APP_PORT/api/health" | grep -q '"ok": true'; then
    backend_ready=1
    break
  fi
  sleep 1
done
if [ "$backend_ready" -ne 1 ]; then
  journalctl -u multiservicios --no-pager -n 80 >&2
  echo "El backend no inicio correctamente." >&2
  exit 1
fi

if [ "$INSTALL_CODE_SERVER" = "1" ]; then
  curl -fsSL https://code-server.dev/install.sh | sh
  if [ -z "$CODE_SERVER_PASSWORD" ]; then
    CODE_SERVER_PASSWORD="$(openssl rand -base64 24)"
    echo "CODE_SERVER_PASSWORD generado: $CODE_SERVER_PASSWORD"
  fi
  mkdir -p "$APP_DIR/.config/code-server"
  cat >"$APP_DIR/.config/code-server/config.yaml" <<EOF
bind-addr: 127.0.0.1:$CODE_PORT
auth: password
password: $CODE_SERVER_PASSWORD
cert: false
EOF
  chown -R "$APP_USER:$APP_USER" "$APP_DIR/.config"
  systemctl enable --now "code-server@$APP_USER"

  sed \
    -e "s/__CODE_DOMAIN__/$CODE_DOMAIN/g" \
    -e "s/__CODE_PORT__/$CODE_PORT/g" \
    "$APP_DIR/deploy/nginx/code-server.conf" >/etc/nginx/sites-available/code-server.conf
  ln -sf /etc/nginx/sites-available/code-server.conf /etc/nginx/sites-enabled/code-server.conf
fi

nginx -t
systemctl reload nginx

ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true

if [ "$ENABLE_SSL" = "1" ]; then
  if [ -z "$LETSENCRYPT_EMAIL" ]; then
    echo "Falta LETSENCRYPT_EMAIL para SSL. Reejecuta con ENABLE_SSL=1 LETSENCRYPT_EMAIL=tu-correo." >&2
    exit 1
  fi
  snap install core || true
  snap refresh core || true
  snap install --classic certbot || true
  ln -sf /snap/bin/certbot /usr/local/bin/certbot
  certbot --nginx --non-interactive --agree-tos --redirect -m "$LETSENCRYPT_EMAIL" -d "$DOMAIN" -d "$WWW_DOMAIN"
  if [ "$INSTALL_CODE_SERVER" = "1" ]; then
    certbot --nginx --non-interactive --agree-tos --redirect -m "$LETSENCRYPT_EMAIL" -d "$CODE_DOMAIN"
  fi
  python3 "$APP_DIR/deploy/verify_production.py" --base-url "https://$DOMAIN"
fi

cat <<EOF

Multiservicios instalado.
Sitio: http://$DOMAIN
Admin: http://$DOMAIN/admin/
Servicio: systemctl status multiservicios
Backups: systemctl status multiservicios-backup.timer
Code-Server: http://$CODE_DOMAIN
App dir: $APP_DIR

Guarda estas claves en un lugar seguro:
MS_ADMIN_PASSWORD=$ADMIN_PASSWORD
CODE_SERVER_PASSWORD=${CODE_SERVER_PASSWORD:-no-instalado}
EOF
