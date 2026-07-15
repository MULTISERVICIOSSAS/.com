UPDATE services
SET estado = 'Inactivo', fecha_actualizacion = datetime('now')
WHERE slug = 'plan-saneamiento-control-plagas';
