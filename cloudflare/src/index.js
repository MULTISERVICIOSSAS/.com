import { audit, consumeRateLimit, currentAdmin, login, logout, sameOrigin } from "./auth.js";
import {
  cleanText,
  decodeBase64,
  documentLast4,
  extractCertificateCode,
  hmacHex,
  integer,
  json,
  maskDocument,
  nowIso,
  publicCertificateUrls,
  slugify,
  withSecurityHeaders
} from "./utils.js";

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const PDF_CHUNK_BYTES = 256 * 1024;
const LIST_LIMIT = 500;

function error(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

async function body(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_PDF_BYTES * 1.4) throw new Error("Solicitud demasiado grande");
  return request.json().catch(() => {
    throw new Error("JSON invalido");
  });
}

function ip(request) {
  return cleanText(request.headers.get("CF-Connecting-IP") || "local", 80);
}

async function protectedAdmin(request, env) {
  const admin = await currentAdmin(request, env);
  return admin || null;
}

async function rows(db, sql, bindings = []) {
  const result = await db.prepare(sql).bind(...bindings).all();
  return result.results || [];
}

function publicCertificate(row, env) {
  const urls = publicCertificateUrls(env.PUBLIC_URL || "https://multiservicios.website", row.codigo_unico);
  return {
    codigo: row.codigo_unico,
    codigo_unico: row.codigo_unico,
    nombre: row.nombre_estudiante,
    nombre_estudiante: row.nombre_estudiante,
    documento_parcial: row.documento_masked || maskDocument(row.documento_last4),
    curso: row.curso,
    intensidad_horaria: row.intensidad_horaria || "",
    fecha_emision: row.fecha_emision,
    fecha_vencimiento: row.fecha_vencimiento || "",
    estado: row.estado,
    qr: urls.qrUrl,
    qr_url: urls.qrUrl,
    validation_url: urls.validationUrl,
    url_pdf: "",
    archivo_pdf_url: ""
  };
}

function adminCertificate(row, env) {
  return {
    ...publicCertificate(row, env),
    id: row.id,
    documento: row.documento_masked || "",
    pdf_privado: Boolean(row.pdf_key),
    motivo_anulacion: row.motivo_anulacion || "",
    fecha_creacion: row.fecha_creacion,
    fecha_actualizacion: row.fecha_actualizacion
  };
}

async function validateCertificate(request, env, url) {
  const code = extractCertificateCode(url.searchParams.get("codigo"));
  const document = cleanText(url.searchParams.get("documento"), 80);
  if (!code && !document) return error("Ingresa codigo o documento");

  let row;
  if (code) {
    row = await env.DB.prepare("SELECT * FROM certificates WHERE codigo_unico = ?").bind(code).first();
    if (!row && /[O0]/.test(code)) {
      const equivalentCode = code.replace(/O/g, "0");
      const candidates = await rows(
        env.DB,
        "SELECT * FROM certificates WHERE REPLACE(codigo_unico, 'O', '0') = ? ORDER BY id DESC LIMIT 2",
        [equivalentCode]
      );
      if (candidates.length === 1) row = candidates[0];
      if (candidates.length > 1 && document) {
        const last4 = documentLast4(document);
        row = candidates.find((candidate) => candidate.documento_last4 === last4);
      }
    }
  } else {
    const last4 = documentLast4(document);
    const hash = await hmacHex(env.DOCUMENT_HASH_KEY || "local-development", document.replace(/\D/g, ""));
    row = await env.DB.prepare(
      "SELECT * FROM certificates WHERE documento_hash = ? OR documento_last4 = ? ORDER BY id DESC LIMIT 1"
    ).bind(hash, last4).first();
  }
  if (!row) return json({ ok: false, found: false }, 404);

  let documentMatches = true;
  if (document) {
    const normalized = document.replace(/\D/g, "");
    const hash = await hmacHex(env.DOCUMENT_HASH_KEY || "local-development", normalized);
    documentMatches = Boolean((row.documento_hash && row.documento_hash === hash) || row.documento_last4 === documentLast4(document));
  }
  const certificate = publicCertificate(row, env);
  if (!documentMatches) certificate.estado = "Revision requerida";
  return json({ ok: true, found: true, documento_coincide: documentMatches, certificado: certificate });
}

