# Multiservicios - Proyecto completo funcionando

Esta carpeta contiene el sitio completo de Multiservicios con backend local, base SQLite, administrador, validacion publica, curso, imagenes, volante digital y enlaces de WhatsApp actualizados.

## Como iniciar

1. Abre `INICIAR_MULTISERVICIOS.bat`.
2. Espera a que aparezca el mensaje del servidor local.
3. Abre `ABRIR_LINKS_MULTISERVICIOS.bat` o usa los enlaces de abajo.

## Enlaces locales

- Sitio completo: http://127.0.0.1:8090/sitio-completo/
- Sitio publico: http://127.0.0.1:8090/
- Admin: http://127.0.0.1:8090/admin/
- Dashboard: http://127.0.0.1:8090/admin/dashboard.html
- Validar certificado: http://127.0.0.1:8090/validar-certificado.html
- Curso y examen: http://127.0.0.1:8090/apps/modulos-examen/index.html
- Volante digital: http://127.0.0.1:8090/apps/volante-digital/index.html

## Acceso admin

- Usuario: admin@multiservicios.local
- Clave: MULTISERVICIOS

## Prueba de validacion

Codigo activo de prueba:

```text
MS-D3EC4TP5
Documento: 1111
```

Nota: `MS-2026-0001` esta guardado como anulado en la base local, por eso aparece en revision/anulado aunque el formulario funcione.

Si generas un certificado nuevo en GitHub Pages y lo validas en el mismo navegador, funciona con el almacenamiento local. Para que funcione en otro celular, navegador privado o despues de limpiar datos, debes publicar la base.

## Publicar base de certificados

1. Inicia el backend local con `INICIAR_MULTISERVICIOS.bat`.
2. Entra a `http://127.0.0.1:8090/admin/`.
3. Genera o revisa certificados.
4. Abre `Registro central`.
5. Pulsa `Actualizar base publica`.
6. Verifica que se actualicen `data/certificados.json` y `public/data/certificados.json`.
7. Haz commit y push a GitHub.

## Donde esta cada cosa

- Pagina completa generada: `public/sitio-completo/index.html`
- Admin: `public/admin/`
- Curso/examen: `public/apps/modulos-examen/index.html`
- Volante digital: `public/apps/volante-digital/index.html`
- Imagenes y logo: `public/assets/` y `public/sitio-completo/assets/`
- Base de datos local: `storage/db/multiservicios.sqlite3`
- PDFs privados: `storage/pdfs/`

## Contacto configurado

WhatsApp visible configurado en todo el proyecto:

```text
3222166831
```

Los enlaces de WhatsApp agregan el prefijo internacional solo al abrir `wa.me`, para que el numero funcione correctamente.

## Pendiente antes de publicar

- Reemplazar datos de prueba por certificados y clientes reales.
- Cambiar `MS_SECRET_KEY` y `MS_ADMIN_PASSWORD` por variables seguras.
- Configurar dominio, correo, ciudad y datos comerciales reales.
- Subir PDFs reales a `storage/pdfs/` o generarlos desde el admin.
