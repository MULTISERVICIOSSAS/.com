ALTER TABLE certificates ADD COLUMN certificate_type TEXT NOT NULL DEFAULT 'course';
ALTER TABLE certificates ADD COLUMN profesional_nombre TEXT;
ALTER TABLE certificates ADD COLUMN profesional_especialidad TEXT;
ALTER TABLE certificates ADD COLUMN profesional_registro TEXT;
ALTER TABLE certificates ADD COLUMN resultado_medico TEXT;
ALTER TABLE certificates ADD COLUMN fecha_examen TEXT;

CREATE TABLE IF NOT EXISTS certificate_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  certificate_id INTEGER NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_email TEXT,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_certificates_type ON certificates(certificate_type, estado);
CREATE INDEX IF NOT EXISTS idx_certificate_events_certificate ON certificate_events(certificate_id, created_at);
