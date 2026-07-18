# Multiservicios

Plataforma web publicada en Cloudflare Workers con frontend estatico, API segura y base de datos Cloudflare D1. Incluye curso, examen, CRM administrativo, pagos manuales, certificados PDF privados y validacion publica por codigo QR.

## Produccion

- Sitio: <https://multiservicios.website/>
- Curso: <https://multiservicios.website/apps/modulos-examen/>
- Validacion: <https://multiservicios.website/validar-certificado.html>
- Administracion: <https://multiservicios.website/admin/>
- Salud: <https://multiservicios.website/api/health>

Todas las rutas administrativas, incluidos los dos generadores, requieren una sesion valida.

## Generadores

- `admin/generador-certificados/`: carnet y certificado de manipulacion de alimentos, anexos y PDF privado.
- `admin/generador-certificados-medicos/`: certificado medico A4 con profesional autorizado, firma, codigo unico, QR, registro D1 y PDF privado.

El generador medico precarga los datos y la firma autorizada del Dr. Marcos Norberto Pinto Prada. Antes de emitir exige confirmar que el profesional realizo la valoracion. No debe utilizarse para generar resultados que el medico no haya determinado.

## Desarrollo Cloudflare

```powershell
pnpm install
pnpm db:migrate:local
pnpm dev
```

Configura los secretos en `.dev.vars`; no los guardes en Git:

- `ADMIN_PASSWORD_HASH`: SHA-256 de la clave administrativa.
- `DOCUMENT_HASH_KEY`: secreto aleatorio para proteger documentos.

## Pruebas

```powershell
pnpm test
python -m unittest discover -s tests
```

## Despliegue

```powershell
pnpm db:migrate:remote
pnpm deploy
```

Consulta [CLOUDFLARE_DEPLOYMENT.md](CLOUDFLARE_DEPLOYMENT.md), [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) y [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) para operacion, seguridad y estructura de datos. Las credenciales, bases reales, PDFs y respaldos deben permanecer fuera del repositorio.
