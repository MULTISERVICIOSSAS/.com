# Multiservicios Backend Verificado

Plataforma local conectada a backend para Multiservicios: sitio publico, registro de clientes, curso, examen, generador de certificados, validacion publica, panel privado y almacenamiento de PDFs fuera de `public/`.

## Inicio rapido

Desde esta carpeta:

```powershell
python .\server.py
```

Abrir:

```text
http://127.0.0.1:8090/
```

Panel administrativo:

```text
http://127.0.0.1:8090/admin/
```

Clave local inicial: `MULTISERVICIOS`.

Antes de publicar cambia `MS_ADMIN_PASSWORD` y `MS_SECRET_KEY`.

## Variables

- `MS_HOST`: host del servidor. Local recomendado: `127.0.0.1`.
- `MS_PORT`: puerto. Local recomendado: `8090`.
- `MS_ADMIN_EMAIL`: correo admin.
- `MS_ADMIN_PASSWORD`: clave inicial admin.
- `MS_SECRET_KEY`: clave larga para hashes de documentos.
- `MS_PAYMENT_MODE`: `manual` por defecto.
- `MS_PAYMENT_PROVIDER`: `manual`, `wompi`, `mercadopago` u otro cuando se conecte proveedor.
- `MS_PAYMENT_PUBLIC_KEY`: llave publica de pasarela, si aplica.

## Estructura

- `server.py`: backend HTTP, API JSON, sesiones, SQLite, proteccion de `/admin`.
- `public/`: sitio web, assets, apps, admin y paginas publicas.
- `storage/db/multiservicios.sqlite3`: base de datos local.
- `storage/pdfs/`: PDFs privados guardados por la API.

## Paginas principales

- Publicas: `/`, `/cursos.html`, `/registro.html`, `/servicios.html`, `/empresas.html`, `/extintores.html`, `/validar-certificado.html`, `/mi-certificado.html`, `/preguntas-frecuentes.html`, `/tratamiento-datos.html`, `/contacto.html`.
- Curso/examen: `/apps/modulos-examen/index.html`.
- Admin: `/admin/`, `/admin/dashboard.html`, `/admin/gestion.html`, `/admin/certificados-admin.html`, `/admin/generador-certificados/index.html`.

## APIs publicas

- `GET /api/public/catalogo`: servicios, cursos, preguntas frecuentes, testimonios y estado de pago.
- `POST /api/solicitudes`: solicitud de cliente/estudiante.
- `POST /api/empresas`: solicitud para grupos o empresas.
- `GET /api/certificados/validar?codigo=...&documento=...`: validacion publica.

## APIs admin

- Auth: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- Estadisticas: `GET /api/admin/stats`.
- Clientes: `GET/POST /api/admin/clientes`.
- Solicitudes: `GET /api/admin/solicitudes`, `PATCH /api/admin/solicitudes/{id}`.
- Empresas: `GET /api/admin/empresas`.
- Servicios: `GET/POST /api/admin/servicios`.
- Cursos: `GET/POST /api/admin/cursos`.
- Preguntas: `GET/POST /api/admin/preguntas`.
- Pagos: `GET/POST /api/admin/pagos`, `PATCH /api/admin/pagos/{id}`.
- FAQ: `GET/POST /api/admin/faqs`.
- Testimonios: `GET/POST /api/admin/testimonios`.
- Auditoria: `GET /api/admin/auditoria`.
- Certificados: `GET/POST /api/admin/certificados`, `PATCH /api/admin/certificados/{codigo}/anular`, `POST /api/admin/certificados/{codigo}/pdf`.
- Resultados: `GET /api/admin/resultados`, `POST /api/admin/resultados`.

## Base para subir certificados

La tabla central es `certificates`. Para cargar certificados desde Excel/CSV o desde otra app, prepara estos campos:

```text
codigo_unico,nombre_estudiante,documento,curso,intensidad_horaria,fecha_emision,fecha_vencimiento,estado,archivo_pdf_url,qr_url,validation_url
```

Reglas:

- `codigo_unico` debe ser unico. Ejemplo: `MS-2026-0001`.
- `documento` se recibe solo para calcular hash, ultimos 4 digitos y mascara; no se publica completo.
- `estado` recomendado: `Activo`, `Anulado`, `Vencido`.
- `archivo_pdf_url` puede quedar vacio si se guarda PDF privado con la API.
- `validation_url` debe apuntar a `/validar-certificado.html?codigo=CODIGO`.

## Conexion con el generador de certificados

El generador interno ya guarda contra la API. Cualquier app externa puede conectarse igual:

```http
POST /api/admin/certificados
Content-Type: application/json
Cookie: ms_admin_session=...
```

```json
{
  "codigo_unico": "MS-2026-0001",
  "nombre_estudiante": "Nombre Apellido",
  "documento": "1234567890",
  "curso": "Manipulacion de Alimentos",
  "intensidad_horaria": "10 horas",
  "fecha_emision": "2026-06-29",
  "fecha_vencimiento": "2027-06-29",
  "estado": "Activo",
  "validation_url": "/validar-certificado.html?codigo=MS-2026-0001"
}
```

Para guardar el PDF privado:

```http
POST /api/admin/certificados/MS-2026-0001/pdf
Content-Type: application/json
```

```json
{
  "content_base64": "JVBERi0x..."
}
```

El PDF queda en `storage/pdfs/` y no se sirve como archivo publico.

## Pagos

El sistema queda preparado para pagos manuales:

1. El cliente registra solicitud en `/registro.html`.
2. Puede indicar referencia o comprobante manual.
3. Admin revisa y actualiza pagos en `/admin/gestion.html`.

Para pasarela real falta agregar el webhook del proveedor elegido y mapearlo a `payments.estado`. Las variables `MS_PAYMENT_*` ya dejan preparado el modo de configuracion.

## Flujo verificado

1. Cliente entra a `/registro.html` o `/empresas.html`.
2. La solicitud queda en SQLite.
3. Admin revisa clientes, solicitudes y pagos en `/admin/gestion.html`.
4. Cliente puede hacer curso/examen en `/apps/modulos-examen/`.
5. Resultado queda en `course_results`.
6. Admin emite certificado desde el generador.
7. Validacion publica consulta `/api/certificados/validar`.
8. PDFs quedan fuera de `public/`.

## Publicacion

Para operar en internet:

- Usar dominio y HTTPS.
- Ejecutar detras de Nginx, Caddy o Apache.
- Definir claves reales por variables de entorno.
- Mantener `storage/` fuera de carpetas publicas.
- Programar backup de `storage/db/` y `storage/pdfs/`.
- Agregar rate limit y monitoreo si aumenta el trafico.
