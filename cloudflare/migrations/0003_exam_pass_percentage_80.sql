UPDATE courses SET puntaje_minimo = 80;
UPDATE exams SET puntaje_minimo = 80;
UPDATE course_results
SET estado = CASE WHEN porcentaje >= 80 THEN 'Aprobado' ELSE 'No aprobado' END;
