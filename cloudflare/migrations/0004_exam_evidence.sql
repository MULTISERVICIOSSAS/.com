ALTER TABLE course_results ADD COLUMN respuestas_json TEXT;
ALTER TABLE certificates ADD COLUMN course_result_id INTEGER REFERENCES course_results(id);

CREATE INDEX IF NOT EXISTS idx_course_results_document_score
  ON course_results(documento_hash, porcentaje, id);
CREATE INDEX IF NOT EXISTS idx_certificates_course_result
  ON certificates(course_result_id);
