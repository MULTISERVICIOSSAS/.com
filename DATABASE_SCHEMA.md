# DATABASE_SCHEMA

El backend local usa SQLite en `storage/db/multiservicios.sqlite3`.

## Tablas implementadas

- `admins`: usuarios administradores reales del login.
- `sessions`: sesiones con cookie `HttpOnly`.
- `users`: espejo operativo para roles/usuarios de negocio.
- `customers`: clientes/estudiantes con documento hasheado y mascara publica.
- `services`: servicios, planes y precios editables.
- `courses`: cursos disponibles.
- `modules`: modulos por curso.
- `lessons`: lecciones por modulo.
- `exams`: examenes por curso.
- `questions`: preguntas de examen.
- `answers`: respuestas normalizadas si se quieren separar opciones.
- `attempts`: intentos de estudiantes.
- `course_results`: resultados generados por la app de curso actual.
- `certificates`: certificados emitidos y validados.
- `payments`: pagos manuales o futuros pagos de pasarela.
- `settings`: configuraciones editables.
- `audit_logs`: auditoria operativa.
- `logs`: log compatible del panel anterior.
- `contact_requests`: solicitudes de clientes.
- `company_requests`: solicitudes empresariales.
- `testimonials`: testimonios publicables.
- `faqs`: preguntas frecuentes publicables.

## Certificados

Campos principales de `certificates`:

```text
codigo_unico
nombre_estudiante
documento_hash
documento_last4
documento_masked
curso
intensidad_horaria
fecha_emision
fecha_vencimiento
estado
archivo_pdf_path
archivo_pdf_url
qr_url
validation_url
creado_por
fecha_creacion
fecha_actualizacion
motivo_anulacion
```

El frontend nunca recibe documento completo. La validacion publica retorna datos minimos.

## Carga masiva recomendada

Para importar desde Excel/CSV usa una tabla base con:

```text
codigo_unico,nombre_estudiante,documento,curso,intensidad_horaria,fecha_emision,fecha_vencimiento,estado
```

Luego un script o app externa debe llamar `POST /api/admin/certificados`. El backend calcula:

- `documento_hash`
- `documento_last4`
- `documento_masked`
- `validation_url`
- fechas de creacion/actualizacion

## Indices creados

- `idx_certificates_codigo`
- `idx_certificates_documento_hash`
- `idx_customers_documento_hash`
- `idx_customers_correo`
- `idx_contact_requests_estado`
- `idx_payments_estado`
- `idx_exams_course_id`
- `idx_questions_course_id`

## Reglas de seguridad

- Cambiar `MS_SECRET_KEY` antes de cargar documentos reales.
- Mantener PDFs en `storage/pdfs/`, no en `public/`.
- Usar HTTPS en internet.
- Hacer backups de DB y PDFs.
- Registrar emision, anulacion, login y cambios admin en auditoria.