async function publicCatalog(env) {
  const [services, faqs, testimonials, courses] = await Promise.all([
    rows(env.DB, "SELECT * FROM services WHERE estado='Activo' ORDER BY orden, id"),
    rows(env.DB, "SELECT * FROM faqs WHERE estado='Activo' ORDER BY orden, id"),
    rows(env.DB, "SELECT * FROM testimonials WHERE estado='Activo' ORDER BY orden, id"),
    rows(env.DB, "SELECT * FROM courses WHERE estado='Activo' ORDER BY id")
  ]);
  return json({ ok: true, services, faqs, testimonials, courses, payment: { mode: "manual", enabled: true } });
}

async function publicRateLimit(request, env, name, maximum = 30) {
  const result = await consumeRateLimit(env.DB, `${name}:${ip(request)}`, maximum, 3600);
  return result.allowed ? null : error("Demasiadas solicitudes. Intenta mas tarde.", 429);
}

async function createContact(request, env) {
  const limited = await publicRateLimit(request, env, "contact");
  if (limited) return limited;
  const data = await body(request);
  const name = cleanText(data.nombre, 180);
  const document = cleanText(data.documento, 80).replace(/\D/g, "");
  const email = cleanText(data.correo, 160);
  const phone = cleanText(data.celular, 80);
  const service = cleanText(data.servicio, 180);
  if (!name || !document || !email || !phone || !service) return error("Completa los campos obligatorios");
  if (!data.acepta_datos) return error("Debes aceptar el tratamiento de datos");
  const now = nowIso();
  await env.DB.prepare(`INSERT INTO contact_requests
    (nombre,tipo_documento,documento_hash,documento_last4,documento_masked,correo,celular,ciudad,servicio,empresa,mensaje,acepta_datos,estado,payment_status,fecha_creacion,fecha_actualizacion)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,1,'Pendiente','Pendiente',?,?)`)
    .bind(name, cleanText(data.tipo_documento, 30), await hmacHex(env.DOCUMENT_HASH_KEY || "local-development", document),
      documentLast4(document), maskDocument(document), email, phone, cleanText(data.ciudad, 100), service,
      cleanText(data.empresa, 180), cleanText(data.mensaje, 1000), now, now).run();
  return json({ ok: true, message: "Solicitud registrada" }, 201);
}

async function createCompany(request, env) {
  const limited = await publicRateLimit(request, env, "company");
  if (limited) return limited;
  const data = await body(request);
  const company = cleanText(data.empresa, 180);
  const contact = cleanText(data.contacto, 180);
  const phone = cleanText(data.celular, 80);
  if (!company || !contact || !phone) return error("Empresa, contacto y celular son requeridos");
  const now = nowIso();
  await env.DB.prepare(`INSERT INTO company_requests
    (empresa,contacto,correo,celular,ciudad,cantidad_personas,servicio,mensaje,estado,fecha_creacion,fecha_actualizacion)
    VALUES (?,?,?,?,?,?,?,?, 'Pendiente',?,?)`)
    .bind(company, contact, cleanText(data.correo, 160), phone, cleanText(data.ciudad, 100),
      Math.max(1, integer(data.cantidad_personas, 1)), cleanText(data.servicio, 180), cleanText(data.mensaje, 1000), now, now).run();
  return json({ ok: true, message: "Solicitud empresarial registrada" }, 201);
}

