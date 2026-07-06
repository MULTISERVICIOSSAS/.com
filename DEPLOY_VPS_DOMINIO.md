# Despliegue VPS + dominio + Code-Server

Esta guia deja Multiservicios corriendo en un VPS Ubuntu con:

- Nginx como proxy publico.
- Python `server.py` como backend/admin/API.
- SQLite y PDFs en `storage/`.
- HTTPS con Certbot / Let's Encrypt.
- Code-Server en un subdominio para editar desde navegador.
- Flujo Git para actualizar produccion.

## 1. Datos que se necesitan

Antes de ejecutar el despliegue real faltan estos datos:

- IP publica del VPS.
- Dominio principal, por ejemplo `multiservicios.com`.
- Subdominio para editor, por ejemplo `code.multiservicios.com`.
- Acceso SSH al VPS como `root` o usuario con `sudo`.
- Correo para Let's Encrypt.
- Clave admin nueva para el panel.
- Clave fuerte para Code-Server.

## 2. DNS del dominio

En el registrador del dominio crea estos registros:

```text
Tipo  Nombre  Valor
A     @       IP_PUBLICA_DEL_VPS
A     www     IP_PUBLICA_DEL_VPS
A     code    IP_PUBLICA_DEL_VPS
```

Espera propagacion. Puedes comprobar desde tu PC:

```powershell
nslookup tudominio.com
nslookup code.tudominio.com
```

## 3. Instalacion inicial en VPS Ubuntu

Entra al servidor:

```bash
ssh root@IP_PUBLICA_DEL_VPS
```

Ejecuta el instalador desde el repositorio:

```bash
apt-get update && apt-get install -y curl
curl -fsSL https://raw.githubusercontent.com/MULTISERVICIOSSAS/.com/main/deploy/vps_setup_ubuntu.sh -o /tmp/vps_setup_ubuntu.sh
chmod +x /tmp/vps_setup_ubuntu.sh

DOMAIN="tudominio.com" \
WWW_DOMAIN="www.tudominio.com" \
CODE_DOMAIN="code.tudominio.com" \
REPO_URL="https://github.com/MULTISERVICIOSSAS/.com.git" \
ADMIN_EMAIL="admin@tudominio.com" \
ADMIN_PASSWORD="CAMBIA_ESTA_CLAVE_ADMIN" \
CODE_SERVER_PASSWORD="CAMBIA_ESTA_CLAVE_CODE_SERVER" \
LETSENCRYPT_EMAIL="tu-correo@tudominio.com" \
ENABLE_SSL="1" \
bash /tmp/vps_setup_ubuntu.sh
```

El script instala Nginx, Git, Python, Certbot, Code-Server, clona el proyecto en `/var/www/multiservicios`, crea `/etc/multiservicios.env`, configura systemd y solicita SSL.

## 4. Verificacion

En el VPS:

```bash
systemctl status multiservicios
systemctl status nginx
systemctl status code-server@multiservicios
nginx -t
curl -I https://tudominio.com/
curl -I https://tudominio.com/admin/
```

En navegador:

```text
https://tudominio.com/
https://tudominio.com/admin/
https://code.tudominio.com/
```

Desde Windows puedes verificar DNS y HTTP con:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\check_domain.ps1 -Domain tudominio.com -CodeDomain code.tudominio.com -ExpectedIp IP_PUBLICA_DEL_VPS
```

## 5. Actualizar produccion

Flujo normal:

```bash
git push origin main
ssh root@IP_PUBLICA_DEL_VPS
cd /var/www/multiservicios
git pull --ff-only origin main
systemctl restart multiservicios
systemctl reload nginx
```

Tambien puedes ejecutar:

```bash
cd /var/www/multiservicios
bash deploy/deploy_pull.sh
```

Desde Windows local:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\local_publish_to_vps.ps1 -HostName IP_PUBLICA_DEL_VPS -User root
```

## 6. GitHub Actions opcional

El workflow manual esta en `.github/workflows/deploy-vps.yml`.

Configura estos secretos en GitHub:

- `VPS_HOST`: IP o dominio del VPS.
- `VPS_USER`: usuario SSH, por ejemplo `root`.
- `VPS_SSH_KEY`: llave privada autorizada en el VPS.
- `VPS_APP_DIR`: opcional, por defecto `/var/www/multiservicios`.

Luego ejecuta el workflow manual **Deploy VPS** desde GitHub Actions.

## 7. Archivos importantes

- `deploy/vps_setup_ubuntu.sh`: instalacion inicial en Ubuntu.
- `deploy/deploy_pull.sh`: actualizacion por Git en servidor.
- `deploy/nginx/multiservicios.conf`: proxy Nginx para el sitio.
- `deploy/nginx/code-server.conf`: proxy Nginx para el editor.
- `deploy/systemd/multiservicios.service`: servicio systemd de la app.
- `deploy/systemd/multiservicios-backup.timer`: backup diario de base y PDFs.
- `deploy/env.production.example`: variables de entorno de produccion.

## 8. Seguridad minima

- Cambia `ADMIN_PASSWORD` y `CODE_SERVER_PASSWORD`.
- Usa HTTPS antes de abrir Code-Server al publico.
- No subas `.env`, bases SQLite ni PDFs privados al repositorio.
- Manten `storage/` con permisos restringidos.
- Activa firewall con `ufw allow OpenSSH` y `ufw allow 'Nginx Full'`.
- Respalda `storage/db/multiservicios.sqlite3` y `storage/pdfs/`.

El instalador activa un backup diario de `storage/`:

```bash
systemctl status multiservicios-backup.timer
systemctl start multiservicios-backup.service
ls -lh /var/backups/multiservicios/
```

## 9. Fuentes oficiales usadas

- Code-Server: https://coder.com/docs/code-server/install
- Certbot Nginx: https://certbot.eff.org/instructions?ws=nginx
