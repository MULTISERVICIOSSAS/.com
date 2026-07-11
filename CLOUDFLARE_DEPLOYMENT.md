# Despliegue en Cloudflare sin VPS

La plataforma usa Cloudflare Workers + Static Assets, D1 para los datos y R2 para los PDF privados.

## Recursos

- Worker: `multiservicios`
- D1: `multiservicios`
- R2: `multiservicios-certificados`
- Dominio: `multiservicios.website`

## Primera publicacion

1. Autenticar Wrangler con `npx wrangler login`.
2. Crear D1 con `npx wrangler d1 create multiservicios`.
3. Reemplazar el `database_id` de `wrangler.jsonc` por el identificador devuelto.
4. Crear R2 con `npx wrangler r2 bucket create multiservicios-certificados`.
5. Aplicar el esquema con `npx wrangler d1 migrations apply multiservicios --remote`.
6. Configurar `ADMIN_PASSWORD_HASH` con el SHA-256 de una clave larga y unica.
7. Configurar `DOCUMENT_HASH_KEY` con un secreto aleatorio de al menos 32 bytes.
8. Publicar con `npx wrangler deploy`.
9. Agregar `multiservicios.website` como Custom Domain del Worker.
10. Cambiar en GoDaddy los nameservers por los asignados por Cloudflare cuando la zona lo solicite.

Los secretos se cargan con `npx wrangler secret put NOMBRE` y nunca se guardan en Git.

## Desarrollo local

1. Instalar dependencias con `pnpm install`.
2. Aplicar D1 local con `pnpm db:migrate:local`.
3. Crear `.dev.vars` con `ADMIN_PASSWORD_HASH` y `DOCUMENT_HASH_KEY`.
4. Iniciar con `pnpm dev`.

`.dev.vars`, `.wrangler` y `node_modules` estan excluidos del repositorio.
