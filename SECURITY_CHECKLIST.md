# SECURITY_CHECKLIST

## Implementado en esta carpeta

- Backend con SQLite.
- Login admin con cookie `HttpOnly` y `SameSite=Lax`.
- Proteccion de paginas `/admin/` desde el servidor.
- Panel para clientes, solicitudes, empresas, servicios, cursos, preguntas, pagos, FAQ, testimonios y auditoria.
- Certificados en base de datos.
- Resultados del curso en base de datos.
- PDFs guardados fuera de `public/`, en `storage/pdfs/`.
- Validacion publica con datos minimos.
- Documentos completos no se devuelven al frontend; se guarda hash y ultimos 4 digitos.
- Catalogo publico alimentado por API.
- Pagos manuales registrados en tabla `payments`.

## Antes de publicar en internet

- Cambiar `MS_ADMIN_PASSWORD`.
- Cambiar `MS_SECRET_KEY`.
- Activar HTTPS.
- Crear backups automaticos de `storage/`.
- Ejecutar detras de un reverse proxy.
- Restringir permisos del sistema de archivos.
- Revisar politica de tratamiento de datos personales.
- Agregar rate limit si el sitio recibe trafico publico.
- Conectar pasarela por webhook servidor-servidor.
- Revisar textos legales con asesor local antes de campanas pagas o operacion masiva.
