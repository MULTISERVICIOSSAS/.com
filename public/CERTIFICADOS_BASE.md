# Base de certificados

Esta version ya usa backend con SQLite.

## Flujo actual

1. El admin inicia sesion en `/admin/`.
2. El generador crea el certificado.
3. El registro se guarda por `POST /api/admin/certificados` cuando el backend esta encendido.
4. El PDF puede guardarse por `POST /api/admin/certificados/{codigo}/pdf`.
5. La validacion publica consulta `GET /api/certificados/validar` en local/backend.
6. Para GitHub Pages, usa `Actualizar base publica` en `admin/certificados-admin.html`, revisa `data/certificados.json`, haz commit y push.

El QR/enlace generado tambien incluye datos publicos minimos del certificado para que la validacion funcione al escanearlo aunque la base JSON todavia no se haya publicado.

## Validacion publica

```text
GET /api/certificados/validar?codigo=MS-2026-0001&documento=1234
```

La respuesta muestra datos minimos:

- Codigo.
- Titular.
- Documento parcial.
- Curso.
- Fechas.
- Estado.

## Respaldo JSON

Botones disponibles en el registro central:

- `Actualizar base publica`: con backend local escribe `data/certificados.json` y `public/data/certificados.json`.
- `Exportar certificados.json`: descarga una copia para respaldo o carga manual.
- `Copiar JSON`: copia la base publica al portapapeles.

En GitHub Pages no existe backend ni SQLite. La validacion publica usa `data/certificados.json`, certificados generados en el mismo navegador o el enlace QR con datos minimos.

## Conexion externa

Si otra app genera certificados, debe autenticarse como admin y llamar:

```text
POST /api/admin/certificados
POST /api/admin/certificados/{codigo}/pdf
```

Consulta el formato completo en `../README_BACKEND.md`.