async function createResult(request, env) {
  const limited = await publicRateLimit(request, env, "result", 12);
  if (limited) return limited;
  const data = await body(request);
  const name = cleanText(data.nombre, 180);
  const document = cleanText(data.documento, 80).replace(/\D/g, "");
  const score = Math.max(0, integer(data.puntaje));
  const total = Math.max(0, integer(data.total));
  const percentage = Math.max(0, Math.min(100, integer(data.porcentaje, total ? Math.round(score / total * 100) : 0)));
  if (!name || document.length < 4 || total < 1 || score > total) return error("Resultado incompleto o invalido");
  const now = nowIso();
  await env.DB.prepare(`INSERT INTO course_results
    (nombre,documento_hash,documento_last4,documento_masked,correo,telefono,curso,puntaje,total,porcentaje,estado,fecha,fecha_creacion)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(name, await hmacHex(env.DOCUMENT_HASH_KEY || "local-development", document), documentLast4(document), maskDocument(document),
      cleanText(data.correo, 160), cleanText(data.telefono, 80), cleanText(data.curso || "Manipulacion de Alimentos", 180),
      score, total, percentage, percentage >= 70 ? "Aprobado" : "No aprobado", cleanText(data.fecha || now, 80), now).run();
  return json({ ok: true }, 201);
}

const lists = {
  clientes: ["customers", "clientes", "ORDER BY id DESC"],
  solicitudes: ["contact_requests", "solicitudes", "ORDER BY id DESC"],
  empresas: ["company_requests", "empresas", "ORDER BY id DESC"],
  servicios: ["services", "servicios", "ORDER BY orden, id"],
  cursos: ["courses", "cursos", "ORDER BY id DESC"],
  preguntas: ["questions", "preguntas", "ORDER BY id DESC"],
  pagos: ["payments", "pagos", "ORDER BY id DESC"],
  faqs: ["faqs", "faqs", "ORDER BY orden, id"],
  testimonios: ["testimonials", "testimonios", "ORDER BY orden, id"],
  auditoria: ["audit_logs", "logs", "ORDER BY id DESC"],
  resultados: ["course_results", "resultados", "ORDER BY id DESC"]
};

async function listAdmin(resource, env) {
  const definition = lists[resource];
  if (!definition) return error("Recurso no encontrado", 404);
  const data = await rows(env.DB, `SELECT * FROM ${definition[0]} ${definition[2]} LIMIT ${LIST_LIMIT}`);
  if (["clientes", "solicitudes", "resultados"].includes(resource)) {
    data.forEach((item) => {
      item.documento = item.documento_masked || "";
    });
  }
  return json({ ok: true, [definition[1]]: data });
}

async function createCustomer(data, env) {
  const name = cleanText(data.nombre, 180);
  if (!name) return error("nombre requerido");
  const document = cleanText(data.documento, 80).replace(/\D/g, "");
  const now = nowIso();
  await env.DB.prepare(`INSERT INTO customers
    (nombre,tipo_documento,documento_hash,documento_last4,documento_masked,correo,celular,ciudad,empresa,servicio_interes,estado,fecha_creacion,fecha_actualizacion)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, ?,?)`)
    .bind(name, cleanText(data.tipo_documento, 30), await hmacHex(env.DOCUMENT_HASH_KEY || "local-development", document),
      documentLast4(document), maskDocument(document), cleanText(data.correo, 160), cleanText(data.celular, 80),
      cleanText(data.ciudad, 100), cleanText(data.empresa, 180), cleanText(data.servicio_interes, 180), cleanText(data.estado || "Activo", 40), now, now).run();
  return json({ ok: true }, 201);
}

async function createAdminResource(resource, request, env) {
  const data = await body(request);
  const now = nowIso();
  if (resource === "clientes") return createCustomer(data, env);
  if (resource === "servicios") {
    const name = cleanText(data.nombre, 180);
    if (!name) return error("nombre requerido");
    await env.DB.prepare(`INSERT INTO services (nombre,slug,descripcion,beneficios,requisitos,duracion,modalidad,precio,estado,orden,fecha_creacion,fecha_actualizacion)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET nombre=excluded.nombre,descripcion=excluded.descripcion,beneficios=excluded.beneficios,requisitos=excluded.requisitos,duracion=excluded.duracion,modalidad=excluded.modalidad,precio=excluded.precio,estado=excluded.estado,orden=excluded.orden,fecha_actualizacion=excluded.fecha_actualizacion`)
      .bind(name, slugify(data.slug || name), cleanText(data.descripcion, 1000), cleanText(data.beneficios, 1000), cleanText(data.requisitos, 1000),
        cleanText(data.duracion, 80), cleanText(data.modalidad, 80), cleanText(data.precio, 80), cleanText(data.estado || "Activo", 40), integer(data.orden), now, now).run();
  } else if (resource === "cursos") {
    const name = cleanText(data.nombre, 180);
    if (!name) return error("nombre requerido");
    const slug = slugify(data.slug || name);
    await env.DB.prepare(`INSERT INTO courses (nombre,slug,descripcion,duracion,modalidad,puntaje_minimo,intentos_maximos,estado,fecha_creacion,fecha_actualizacion)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET nombre=excluded.nombre,descripcion=excluded.descripcion,duracion=excluded.duracion,modalidad=excluded.modalidad,puntaje_minimo=excluded.puntaje_minimo,intentos_maximos=excluded.intentos_maximos,estado=excluded.estado,fecha_actualizacion=excluded.fecha_actualizacion`)
      .bind(name, slug, cleanText(data.descripcion, 1000), cleanText(data.duracion, 80), cleanText(data.modalidad, 80), integer(data.puntaje_minimo, 70), integer(data.intentos_maximos, 2), cleanText(data.estado || "Activo", 40), now, now).run();
  } else if (resource === "preguntas") {
    const question = cleanText(data.pregunta, 600);
    const options = Array.isArray(data.opciones) ? data.opciones : cleanText(data.opciones, 1000).split("|").map((x) => cleanText(x, 180)).filter(Boolean);
    if (!question || options.length < 2) return error("pregunta y minimo dos opciones requeridas");
    const courseId = integer(data.course_id, 1);
    let exam = await env.DB.prepare("SELECT id FROM exams WHERE course_id=? LIMIT 1").bind(courseId).first();
    if (!exam) {
      const result = await env.DB.prepare("INSERT INTO exams (course_id,nombre,puntaje_minimo,intentos_maximos,estado,fecha_creacion,fecha_actualizacion) VALUES (?,'Examen',70,2,'Activo',?,?)").bind(courseId, now, now).run();
      exam = { id: result.meta.last_row_id };
    }
    await env.DB.prepare("INSERT INTO questions (exam_id,course_id,pregunta,opciones_json,respuesta_correcta,puntaje,estado,fecha_creacion,fecha_actualizacion) VALUES (?,?,?,?,?,?,'Activo',?,?)")
      .bind(exam.id, courseId, question, JSON.stringify(options), integer(data.respuesta_correcta), integer(data.puntaje, 1), now, now).run();
  } else if (resource === "pagos") {
    await env.DB.prepare(`INSERT INTO payments (customer_id,nombre_cliente,servicio,monto,moneda,metodo,referencia,estado,comprobante_nombre,notas,fecha_creacion,fecha_actualizacion)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(integer(data.customer_id) || null, cleanText(data.nombre_cliente, 180), cleanText(data.servicio, 180), cleanText(data.monto, 80), cleanText(data.moneda || "COP", 20), cleanText(data.metodo || "Manual", 80), cleanText(data.referencia, 160), cleanText(data.estado || "Pendiente", 40), cleanText(data.comprobante_nombre, 180), cleanText(data.notas, 500), now, now).run();
  } else if (resource === "faqs") {
    if (!cleanText(data.pregunta) || !cleanText(data.respuesta)) return error("pregunta y respuesta requeridas");
    await env.DB.prepare("INSERT INTO faqs (pregunta,respuesta,categoria,estado,orden,fecha_creacion,fecha_actualizacion) VALUES (?,?,?,?,?,?,?)")
      .bind(cleanText(data.pregunta, 300), cleanText(data.respuesta, 1000), cleanText(data.categoria || "General", 80), cleanText(data.estado || "Activo", 40), integer(data.orden), now, now).run();
  } else if (resource === "testimonios") {
    if (!cleanText(data.nombre) || !cleanText(data.texto)) return error("nombre y texto requeridos");
    await env.DB.prepare("INSERT INTO testimonials (nombre,cargo,texto,estado,orden,fecha_creacion,fecha_actualizacion) VALUES (?,?,?,?,?,?,?)")
      .bind(cleanText(data.nombre, 180), cleanText(data.cargo, 120), cleanText(data.texto, 1000), cleanText(data.estado || "Activo", 40), integer(data.orden), now, now).run();
  } else return error("Recurso no encontrado", 404);
  return json({ ok: true }, 201);
}

