# Base de certificados

Esta version ya usa backend con SQLite.

## Flujo actual

1. El admin inicia sesion en `/admin/`.
2. El generador crea el certificado.
3. El registro se guarda por `POST /api/admin/certificados`.
4. El PDF puede guardarse por `POST /api/admin/certificados/{codigo}/pdf`.
5. La validacion publica consulta `GET /api/certificados/validar`.

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

El boton `Exportar certificados.json` queda disponible solo como respaldo operativo. El flujo principal debe ser la base SQLite y la API.

## Conexion externa

Si otra app genera certificados, debe autenticarse como admin y llamar:

```text
POST /api/admin/certificados
POST /api/admin/certificados/{codigo}/pdf
```

Consulta el formato completo en `../README_BACKEND.md`.
