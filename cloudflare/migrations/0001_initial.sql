PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo_unico TEXT UNIQUE NOT NULL,
  nombre_estudiante TEXT NOT NULL,
  documento_hash TEXT,
  documento_last4 TEXT,
  documento_masked TEXT,
  curso TEXT NOT NULL,
  intensidad_horaria TEXT,
  fecha_emision TEXT NOT NULL,
  fecha_vencimiento TEXT,
  estado TEXT NOT NULL DEFAULT 'Activo',
  pdf_key TEXT,
  qr_url TEXT,
  validation_url TEXT,
  fecha_creacion TEXT NOT NULL,
  fecha_actualizacion TEXT NOT NULL,
  motivo_anulacion TEXT
);

CREATE TABLE IF NOT EXISTS course_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  documento_hash TEXT,
  documento_last4 TEXT,
  documento_masked TEXT,
  correo TEXT,
  telefono TEXT,
  curso TEXT NOT NULL,
  puntaje INTEGER NOT NULL,
  total INTEGER NOT NULL,
  porcentaje INTEGER NOT NULL,
  estado TEXT NOT NULL,
  fecha TEXT NOT NULL,
  fecha_creacion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  tipo_documento TEXT,
  documento_hash TEXT,
  documento_last4 TEXT,
  documento_masked TEXT,
  correo TEXT,
  celular TEXT,
  ciudad TEXT,
  empresa TEXT,
  servicio_interes TEXT,
  estado TEXT NOT NULL DEFAULT 'Activo',
  fecha_creacion TEXT NOT NULL,
  fecha_actualizacion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  slug TEXT UNIQUE,
  descripcion TEXT,
  beneficios TEXT,
  requisitos TEXT,
  duracion TEXT,
  modalidad TEXT,
  precio TEXT,
  estado TEXT NOT NULL DEFAULT 'Activo',
  orden INTEGER NOT NULL DEFAULT 0,
  fecha_creacion TEXT NOT NULL,
  fecha_actualizacion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  slug TEXT UNIQUE,
  descripcion TEXT,
  duracion TEXT,
  modalidad TEXT,
  puntaje_minimo INTEGER NOT NULL DEFAULT 80,
  intentos_maximos INTEGER NOT NULL DEFAULT 2,
  estado TEXT NOT NULL DEFAULT 'Activo',
  fecha_creacion TEXT NOT NULL,
  fecha_actualizacion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  puntaje_minimo INTEGER NOT NULL DEFAULT 80,
  intentos_maximos INTEGER NOT NULL DEFAULT 2,
  estado TEXT NOT NULL DEFAULT 'Activo',
  fecha_creacion TEXT NOT NULL,
  fecha_actualizacion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER REFERENCES exams(id) ON DELETE CASCADE,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  pregunta TEXT NOT NULL,
  opciones_json TEXT NOT NULL,
  respuesta_correcta INTEGER NOT NULL DEFAULT 0,
  puntaje INTEGER NOT NULL DEFAULT 1,
  estado TEXT NOT NULL DEFAULT 'Activo',
  fecha_creacion TEXT NOT NULL,
  fecha_actualizacion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id),
  nombre_cliente TEXT,
  servicio TEXT,
  monto TEXT,
  moneda TEXT NOT NULL DEFAULT 'COP',
  metodo TEXT NOT NULL DEFAULT 'Manual',
  referencia TEXT,
  estado TEXT NOT NULL DEFAULT 'Pendiente',
  comprobante_nombre TEXT,
  notas TEXT,
  fecha_creacion TEXT NOT NULL,
  fecha_actualizacion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT,
  accion TEXT NOT NULL,
  descripcion TEXT,
  fecha TEXT NOT NULL,
  ip TEXT
);

CREATE TABLE IF NOT EXISTS contact_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  tipo_documento TEXT,
  documento_hash TEXT,
  documento_last4 TEXT,
  documento_masked TEXT,
  correo TEXT,
  celular TEXT,
  ciudad TEXT,
  servicio TEXT,
  empresa TEXT,
  mensaje TEXT,
  acepta_datos INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'Pendiente',
  payment_status TEXT NOT NULL DEFAULT 'Pendiente',
  fecha_creacion TEXT NOT NULL,
  fecha_actualizacion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS company_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa TEXT NOT NULL,
  contacto TEXT NOT NULL,
  correo TEXT,
  celular TEXT,
  ciudad TEXT,
  cantidad_personas INTEGER NOT NULL DEFAULT 1,
  servicio TEXT,
  mensaje TEXT,
  estado TEXT NOT NULL DEFAULT 'Pendiente',
  fecha_creacion TEXT NOT NULL,
  fecha_actualizacion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS testimonials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  cargo TEXT,
  texto TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'Activo',
  orden INTEGER NOT NULL DEFAULT 0,
  fecha_creacion TEXT NOT NULL,
  fecha_actualizacion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pregunta TEXT NOT NULL,
  respuesta TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'General',
  estado TEXT NOT NULL DEFAULT 'Activo',
  orden INTEGER NOT NULL DEFAULT 0,
  fecha_creacion TEXT NOT NULL,
  fecha_actualizacion TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_certificates_code ON certificates(codigo_unico);