async function stats(env) {
  const result = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM certificates) certificates,
    (SELECT COUNT(*) FROM course_results) course_results,
    (SELECT COUNT(*) FROM certificates WHERE estado='Anulado') annulled,
    (SELECT COUNT(*) FROM customers) customers,
    (SELECT COUNT(*) FROM prospects) prospects,
    ((SELECT COUNT(*) FROM contact_requests WHERE estado='Pendiente') + (SELECT COUNT(*) FROM company_requests WHERE estado='Pendiente')) pending_requests,
    (SELECT COUNT(*) FROM payments WHERE estado='Pendiente') pending_payments,
    (SELECT COUNT(*) FROM course_results WHERE estado='Aprobado') approved_exams,
    (SELECT COUNT(*) FROM services WHERE estado='Activo') active_services`).first();
  return json({ ok: true, ...result });
}

async function listProspects(env, url) {
  const query = cleanText(url.searchParams.get("q"), 120);
  const page = Math.max(1, integer(url.searchParams.get("page"), 1));
  const limit = Math.max(10, Math.min(100, integer(url.searchParams.get("limit"), 50)));
  const offset = (page - 1) * limit;
  const where = query ? `WHERE establecimiento LIKE ? OR telefono_1 LIKE ? OR telefono_2 LIKE ? OR telefono_3 LIKE ?
    OR telefono_4 LIKE ? OR correo LIKE ? OR ciudad LIKE ? OR actividad LIKE ? OR encargado LIKE ?
    OR titular_servicio LIKE ? OR resultado_gestion LIKE ? OR direccion LIKE ? OR agente LIKE ?` : "";
  const bindings = query ? Array(13).fill(`%${query}%`) : [];
  const count = await env.DB.prepare(`SELECT COUNT(*) total FROM prospects ${where}`).bind(...bindings).first();
  const data = await rows(env.DB,
    `SELECT * FROM prospects ${where} ORDER BY id ASC LIMIT ? OFFSET ?`,
    [...bindings, limit, offset]
  );
  const total = Number(count?.total || 0);
  return json({
    ok: true,
    prospectos: data,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit))
  });
}

async function listCertificates(env) {
  const data = await rows(env.DB, `SELECT * FROM certificates ORDER BY id DESC LIMIT ${LIST_LIMIT}`);
  return json({ ok: true, certificados: data.map((row) => adminCertificate(row, env)) });
}

async function createCertificate(request, env) {
  const data = await body(request);
  const code = extractCertificateCode(data.codigo_unico || data.codigo || data.code);
  const name = cleanText(data.nombre_estudiante || data.nombre || data.titular, 180);
  const course = cleanText(data.curso || "Manipulacion de Alimentos", 180);
  if (!code || !name || !course) return error("codigo, nombre y curso requeridos");
  const document = cleanText(data.documento, 80).replace(/\D/g, "");
  const now = nowIso();
  const urls = publicCertificateUrls(env.PUBLIC_URL || "https://multiservicios.website", code);
  await env.DB.prepare(`INSERT INTO certificates
    (codigo_unico,nombre_estudiante,documento_hash,documento_last4,documento_masked,curso,intensidad_horaria,fecha_emision,fecha_vencimiento,estado,qr_url,validation_url,fecha_creacion,fecha_actualizacion)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(codigo_unico) DO UPDATE SET nombre_estudiante=excluded.nombre_estudiante,documento_hash=excluded.documento_hash,documento_last4=excluded.documento_last4,documento_masked=excluded.documento_masked,curso=excluded.curso,intensidad_horaria=excluded.intensidad_horaria,fecha_emision=excluded.fecha_emision,fecha_vencimiento=excluded.fecha_vencimiento,estado=excluded.estado,qr_url=excluded.qr_url,validation_url=excluded.validation_url,fecha_actualizacion=excluded.fecha_actualizacion`)
    .bind(code, name, document ? await hmacHex(env.DOCUMENT_HASH_KEY || "local-development", document) : "", documentLast4(document), maskDocument(document), course,
      cleanText(data.intensidad_horaria, 80), cleanText(data.fecha_emision || now.slice(0, 10), 20), cleanText(data.fecha_vencimiento, 20),
      cleanText(data.estado || "Activo", 40), urls.qrUrl, urls.validationUrl, now, now).run();
  const row = await env.DB.prepare("SELECT * FROM certificates WHERE codigo_unico=?").bind(code).first();
  return json({ ok: true, certificado: adminCertificate(row, env) }, 201);
}

async function annulCertificate(request, env, code) {
  const existing = await env.DB.prepare("SELECT * FROM certificates WHERE codigo_unico=?").bind(code).first();
  if (!existing) return error("Certificado no encontrado", 404);
  const data = await body(request);
  await env.DB.prepare("UPDATE certificates SET estado='Anulado',motivo_anulacion=?,fecha_actualizacion=? WHERE codigo_unico=?")
    .bind(cleanText(data.motivo || data.motivo_anulacion || "Anulado desde panel", 300), nowIso(), code).run();
  const row = await env.DB.prepare("SELECT * FROM certificates WHERE codigo_unico=?").bind(code).first();
  return json({ ok: true, certificado: adminCertificate(row, env) });
}

async function uploadPdf(request, env, code) {
  const existing = await env.DB.prepare("SELECT id FROM certificates WHERE codigo_unico=?").bind(code).first();
  if (!existing) return error("Certificado no encontrado", 404);
  const data = await body(request);
  let encoded = String(data.content_base64 || "");
  const dataUrl = String(data.data_url || "");
  if (dataUrl.startsWith("data:application/pdf") && dataUrl.includes(",")) encoded = dataUrl.split(",", 2)[1];
  if (!encoded) return error("PDF requerido");
  const bytes = decodeBase64(encoded);
  if (bytes.byteLength > MAX_PDF_BYTES) return error("El PDF supera 15 MB", 413);
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return error("El archivo no parece ser PDF");
  const key = `certificates/${code.replace(/[^A-Z0-9_-]/g, "")}.pdf`;
  if (env.CERTIFICATES) {
    await env.CERTIFICATES.put(key, bytes, { httpMetadata: { contentType: "application/pdf" }, customMetadata: { certificate: code } });
    await env.DB.prepare("UPDATE certificates SET pdf_key=?,fecha_actualizacion=? WHERE codigo_unico=?").bind(key, nowIso(), code).run();
  } else {
    const statements = [env.DB.prepare("DELETE FROM certificate_pdf_chunks WHERE certificate_code=?").bind(code)];
    const createdAt = nowIso();
    for (let offset = 0, index = 0; offset < bytes.byteLength; offset += PDF_CHUNK_BYTES, index += 1) {
      const chunk = bytes.slice(offset, Math.min(offset + PDF_CHUNK_BYTES, bytes.byteLength));
      statements.push(env.DB.prepare(
        "INSERT INTO certificate_pdf_chunks (certificate_code,chunk_index,content,fecha_creacion) VALUES (?,?,?,?)"
      ).bind(code, index, chunk.buffer, createdAt));
    }
    statements.push(env.DB.prepare("UPDATE certificates SET pdf_key=?,fecha_actualizacion=? WHERE codigo_unico=?")
      .bind(`d1://${key}`, createdAt, code));
    await env.DB.batch(statements);
  }
  return json({ ok: true, archivo: key.split("/").pop(), privado: true });
}

