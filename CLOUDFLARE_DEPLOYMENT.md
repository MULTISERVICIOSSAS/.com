# Despliegue en Cloudflare sin VPS

La plataforma usa Cloudflare Workers + Static Assets y D1 para los datos. Los PDF se guardan de forma privada en bloques D1 y solo se descargan con sesion administrativa.

## Recursos

- Worker: `multiservicios`
- D1: `multiservicios`
- Dominio: `multiservicios.website`

## Primera publicacion

1. Autenticar Wrangler con `npx wrangler login`.
2. Crear D1 con `npx wrangler d1 create multiservicios`.
3. Reemplazar el `database_id` de `wrangler.jsonc` por el identificador devuelto.
4. Aplicar el esquema con `npx wrangler d1 migrations apply multiservicios --remote`.
5. Configurar `ADMIN_PASSWORD_HASH` con el SHA-256 de una clave larga y unica.
6. Configurar `DOCUMENT_HASH_KEY` con un secreto aleatorio de al menos 32 bytes.
7. Publicar con `npx wrangler deploy`.
8. Agregar `multiservicios.website` como Custom Domain del Worker.
9. Cambiar en GoDaddy los nameservers por los asignados por Cloudflare cuando la zona lo solicite.

Los secretos se cargan con `npx wrangler secret put NOMBRE` y nunca se guardan en Git.

## Desarrollo local

1. Instalar dependencias con `pnpm install`.
2. Aplicar D1 local con `pnpm db:migrate:local`.
3. Crear `.dev.vars` con `ADMIN_PASSWORD_HASH` y `DOCUMENT_HASH_KEY`.
4. Iniciar con `pnpm dev`.

`.dev.vars`, `.wrangler` y `node_modules` estan excluidos del repositorio.