CREATE INDEX IF NOT EXISTS idx_certificates_document ON certificates(documento_hash, documento_last4);
CREATE INDEX IF NOT EXISTS idx_course_results_created ON course_results(fecha_creacion);
CREATE INDEX IF NOT EXISTS idx_contact_requests_state ON contact_requests(estado);
CREATE INDEX IF NOT EXISTS idx_payments_state ON payments(estado);

INSERT OR IGNORE INTO certificates
  (codigo_unico, nombre_estudiante, documento_last4, documento_masked, curso, intensidad_horaria,
   fecha_emision, fecha_vencimiento, estado, fecha_creacion, fecha_actualizacion)
VALUES
  ('MS-MTOV8L8I', 'No publicado', '2222', '****2222', 'Manipulacion de Alimentos', '10 horas', '2026-07-06', '2027-07-06', 'Activo', datetime('now'), datetime('now')),
  ('MS-G4D682E7', 'No publicado', '3333', '****3333', 'Manipulacion de Alimentos', '10 horas', '2026-07-06', '2027-07-06', 'Activo', datetime('now'), datetime('now')),
  ('MS-D3EC4TP5', 'No publicado', '4444', '****4444', 'Manipulacion de Alimentos', '10 horas', '2026-07-06', '2027-07-06', 'Activo', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO services
  (nombre, slug, descripcion, duracion, modalidad, precio, estado, orden, fecha_creacion, fecha_actualizacion)
VALUES
  ('Certificado de manipulacion de alimentos', 'certificado-manipulacion-alimentos', 'Formacion y evaluacion para manipuladores de alimentos.', '10 horas', 'Virtual', 'Consultar', 'Activo', 1, datetime('now'), datetime('now')),
  ('Capacitacion en extintores', 'capacitacion-extintores', 'Entrenamiento en prevencion y respuesta inicial ante incendios.', 'Segun alcance', 'Presencial', 'Consultar', 'Activo', 2, datetime('now'), datetime('now')),
  ('Lavado y desinfeccion de tanques', 'lavado-desinfeccion-tanques', 'Servicio de saneamiento para instalaciones y empresas.', 'Segun capacidad', 'Presencial', 'Consultar', 'Activo', 3, datetime('now'), datetime('now')),
  ('Plan de saneamiento y control de plagas', 'plan-saneamiento-control-plagas', 'Diagnostico, intervencion y seguimiento de saneamiento.', 'Segun alcance', 'Presencial', 'Consultar', 'Activo', 4, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO courses
  (id, nombre, slug, descripcion, duracion, modalidad, puntaje_minimo, intentos_maximos, estado, fecha_creacion, fecha_actualizacion)
VALUES
  (1, 'Manipulacion de Alimentos', 'manipulacion-de-alimentos', 'Curso de 27 modulos con examen final.', '10 horas', 'Virtual', 70, 2, 'Activo', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO exams
  (id, course_id, nombre, puntaje_minimo, intentos_maximos, estado, fecha_creacion, fecha_actualizacion)
VALUES
  (1, 1, 'Examen Manipulacion de Alimentos', 70, 2, 'Activo', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO faqs
  (id, pregunta, respuesta, categoria, estado, orden, fecha_creacion, fecha_actualizacion)
VALUES
  (1, 'Como valido un certificado?', 'Ingresa el codigo unico en la pagina Validar certificado.', 'Certificados', 'Activo', 1, datetime('now'), datetime('now')),
  (2, 'El curso es virtual?', 'El curso de manipulacion de alimentos puede realizarse en modalidad virtual.', 'Cursos', 'Activo', 2, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO testimonials
  (id, nombre, cargo, texto, estado, orden, fecha_creacion, fecha_actualizacion)
VALUES
  (1, 'Cliente empresarial', 'Administracion', 'Atencion clara y proceso de certificacion organizado.', 'Activo', 1, datetime('now'), datetime('now'));