async function downloadPdf(env, code) {
  const certificate = await env.DB.prepare("SELECT pdf_key FROM certificates WHERE codigo_unico=?").bind(code).first();
  if (!certificate?.pdf_key) return error("PDF no encontrado", 404);
  if (!certificate.pdf_key.startsWith("d1://") && env.CERTIFICATES) {
    const object = await env.CERTIFICATES.get(certificate.pdf_key);
    if (!object) return error("PDF no encontrado", 404);
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${code}.pdf"`,
        "Cache-Control": "private, no-store"
      }
    });
  }
  const chunks = await rows(env.DB,
    "SELECT content FROM certificate_pdf_chunks WHERE certificate_code=? ORDER BY chunk_index", [code]);
  if (!chunks.length) return error("PDF no encontrado", 404);
  const parts = chunks.map((row) => row.content instanceof ArrayBuffer ? row.content : new Uint8Array(row.content));
  return new Response(new Blob(parts, { type: "application/pdf" }), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${code}.pdf"`,
      "Cache-Control": "private, no-store"
    }
  });
}

async function patchRecord(request, env, table, id, fields) {
  const data = await body(request);
  const updates = [];
  const bindings = [];
  for (const field of fields) {
    if (data[field] === undefined) continue;
    updates.push(`${field}=?`);
    bindings.push(cleanText(data[field], field === "notas" ? 500 : 180));
  }
  if (!updates.length) return error("No hay cambios");
  updates.push("fecha_actualizacion=?");
  bindings.push(nowIso(), id);
  const result = await env.DB.prepare(`UPDATE ${table} SET ${updates.join(",")} WHERE id=?`).bind(...bindings).run();
  return result.meta.changes ? json({ ok: true }) : error("Registro no encontrado", 404);
}

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method.toUpperCase();
  if (method === "GET" && path === "/api/health") return json({ ok: true, service: "multiservicios-cloudflare", environment: env.ENVIRONMENT || "development" });
  if (method === "POST" && path === "/api/auth/login") return login(request, env);
  if (method === "GET" && path === "/api/auth/me") {
    const admin = await currentAdmin(request, env);
    return admin ? json({ ok: true, authenticated: true, admin }) : json({ ok: false, authenticated: false }, 401);
  }
  if (method === "GET" && path === "/api/certificados/validar") return validateCertificate(request, env, url);
  if (method === "GET" && path === "/api/public/catalogo") return publicCatalog(env);
  if (method === "POST" && path === "/api/solicitudes") return createContact(request, env);
  if (method === "POST" && path === "/api/empresas") return createCompany(request, env);
  if (method === "POST" && path === "/api/resultados") return createResult(request, env);

  const admin = await protectedAdmin(request, env);
  if (!admin) return error("Sesion administrativa requerida", 401);
  if (["POST", "PATCH", "PUT", "DELETE"].includes(method) && !sameOrigin(request)) return error("Origen no permitido", 403);
  if (method === "POST" && path === "/api/auth/logout") return logout(request, env);
  if (method === "GET" && path === "/api/admin/stats") return stats(env);
  if (method === "GET" && path === "/api/admin/prospectos") return listProspects(env, url);
  if (method === "GET" && path === "/api/admin/certificados") return listCertificates(env);
  if (method === "POST" && path === "/api/admin/certificados") {
    const response = await createCertificate(request, env);
    if (response.ok) await audit(env, admin.email, "certificado_guardado", "Certificado creado o actualizado", ip(request));
    return response;
  }
  if (method === "GET" && path === "/api/admin/certificados/public-json") {
    const data = await rows(env.DB, "SELECT * FROM certificates ORDER BY id DESC");
    return json({ ok: true, certificados: data.map((row) => publicCertificate(row, env)), total: data.length });
  }
  if (method === "POST" && path === "/api/admin/certificados/publicar-base") {
    const count = await env.DB.prepare("SELECT COUNT(*) total FROM certificates").first();
    return json({ ok: true, total: count.total, archivos: [], fuente: "D1" });
  }
  const certAction = path.match(/^\/api\/admin\/certificados\/([^/]+)\/(anular|pdf)$/);
  if (certAction) {
    const code = cleanText(decodeURIComponent(certAction[1]), 80).toUpperCase();
    if (method === "PATCH" && certAction[2] === "anular") return annulCertificate(request, env, code);
    if (method === "POST" && certAction[2] === "pdf") return uploadPdf(request, env, code);
    if (method === "GET" && certAction[2] === "pdf") return downloadPdf(env, code);
  }
  const patch = path.match(/^\/api\/admin\/(pagos|solicitudes)\/(\d+)$/);
  if (method === "PATCH" && patch) {
    return patchRecord(request, env, patch[1] === "pagos" ? "payments" : "contact_requests", Number(patch[2]),
      patch[1] === "pagos" ? ["estado", "referencia", "notas"] : ["estado", "payment_status"]);
  }
  const resourceMatch = path.match(/^\/api\/admin\/([a-z-]+)$/);
  if (resourceMatch && method === "GET") return listAdmin(resourceMatch[1], env);
  if (resourceMatch && method === "POST") {
    const response = await createAdminResource(resourceMatch[1], request, env);
    if (response.ok) await audit(env, admin.email, `${resourceMatch[1]}_guardado`, "Registro guardado", ip(request));
    return response;
  }
  return error("Ruta no encontrada", 404);
}

