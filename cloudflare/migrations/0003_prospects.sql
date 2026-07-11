CREATE TABLE IF NOT EXISTS prospects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telefono_1 TEXT,
  telefono_2 TEXT,
  telefono_3 TEXT,
  telefono_4 TEXT,
  correo TEXT,
  ciudad TEXT,
  establecimiento TEXT,
  actividad TEXT,
  encargado TEXT,
  titular_servicio TEXT,
  documento_identidad TEXT,
  resultado_gestion TEXT,
  direccion TEXT,
  observaciones TEXT,
  fecha_ingreso TEXT,
  agente TEXT,
  fecha_envio_whatsapp TEXT,
  observacion_adicional TEXT,
  estado_crm TEXT NOT NULL DEFAULT 'Nuevo',
  notas_crm TEXT,
  source_file TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  fecha_importacion TEXT NOT NULL,
  fecha_actualizacion TEXT NOT NULL,
  UNIQUE(source_file, source_sheet, source_row)
);

CREATE INDEX IF NOT EXISTS idx_prospects_establecimiento ON prospects(establecimiento);
CREATE INDEX IF NOT EXISTS idx_prospects_ciudad ON prospects(ciudad);
CREATE INDEX IF NOT EXISTS idx_prospects_telefono_1 ON prospects(telefono_1);
CREATE INDEX IF NOT EXISTS idx_prospects_resultado ON prospects(resultado_gestion);
CREATE INDEX IF NOT EXISTS idx_prospects_estado_crm ON prospects(estado_crm);
