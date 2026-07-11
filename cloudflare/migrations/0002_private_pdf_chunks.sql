CREATE TABLE IF NOT EXISTS certificate_pdf_chunks (
  certificate_code TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content BLOB NOT NULL,
  fecha_creacion TEXT NOT NULL,
  PRIMARY KEY (certificate_code, chunk_index),
  FOREIGN KEY (certificate_code) REFERENCES certificates(codigo_unico) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_certificate_pdf_chunks_code
  ON certificate_pdf_chunks(certificate_code, chunk_index);