async function serveStatic(request, env, url) {
  if (url.pathname === "/favicon.ico") {
    const logoUrl = new URL("/assets/logos/logo-horizontal.png", url);
    return env.ASSETS.fetch(new Request(logoUrl, request));
  }
  if (url.pathname === "/admin") return Response.redirect(`${url.origin}/admin/`, 302);
  if (url.pathname === "/admin/") {
    const admin = await currentAdmin(request, env);
    return Response.redirect(`${url.origin}/admin/${admin ? "dashboard.html" : "login.html"}`, 302);
  }
  const publicAdminPaths = new Set(["/admin/login", "/admin/login.html", "/admin/index", "/admin/index.html"]);
  if (url.pathname.startsWith("/admin/") && !publicAdminPaths.has(url.pathname)) {
    const admin = await currentAdmin(request, env);
    if (!admin) return Response.redirect(`${url.origin}/admin/login.html`, 302);
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.protocol === "http:") {
        url.protocol = "https:";
        return Response.redirect(url.toString(), 308);
      }
      const response = url.pathname.startsWith("/api/") ? await handleApi(request, env, url) : await serveStatic(request, env, url);
      return withSecurityHeaders(response);
    } catch (caught) {
      console.error(caught);
      return withSecurityHeaders(error(caught instanceof Error ? caught.message : "Error interno", 500));
    }
  }
};
