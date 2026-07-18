#!/usr/bin/env python3
"""
Backend local/produccion para Multiservicios.

Ejecutar:
  python server.py

Variables opcionales:
  MS_HOST=127.0.0.1
  MS_PORT=8080
  MS_ADMIN_EMAIL=admin@multiservicios.local
  MS_ADMIN_PASSWORD=MULTISERVICIOS
  MS_SECRET_KEY=<clave-larga-aleatoria>
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import json
import mimetypes
import os
import posixpath
import secrets
import sqlite3
import sys
import threading
import time
import unicodedata
import urllib.parse
from contextlib import contextmanager
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"
STORAGE_DIR = Path(os.environ.get("MS_STORAGE_DIR") or ROOT / "storage").resolve()
PDF_DIR = STORAGE_DIR / "pdfs"
DB_PATH = Path(os.environ.get("MS_DB_PATH") or STORAGE_DIR / "db" / "multiservicios.sqlite3").resolve()

SESSION_COOKIE = "ms_admin_session"
SESSION_DAYS = 7
MAX_JSON_BODY = 60 * 1024 * 1024

SECRET_KEY = os.environ.get("MS_SECRET_KEY") or "multiservicios-local-secret-change-me"
ADMIN_EMAIL = os.environ.get("MS_ADMIN_EMAIL") or "admin@multiservicios.local"
ADMIN_PASSWORD = os.environ.get("MS_ADMIN_PASSWORD") or "MULTISERVICIOS"
ENVIRONMENT = (os.environ.get("MS_ENV") or "development").strip().lower()
COOKIE_SECURE = ENVIRONMENT == "production" or (os.environ.get("MS_COOKIE_SECURE") or "").strip().lower() in {"1", "true", "yes"}
PUBLIC_URL = (os.environ.get("MS_PUBLIC_URL") or "").strip().rstrip("/")

LOGIN_WINDOW_SECONDS = 15 * 60
LOGIN_MAX_ATTEMPTS = 5
LOGIN_BLOCK_SECONDS = 15 * 60
_login_attempts: dict[str, list[float]] = {}
_login_blocked_until: dict[str, float] = {}
_login_lock = threading.Lock()


def validate_runtime_config() -> None:
    if ENVIRONMENT != "production":
        return
    errors = []
    if SECRET_KEY == "multiservicios-local-secret-change-me" or len(SECRET_KEY) < 32:
        errors.append("MS_SECRET_KEY debe ser unica y tener al menos 32 caracteres")
    if ADMIN_PASSWORD == "MULTISERVICIOS" or len(ADMIN_PASSWORD) < 12:
        errors.append("MS_ADMIN_PASSWORD debe ser una clave nueva de al menos 12 caracteres")
    if ADMIN_EMAIL == "admin@multiservicios.local":
        errors.append("MS_ADMIN_EMAIL debe usar el correo administrativo real")
    public_url = urllib.parse.urlparse(PUBLIC_URL)
    if public_url.scheme != "https" or not public_url.hostname:
        errors.append("MS_PUBLIC_URL debe contener el dominio publico con HTTPS")
    if errors:
        raise RuntimeError("Configuracion de produccion insegura: " + "; ".join(errors))


def login_retry_after(ip: str, now: float | None = None) -> int:
    now = time.monotonic() if now is None else now
    with _login_lock:
        blocked_until = _login_blocked_until.get(ip, 0)
        if blocked_until <= now:
            _login_blocked_until.pop(ip, None)
            return 0
        return max(1, int(blocked_until - now) + 1)


def register_failed_login(ip: str, now: float | None = None) -> None:
    now = time.monotonic() if now is None else now
    with _login_lock:
        recent = [stamp for stamp in _login_attempts.get(ip, []) if now - stamp < LOGIN_WINDOW_SECONDS]
        recent.append(now)
        _login_attempts[ip] = recent
        if len(recent) >= LOGIN_MAX_ATTEMPTS:
            _login_blocked_until[ip] = now + LOGIN_BLOCK_SECONDS
            _login_attempts.pop(ip, None)


def clear_failed_logins(ip: str) -> None:
    with _login_lock:
        _login_attempts.pop(ip, None)
        _login_blocked_until.pop(ip, None)


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def today_iso() -> str:
    return dt.date.today().isoformat()


def clean_text(value: Any, limit: int = 240) -> str:
    text = str(value or "").replace("\x00", "").strip()
    return text[:limit]


def only_digits(value: Any) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def document_last4(value: Any) -> str:
    digits = only_digits(value)
    return digits[-4:] if len(digits) >= 4 else digits


def mask_document(value: Any) -> str:
    last4 = document_last4(value)
    return "****" + last4 if last4 else clean_text(value or "No publicado", 80)


def hash_document(value: Any) -> str:
    digits = only_digits(value)
    if not digits:
        return ""
    return hmac.new(SECRET_KEY.encode("utf-8"), digits.encode("utf-8"), hashlib.sha256).hexdigest()


def certificate_public_urls(code: str) -> tuple[str, str]:
    if not PUBLIC_URL or not code:
        return "", ""
    validation_url = f"{PUBLIC_URL}/validar-certificado.html?codigo={urllib.parse.quote(code)}"
    qr_url = "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" + urllib.parse.quote(validation_url, safe="")
    return validation_url, qr_url


def password_hash(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 220_000)
    return salt, base64.b64encode(digest).decode("ascii")


def verify_password(password: str, salt: str, expected: str) -> bool:
    _, candidate = password_hash(password, salt)
    return hmac.compare_digest(candidate, expected)


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS admins (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              nombre TEXT NOT NULL,
              email TEXT UNIQUE NOT NULL,
              password_salt TEXT NOT NULL,
              password_hash TEXT NOT NULL,
              rol TEXT NOT NULL DEFAULT 'admin',
              estado TEXT NOT NULL DEFAULT 'activo',
              fecha_creacion TEXT NOT NULL,
              ultimo_login TEXT
            );

            CREATE TABLE IF NOT EXISTS sessions (
              token TEXT PRIMARY KEY,
              admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
              fecha_creacion TEXT NOT NULL,
              expires_at TEXT NOT NULL
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
              archivo_pdf_path TEXT,
              archivo_pdf_url TEXT,
              qr_url TEXT,
              validation_url TEXT,
              creado_por INTEGER REFERENCES admins(id),
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

            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              nombre TEXT NOT NULL,
              email TEXT UNIQUE NOT NULL,
              rol TEXT NOT NULL DEFAULT 'admin',
              estado TEXT NOT NULL DEFAULT 'activo',
              fecha_creacion TEXT NOT NULL,
              fecha_actualizacion TEXT NOT NULL
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

            CREATE TABLE IF NOT EXISTS modules (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
              titulo TEXT NOT NULL,
              descripcion TEXT,
              video_url TEXT,
              orden INTEGER NOT NULL DEFAULT 0,
              estado TEXT NOT NULL DEFAULT 'Activo',
              fecha_creacion TEXT NOT NULL,
              fecha_actualizacion TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS lessons (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
              titulo TEXT NOT NULL,
              contenido TEXT,
              orden INTEGER NOT NULL DEFAULT 0,
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

            CREATE TABLE IF NOT EXISTS answers (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE,
              texto TEXT NOT NULL,
              es_correcta INTEGER NOT NULL DEFAULT 0,
              orden INTEGER NOT NULL DEFAULT 0,
              fecha_creacion TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS attempts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              customer_id INTEGER REFERENCES customers(id),
              course_id INTEGER REFERENCES courses(id),
              nombre TEXT,
              documento_hash TEXT,
              documento_last4 TEXT,
              puntaje INTEGER NOT NULL DEFAULT 0,
              total INTEGER NOT NULL DEFAULT 0,
              porcentaje INTEGER NOT NULL DEFAULT 0,
              estado TEXT NOT NULL,
              respuestas_json TEXT,
              fecha_creacion TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS payments (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              customer_id INTEGER REFERENCES customers(id),
              certificate_id INTEGER REFERENCES certificates(id),
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

            CREATE TABLE IF NOT EXISTS settings (
              clave TEXT PRIMARY KEY,
              valor TEXT,
              grupo TEXT NOT NULL DEFAULT 'general',
              fecha_actualizacion TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS audit_logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER,
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

            CREATE TABLE IF NOT EXISTS logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              admin_id INTEGER,
              accion TEXT NOT NULL,
              descripcion TEXT,
              fecha TEXT NOT NULL,
              ip TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_certificates_codigo ON certificates(codigo_unico);
            CREATE INDEX IF NOT EXISTS idx_certificates_documento_hash ON certificates(documento_hash);
            CREATE INDEX IF NOT EXISTS idx_customers_documento_hash ON customers(documento_hash);
            CREATE INDEX IF NOT EXISTS idx_customers_correo ON customers(correo);
            CREATE INDEX IF NOT EXISTS idx_contact_requests_estado ON contact_requests(estado);
            CREATE INDEX IF NOT EXISTS idx_payments_estado ON payments(estado);
            CREATE INDEX IF NOT EXISTS idx_exams_course_id ON exams(course_id);
            CREATE INDEX IF NOT EXISTS idx_questions_course_id ON questions(course_id);
            """
        )
        admin = conn.execute("SELECT * FROM admins WHERE email = ?", (ADMIN_EMAIL,)).fetchone()
        if admin is None:
            existing = conn.execute("SELECT * FROM admins ORDER BY id LIMIT 1").fetchone()
            salt, digest = password_hash(ADMIN_PASSWORD)
            if existing:
                conn.execute(
                    "UPDATE admins SET email = ?, password_salt = ?, password_hash = ?, estado = 'activo' WHERE id = ?",
                    (ADMIN_EMAIL, salt, digest, existing["id"]),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO admins (nombre, email, password_salt, password_hash, rol, estado, fecha_creacion)
                    VALUES (?, ?, ?, ?, 'admin', 'activo', ?)
                    """,
                    ("Administrador Multiservicios", ADMIN_EMAIL, salt, digest, utc_now()),
                )
        elif not verify_password(ADMIN_PASSWORD, admin["password_salt"], admin["password_hash"]):
            salt, digest = password_hash(ADMIN_PASSWORD)
            conn.execute(
                "UPDATE admins SET password_salt = ?, password_hash = ? WHERE id = ?",
                (salt, digest, admin["id"]),
            )
        cert_count = conn.execute("SELECT COUNT(*) FROM certificates").fetchone()[0]
        if cert_count == 0:
            seed_certificates(conn)
        seed_business_tables(conn)
        conn.execute("UPDATE courses SET puntaje_minimo = 80 WHERE puntaje_minimo <> 80")
        conn.execute("UPDATE exams SET puntaje_minimo = 80 WHERE puntaje_minimo <> 80")
        conn.execute(
            "UPDATE course_results SET estado = CASE WHEN porcentaje >= 80 THEN 'Aprobado' ELSE 'No aprobado' END"
        )


def seed_certificates(conn: sqlite3.Connection) -> None:
    json_path = PUBLIC_DIR / "data" / "certificados.json"
    if not json_path.exists():
        return
    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except Exception:
        return
    if not isinstance(data, list):
        return
    for item in data:
        if not isinstance(item, dict):
            continue
        cert = normalize_certificate_payload(item)
        if not cert["codigo_unico"]:
            continue
        conn.execute(
            """
            INSERT OR IGNORE INTO certificates
            (codigo_unico, nombre_estudiante, documento_hash, documento_last4, documento_masked,
             curso, intensidad_horaria, fecha_emision, fecha_vencimiento, estado,
             archivo_pdf_url, qr_url, validation_url, fecha_creacion, fecha_actualizacion)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                cert["codigo_unico"],
                cert["nombre_estudiante"],
                cert["documento_hash"],
                cert["documento_last4"],
                cert["documento_masked"],
                cert["curso"],
                cert["intensidad_horaria"],
                cert["fecha_emision"],
                cert["fecha_vencimiento"],
                cert["estado"],
                cert["archivo_pdf_url"],
                cert["qr_url"],
                cert["validation_url"],
                utc_now(),
                utc_now(),
            ),
        )


def slugify(value: Any) -> str:
    text = clean_text(value, 120).lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    cleaned = []
    previous_dash = False
    for ch in text:
        if ch.isalnum():
            cleaned.append(ch)
            previous_dash = False
        elif not previous_dash:
            cleaned.append("-")
            previous_dash = True
    return "".join(cleaned).strip("-") or secrets.token_hex(4)


def seed_business_tables(conn: sqlite3.Connection) -> None:
    now = utc_now()
    conn.execute(
        """
        INSERT OR IGNORE INTO users (nombre, email, rol, estado, fecha_creacion, fecha_actualizacion)
        VALUES (?, ?, 'superadmin', 'activo', ?, ?)
        """,
        ("Administrador Multiservicios", ADMIN_EMAIL, now, now),
    )
    services = [
        (
            "Certificado de manipulacion de alimentos",
            "certificado-manipulacion-alimentos",
            "Curso y certificado digital con codigo unico, QR y validacion online.",
            "Proceso guiado, soporte por WhatsApp, validacion publica y certificado descargable.",
            "Datos personales, documento, correo, telefono y aprobacion del proceso de formacion.",
            "Proceso digital",
            "Virtual",
            "Solicitar precio",
            1,
        ),
        (
            "Capacitacion en extintores",
            "capacitacion-extintores",
            "Servicio preparado para capacitaciones y certificados relacionados con seguridad y extintores.",
            "Atencion para empresas, locales y equipos de trabajo.",
            "Agenda, datos del responsable y alcance del servicio solicitado.",
            "Segun agenda",
            "Presencial o mixta",
            "Cotizar",
            2,
        ),
        (
            "Lavado y desinfeccion de tanques",
            "lavado-desinfeccion-tanques",
            "Limpieza, lavado y desinfeccion de tanques para viviendas, restaurantes, conjuntos y empresas.",
            "Cotizacion por alcance, tipo de tanque, acceso y ubicacion.",
            "Ubicacion, tipo de tanque, capacidad aproximada y disponibilidad de acceso.",
            "Segun alcance",
            "Presencial",
            "Cotizar",
            3,
        ),
        (
            "Paquetes empresariales",
            "paquetes-empresariales",
            "Gestion para grupos de trabajadores, restaurantes, cafeterias, colegios y empresas.",
            "Solicitud empresarial, trazabilidad y registro centralizado.",
            "Listado de personas o cantidad estimada de participantes.",
            "Segun grupo",
            "Digital con acompanamiento",
            "Cotizar",
            5,
        ),
    ]
    for row in services:
        conn.execute(
            """
            INSERT OR IGNORE INTO services
            (nombre, slug, descripcion, beneficios, requisitos, duracion, modalidad, precio, estado, orden, fecha_creacion, fecha_actualizacion)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Activo', ?, ?, ?)
            """,
            (*row, now, now),
        )
    for order, slug in enumerate([row[1] for row in services], start=1):
        conn.execute("UPDATE services SET orden = ?, fecha_actualizacion = ? WHERE slug = ?", (order, now, slug))
    conn.execute(
        "UPDATE services SET estado = 'Inactivo', fecha_actualizacion = ? WHERE slug = ?",
        (now, "plan-saneamiento-control-plagas"),
    )

    conn.execute(
        """
        INSERT OR IGNORE INTO courses
        (nombre, slug, descripcion, duracion, modalidad, puntaje_minimo, intentos_maximos, estado, fecha_creacion, fecha_actualizacion)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Activo', ?, ?)
        """,
        (
            "Manipulacion de Alimentos",
            "manipulacion-alimentos",
            "Curso digital con 27 modulos de video y evaluacion final.",
            "27 modulos",
            "Virtual",
            70,
            2,
            now,
            now,
        ),
    )
    course = conn.execute("SELECT id FROM courses WHERE slug = 'manipulacion-alimentos'").fetchone()
    if course:
        course_id = int(course["id"])
        exam = conn.execute("SELECT id FROM exams WHERE course_id = ? LIMIT 1", (course_id,)).fetchone()
        if not exam:
            conn.execute(
                """
                INSERT INTO exams
                (course_id, nombre, puntaje_minimo, intentos_maximos, estado, fecha_creacion, fecha_actualizacion)
                VALUES (?, 'Examen final de manipulacion de alimentos', 70, 2, 'Activo', ?, ?)
                """,
                (course_id, now, now),
            )
            exam = conn.execute("SELECT id FROM exams WHERE course_id = ? LIMIT 1", (course_id,)).fetchone()
        exam_id = int(exam["id"]) if exam else None
        module_count = conn.execute("SELECT COUNT(*) FROM modules WHERE course_id = ?", (course_id,)).fetchone()[0]
        if module_count == 0:
            modules = [
                ("Introduccion a la inocuidad alimentaria", "Conceptos base y responsabilidad del manipulador.", 1),
                ("Peligros en los alimentos", "Peligros biologicos, fisicos y quimicos.", 2),
                ("Higiene personal y limpieza", "Habitos, lavado de manos y prevencion de contaminacion.", 3),
            ]
            for title, description, order in modules:
                conn.execute(
                    """
                    INSERT INTO modules
                    (course_id, titulo, descripcion, orden, estado, fecha_creacion, fecha_actualizacion)
                    VALUES (?, ?, ?, ?, 'Activo', ?, ?)
                    """,
                    (course_id, title, description, order, now, now),
                )
        if exam_id:
            question_count = conn.execute("SELECT COUNT(*) FROM questions WHERE exam_id = ?", (exam_id,)).fetchone()[0]
            if question_count == 0:
                questions = [
                    (
                        "¿Que significa inocuidad alimentaria?",
                        ["Que la comida sabe rico", "Que los alimentos no causaran dano al consumidor", "Que es comida barata", "Que tiene mucha sal"],
                        1,
                    ),
                    (
                        "¿Cual es una practica basica de higiene?",
                        ["Lavarse las manos correctamente", "Guardar quimicos junto a alimentos", "Ignorar temperaturas", "Usar utensilios sucios"],
                        0,
                    ),
                ]
                for question, options, correct in questions:
                    conn.execute(
                        """
                        INSERT INTO questions
                        (exam_id, course_id, pregunta, opciones_json, respuesta_correcta, puntaje, estado, fecha_creacion, fecha_actualizacion)
                        VALUES (?, ?, ?, ?, ?, 1, 'Activo', ?, ?)
                        """,
                        (exam_id, course_id, question, json.dumps(options, ensure_ascii=False), correct, now, now),
                    )

    faq_count = conn.execute("SELECT COUNT(*) FROM faqs").fetchone()[0]
    if faq_count == 0:
        faqs = [
            ("¿Como valido un certificado?", "Ingresa el codigo unico o escanea el QR en la pagina de validacion.", "Certificados", 1),
            ("¿El documento completo es publico?", "No. La validacion publica muestra solo datos minimos y documento parcialmente oculto.", "Privacidad", 2),
            ("¿Puedo solicitar certificados para una empresa?", "Si. Usa la pagina de empresas para solicitar orientacion para grupos.", "Empresas", 3),
        ]
        for question, answer, category, order in faqs:
            conn.execute(
                """
                INSERT INTO faqs
                (pregunta, respuesta, categoria, estado, orden, fecha_creacion, fecha_actualizacion)
                VALUES (?, ?, ?, 'Activo', ?, ?, ?)
                """,
                (question, answer, category, order, now, now),
            )
    testimonial_count = conn.execute("SELECT COUNT(*) FROM testimonials").fetchone()[0]
    if testimonial_count == 0:
        testimonials = [
            ("Cliente empresarial", "Restaurante", "El proceso fue claro, ordenado y con validacion facil para el equipo.", "Activo", 1),
            ("Emprendimiento de alimentos", "Cliente", "La orientacion por WhatsApp y el certificado verificable nos ayudaron a organizarnos.", "Activo", 2),
        ]
        for name, role, text, status, order in testimonials:
            conn.execute(
                """
                INSERT INTO testimonials
                (nombre, cargo, texto, estado, orden, fecha_creacion, fecha_actualizacion)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (name, role, text, status, order, now, now),
            )


def normalize_certificate_payload(payload: dict[str, Any]) -> dict[str, str]:
    codigo = clean_text(payload.get("codigo_unico") or payload.get("codigo") or payload.get("code"), 80).upper()
    nombre = clean_text(payload.get("nombre_estudiante") or payload.get("nombre") or payload.get("titular"), 180)
    documento = clean_text(payload.get("documento") or payload.get("document") or "", 80)
    documento_masked = clean_text(payload.get("documento_parcial") or payload.get("documento_masked") or "", 80)
    if documento:
        last4 = document_last4(documento)
        masked = mask_document(documento)
        doc_hash = hash_document(documento)
    else:
        last4 = document_last4(documento_masked)
        masked = documento_masked or "No publicado"
        doc_hash = ""
    generated_validation_url, generated_qr_url = certificate_public_urls(codigo)
    return {
        "codigo_unico": codigo,
        "nombre_estudiante": nombre or "No publicado",
        "documento_hash": doc_hash,
        "documento_last4": last4,
        "documento_masked": masked,
        "curso": clean_text(payload.get("curso") or "Manipulacion de Alimentos", 180),
        "intensidad_horaria": clean_text(payload.get("intensidad_horaria") or "", 80),
        "fecha_emision": clean_text(payload.get("fecha_emision") or payload.get("fechaISO") or today_iso(), 40),
        "fecha_vencimiento": clean_text(payload.get("fecha_vencimiento") or payload.get("fechaVencimientoISO") or "", 40),
        "estado": clean_text(payload.get("estado") or "Activo", 40),
        "archivo_pdf_url": clean_text(payload.get("archivo_pdf_url") or payload.get("url_pdf") or "", 260),
        "qr_url": clean_text(generated_qr_url or payload.get("qr_url") or payload.get("qr") or "", 500),
        "validation_url": clean_text(generated_validation_url or payload.get("validation_url") or payload.get("validationUrl") or "", 500),
    }


def certificate_to_public(row: sqlite3.Row) -> dict[str, Any]:
    generated_validation_url, generated_qr_url = certificate_public_urls(row["codigo_unico"])
    return {
        "codigo": row["codigo_unico"],
        "codigo_unico": row["codigo_unico"],
        "nombre": row["nombre_estudiante"],
        "nombre_estudiante": row["nombre_estudiante"],
        "documento_parcial": row["documento_masked"] or "No publicado",
        "curso": row["curso"],
        "intensidad_horaria": row["intensidad_horaria"] or "",
        "fecha_emision": row["fecha_emision"],
        "fecha_vencimiento": row["fecha_vencimiento"] or "",
        "estado": row["estado"],
        "url_pdf": "",
        "archivo_pdf_url": "",
        "qr": generated_qr_url or row["qr_url"] or "",
        "qr_url": generated_qr_url or row["qr_url"] or "",
        "validation_url": generated_validation_url or row["validation_url"] or "",
    }


def public_certificates_from_db(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM certificates ORDER BY id DESC").fetchall()
    return [certificate_to_public(row) for row in rows]


def write_public_certificates_json(conn: sqlite3.Connection) -> tuple[int, list[str]]:
    data = public_certificates_from_db(conn)
    targets = [ROOT / "data" / "certificados.json", PUBLIC_DIR / "data" / "certificados.json"]
    written: list[str] = []
    for target in targets:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        written.append(str(target.relative_to(ROOT)))
    return len(data), written


def certificate_to_admin(row: sqlite3.Row) -> dict[str, Any]:
    data = certificate_to_public(row)
    data.update(
        {
            "id": row["id"],
            "tiene_pdf_privado": bool(row["archivo_pdf_path"]),
            "fecha_creacion": row["fecha_creacion"],
            "fecha_actualizacion": row["fecha_actualizacion"],
            "motivo_anulacion": row["motivo_anulacion"] or "",
        }
    )
    return data


def result_to_admin(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "nombre": row["nombre"],
        "documento": row["documento_masked"] or "No publicado",
        "correo": row["correo"] or "",
        "telefono": row["telefono"] or "",
        "curso": row["curso"],
        "puntaje": row["puntaje"],
        "total": row["total"],
        "porcentaje": row["porcentaje"],
        "estado": row["estado"],
        "fecha": row["fecha"],
        "fecha_creacion": row["fecha_creacion"],
    }


def service_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "nombre": row["nombre"],
        "slug": row["slug"] or "",
        "descripcion": row["descripcion"] or "",
        "beneficios": row["beneficios"] or "",
        "requisitos": row["requisitos"] or "",
        "duracion": row["duracion"] or "",
        "modalidad": row["modalidad"] or "",
        "precio": row["precio"] or "",
        "estado": row["estado"],
        "orden": row["orden"],
    }


def customer_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "nombre": row["nombre"],
        "tipo_documento": row["tipo_documento"] or "",
        "documento": row["documento_masked"] or "No publicado",
        "correo": row["correo"] or "",
        "celular": row["celular"] or "",
        "ciudad": row["ciudad"] or "",
        "empresa": row["empresa"] or "",
        "servicio_interes": row["servicio_interes"] or "",
        "estado": row["estado"],
        "fecha_creacion": row["fecha_creacion"],
    }


def request_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "nombre": row["nombre"],
        "tipo_documento": row["tipo_documento"] or "",
        "documento": row["documento_masked"] or "No publicado",
        "correo": row["correo"] or "",
        "celular": row["celular"] or "",
        "ciudad": row["ciudad"] or "",
        "servicio": row["servicio"] or "",
        "empresa": row["empresa"] or "",
        "mensaje": row["mensaje"] or "",
        "estado": row["estado"],
        "payment_status": row["payment_status"],
        "fecha_creacion": row["fecha_creacion"],
    }


def company_request_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "empresa": row["empresa"],
        "contacto": row["contacto"],
        "correo": row["correo"] or "",
        "celular": row["celular"] or "",
        "ciudad": row["ciudad"] or "",
        "cantidad_personas": row["cantidad_personas"],
        "servicio": row["servicio"] or "",
        "mensaje": row["mensaje"] or "",
        "estado": row["estado"],
        "fecha_creacion": row["fecha_creacion"],
    }


def course_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "nombre": row["nombre"],
        "slug": row["slug"] or "",
        "descripcion": row["descripcion"] or "",
        "duracion": row["duracion"] or "",
        "modalidad": row["modalidad"] or "",
        "puntaje_minimo": row["puntaje_minimo"],
        "intentos_maximos": row["intentos_maximos"],
        "estado": row["estado"],
    }


def question_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    try:
        options = json.loads(row["opciones_json"] or "[]")
    except Exception:
        options = []
    return {
        "id": row["id"],
        "exam_id": row["exam_id"],
        "course_id": row["course_id"],
        "pregunta": row["pregunta"],
        "opciones": options,
        "respuesta_correcta": row["respuesta_correcta"],
        "puntaje": row["puntaje"],
        "estado": row["estado"],
    }


def payment_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "customer_id": row["customer_id"],
        "certificate_id": row["certificate_id"],
        "nombre_cliente": row["nombre_cliente"] or "",
        "servicio": row["servicio"] or "",
        "monto": row["monto"] or "",
        "moneda": row["moneda"],
        "metodo": row["metodo"],
        "referencia": row["referencia"] or "",
        "estado": row["estado"],
        "comprobante_nombre": row["comprobante_nombre"] or "",
        "notas": row["notas"] or "",
        "fecha_creacion": row["fecha_creacion"],
        "fecha_actualizacion": row["fecha_actualizacion"],
    }


def faq_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "pregunta": row["pregunta"],
        "respuesta": row["respuesta"],
        "categoria": row["categoria"],
        "estado": row["estado"],
        "orden": row["orden"],
    }


def testimonial_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "nombre": row["nombre"],
        "cargo": row["cargo"] or "",
        "texto": row["texto"],
        "estado": row["estado"],
        "orden": row["orden"],
    }


def log_action(conn: sqlite3.Connection, admin_id: int | None, action: str, description: str, ip: str) -> None:
    conn.execute(
        "INSERT INTO logs (admin_id, accion, descripcion, fecha, ip) VALUES (?, ?, ?, ?, ?)",
        (admin_id, action, description[:500], utc_now(), ip[:80]),
    )
    conn.execute(
        "INSERT INTO audit_logs (user_id, accion, descripcion, fecha, ip) VALUES (?, ?, ?, ?, ?)",
        (admin_id, action, description[:500], utc_now(), ip[:80]),
    )


class MultiserviciosHandler(BaseHTTPRequestHandler):
    server_version = "MultiserviciosBackend/1.0"

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/"):
            self.handle_api("GET", path, parsed)
            return
        self.serve_static(path)

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api("POST", parsed.path, parsed)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_PATCH(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api("PATCH", parsed.path, parsed)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or "0")
        if length > MAX_JSON_BODY:
            raise ValueError("body demasiado grande")
        raw = self.rfile.read(length) if length else b"{}"
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def send_json(self, data: Any, status: int = 200, headers: dict[str, str] | None = None) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def current_admin(self) -> sqlite3.Row | None:
        cookie = SimpleCookie(self.headers.get("Cookie"))
        morsel = cookie.get(SESSION_COOKIE)
        if not morsel:
            return None
        token = morsel.value
        now = utc_now()
        with db() as conn:
            row = conn.execute(
                """
                SELECT admins.*
                FROM sessions
                JOIN admins ON admins.id = sessions.admin_id
                WHERE sessions.token = ? AND sessions.expires_at > ? AND admins.estado = 'activo'
                """,
                (token, now),
            ).fetchone()
            return row

    def require_admin(self) -> sqlite3.Row | None:
        admin = self.current_admin()
        if not admin:
            self.send_json({"ok": False, "error": "No autenticado"}, 401)
            return None
        return admin

    def require_same_origin(self) -> bool:
        origin = self.headers.get("Origin")
        host = self.headers.get("Host")
        if origin and host:
            parsed = urllib.parse.urlparse(origin)
            if parsed.netloc.lower() == host.lower() and parsed.scheme in {"http", "https"}:
                return True
        referer = self.headers.get("Referer")
        if not origin and referer and host:
            parsed = urllib.parse.urlparse(referer)
            if parsed.netloc.lower() == host.lower() and parsed.scheme in {"http", "https"}:
                return True
        self.send_json({"ok": False, "error": "Origen de solicitud no permitido"}, 403)
        return False

    def handle_api(self, method: str, path: str, parsed: urllib.parse.ParseResult) -> None:
        try:
            if method in {"POST", "PATCH"} and (path.startswith("/api/admin/") or path == "/api/auth/logout"):
                if not self.require_same_origin():
                    return
            if method == "POST" and path == "/api/auth/login":
                self.api_login()
            elif method == "POST" and path == "/api/auth/logout":
                self.api_logout()
            elif method == "GET" and path == "/api/auth/me":
                self.api_me()
            elif method == "GET" and path == "/api/health":
                self.send_json({"ok": True, "service": "multiservicios", "environment": ENVIRONMENT})
            elif method == "GET" and path == "/api/certificados/validar":
                self.api_validate_certificate(parsed)
            elif method == "GET" and path == "/api/public/catalogo":
                self.api_public_catalog()
            elif method == "POST" and path == "/api/solicitudes":
                self.api_create_contact_request()
            elif method == "POST" and path == "/api/empresas":
                self.api_create_company_request()
            elif method == "POST" and path == "/api/resultados":
                self.api_create_result()
            elif method == "GET" and path == "/api/admin/stats":
                self.api_stats()
            elif method == "GET" and path == "/api/admin/clientes":
                self.api_list_customers()
            elif method == "POST" and path == "/api/admin/clientes":
                self.api_create_customer()
            elif method == "GET" and path == "/api/admin/solicitudes":
                self.api_list_contact_requests()
            elif method == "GET" and path == "/api/admin/empresas":
                self.api_list_company_requests()
            elif method == "GET" and path == "/api/admin/servicios":
                self.api_list_services()
            elif method == "POST" and path == "/api/admin/servicios":
                self.api_create_service()
            elif method == "GET" and path == "/api/admin/cursos":
                self.api_list_courses()
            elif method == "POST" and path == "/api/admin/cursos":
                self.api_create_course()
            elif method == "GET" and path == "/api/admin/preguntas":
                self.api_list_questions()
            elif method == "POST" and path == "/api/admin/preguntas":
                self.api_create_question()
            elif method == "GET" and path == "/api/admin/pagos":
                self.api_list_payments()
            elif method == "POST" and path == "/api/admin/pagos":
                self.api_create_payment()
            elif method == "GET" and path == "/api/admin/faqs":
                self.api_list_faqs()
            elif method == "POST" and path == "/api/admin/faqs":
                self.api_create_faq()
            elif method == "GET" and path == "/api/admin/testimonios":
                self.api_list_testimonials()
            elif method == "POST" and path == "/api/admin/testimonios":
                self.api_create_testimonial()
            elif method == "GET" and path == "/api/admin/auditoria":
                self.api_list_audit_logs()
            elif method == "GET" and path == "/api/admin/certificados":
                self.api_list_certificates()
            elif method == "POST" and path == "/api/admin/certificados":
                self.api_create_certificate()
            elif method == "GET" and path == "/api/admin/certificados/public-json":
                self.api_public_certificates_json()
            elif method == "POST" and path == "/api/admin/certificados/publicar-base":
                self.api_publish_certificates_json()
            elif method == "GET" and path == "/api/admin/resultados":
                self.api_list_results()
            elif method == "POST" and path == "/api/admin/resultados":
                self.api_create_result()
            elif method == "PATCH" and path.startswith("/api/admin/certificados/") and path.endswith("/anular"):
                code = urllib.parse.unquote(path.removeprefix("/api/admin/certificados/").removesuffix("/anular")).strip("/")
                self.api_annul_certificate(code)
            elif method == "POST" and path.startswith("/api/admin/certificados/") and path.endswith("/pdf"):
                code = urllib.parse.unquote(path.removeprefix("/api/admin/certificados/").removesuffix("/pdf")).strip("/")
                self.api_upload_certificate_pdf(code)
            elif method == "PATCH" and path.startswith("/api/admin/pagos/"):
                item_id = int(path.removeprefix("/api/admin/pagos/").strip("/"))
                self.api_update_payment(item_id)
            elif method == "PATCH" and path.startswith("/api/admin/solicitudes/"):
                item_id = int(path.removeprefix("/api/admin/solicitudes/").strip("/"))
                self.api_update_contact_request(item_id)
            else:
                self.send_json({"ok": False, "error": "Ruta no encontrada"}, 404)
        except json.JSONDecodeError:
            self.send_json({"ok": False, "error": "JSON invalido"}, 400)
        except ValueError as exc:
            self.send_json({"ok": False, "error": str(exc)}, 400)
        except Exception as exc:
            self.log_message("API error: %s", exc)
            self.send_json({"ok": False, "error": "Error interno"}, 500)

    def api_login(self) -> None:
        ip = self.client_address[0]
        payload = self.read_json()
        password = clean_text(payload.get("password") or payload.get("clave") or payload.get("frase"), 200)
        with db() as conn:
            admin = conn.execute("SELECT * FROM admins WHERE email = ? AND estado = 'activo'", (ADMIN_EMAIL,)).fetchone()
            valid_password = bool(admin) and verify_password(password, admin["password_salt"], admin["password_hash"])
            if valid_password:
                clear_failed_logins(ip)
            else:
                retry_after = login_retry_after(ip)
                if retry_after:
                    self.send_json(
                        {"ok": False, "error": "Demasiados intentos. Intenta mas tarde."},
                        429,
                        {"Retry-After": str(retry_after)},
                    )
                    return
                register_failed_login(ip)
                self.send_json({"ok": False, "error": "Clave incorrecta"}, 401)
                return
            token = secrets.token_urlsafe(36)
            expires = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=SESSION_DAYS)).isoformat(timespec="seconds")
            conn.execute("INSERT INTO sessions (token, admin_id, fecha_creacion, expires_at) VALUES (?, ?, ?, ?)", (token, admin["id"], utc_now(), expires))
            conn.execute("UPDATE admins SET ultimo_login = ? WHERE id = ?", (utc_now(), admin["id"]))
            log_action(conn, admin["id"], "login", "Inicio de sesion admin", ip)
        secure = "; Secure" if COOKIE_SECURE else ""
        cookie = f"{SESSION_COOKIE}={token}; Path=/; Max-Age={SESSION_DAYS * 86400}; HttpOnly; SameSite=Strict{secure}"
        self.send_json({"ok": True, "admin": {"email": ADMIN_EMAIL, "rol": "admin"}}, headers={"Set-Cookie": cookie})

    def api_logout(self) -> None:
        cookie = SimpleCookie(self.headers.get("Cookie"))
        morsel = cookie.get(SESSION_COOKIE)
        if morsel:
            with db() as conn:
                conn.execute("DELETE FROM sessions WHERE token = ?", (morsel.value,))
        secure = "; Secure" if COOKIE_SECURE else ""
        expired = f"{SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict{secure}"
        self.send_json({"ok": True}, headers={"Set-Cookie": expired})

    def api_me(self) -> None:
        admin = self.current_admin()
        if not admin:
            self.send_json({"ok": False, "authenticated": False}, 401)
            return
        self.send_json({"ok": True, "authenticated": True, "admin": {"email": admin["email"], "rol": admin["rol"]}})

    def api_validate_certificate(self, parsed: urllib.parse.ParseResult) -> None:
        qs = urllib.parse.parse_qs(parsed.query)
        code = clean_text((qs.get("codigo") or [""])[0], 80).upper()
        doc = clean_text((qs.get("documento") or [""])[0], 80)
        if not code and not doc:
            self.send_json({"ok": False, "error": "Ingresa codigo o documento"}, 400)
            return
        with db() as conn:
            row = None
            if code:
                row = conn.execute("SELECT * FROM certificates WHERE codigo_unico = ?", (code,)).fetchone()
            elif doc:
                last4 = document_last4(doc)
                doc_hash = hash_document(doc)
                row = conn.execute(
                    "SELECT * FROM certificates WHERE documento_hash = ? OR documento_last4 = ? ORDER BY id DESC LIMIT 1",
                    (doc_hash, last4),
                ).fetchone()
        if not row:
            self.send_json({"ok": False, "found": False}, 404)
            return
        if doc:
            last4 = document_last4(doc)
            doc_hash = hash_document(doc)
            stored_hash = row["documento_hash"] or ""
            stored_last4 = row["documento_last4"] or ""
            hash_matches = bool(stored_hash and hmac.compare_digest(stored_hash, doc_hash))
            last4_matches = bool(stored_last4 and stored_last4 == last4)
            if not hash_matches and not last4_matches:
                public = certificate_to_public(row)
                public["estado"] = "Revision requerida"
                self.send_json({"ok": True, "found": True, "documento_coincide": False, "certificado": public})
                return
        self.send_json({"ok": True, "found": True, "documento_coincide": True, "certificado": certificate_to_public(row)})

    def api_public_catalog(self) -> None:
        with db() as conn:
            services = conn.execute("SELECT * FROM services WHERE estado = 'Activo' ORDER BY orden, id").fetchall()
            faqs = conn.execute("SELECT * FROM faqs WHERE estado = 'Activo' ORDER BY orden, id").fetchall()
            testimonials = conn.execute("SELECT * FROM testimonials WHERE estado = 'Activo' ORDER BY orden, id").fetchall()
            courses = conn.execute("SELECT * FROM courses WHERE estado = 'Activo' ORDER BY id").fetchall()
        self.send_json(
            {
                "ok": True,
                "services": [service_to_dict(row) for row in services],
                "faqs": [faq_to_dict(row) for row in faqs],
                "testimonials": [testimonial_to_dict(row) for row in testimonials],
                "courses": [course_to_dict(row) for row in courses],
                "payment": {
                    "mode": os.environ.get("MS_PAYMENT_MODE", "manual"),
                    "provider": os.environ.get("MS_PAYMENT_PROVIDER", "manual"),
                    "public_key_configured": bool(os.environ.get("MS_PAYMENT_PUBLIC_KEY")),
                },
            }
        )

    def upsert_customer_from_payload(self, conn: sqlite3.Connection, payload: dict[str, Any]) -> int:
        nombre = clean_text(payload.get("nombre"), 180)
        if not nombre:
            raise ValueError("nombre requerido")
        documento = clean_text(payload.get("documento"), 80)
        doc_hash = hash_document(documento)
        correo = clean_text(payload.get("correo"), 160)
        existing = None
        if doc_hash:
            existing = conn.execute("SELECT id FROM customers WHERE documento_hash = ?", (doc_hash,)).fetchone()
        if not existing and correo:
            existing = conn.execute("SELECT id FROM customers WHERE correo = ?", (correo,)).fetchone()
        values = (
            nombre,
            clean_text(payload.get("tipo_documento"), 40),
            doc_hash,
            document_last4(documento),
            mask_document(documento),
            correo,
            clean_text(payload.get("celular") or payload.get("telefono"), 80),
            clean_text(payload.get("ciudad"), 120),
            clean_text(payload.get("empresa"), 160),
            clean_text(payload.get("servicio") or payload.get("servicio_interes"), 180),
            utc_now(),
        )
        if existing:
            customer_id = int(existing["id"])
            conn.execute(
                """
                UPDATE customers
                SET nombre=?, tipo_documento=?, documento_hash=?, documento_last4=?, documento_masked=?,
                    correo=?, celular=?, ciudad=?, empresa=?, servicio_interes=?, estado='Activo', fecha_actualizacion=?
                WHERE id=?
                """,
                (*values, customer_id),
            )
            return customer_id
        cur = conn.execute(
            """
            INSERT INTO customers
            (nombre, tipo_documento, documento_hash, documento_last4, documento_masked, correo, celular,
             ciudad, empresa, servicio_interes, estado, fecha_creacion, fecha_actualizacion)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Activo', ?, ?)
            """,
            (*values, utc_now()),
        )
        return int(cur.lastrowid)

    def api_create_contact_request(self) -> None:
        payload = self.read_json()
        if not payload.get("acepta_datos"):
            raise ValueError("Debes aceptar el tratamiento de datos")
        with db() as conn:
            customer_id = self.upsert_customer_from_payload(conn, payload)
            documento = clean_text(payload.get("documento"), 80)
            conn.execute(
                """
                INSERT INTO contact_requests
                (nombre, tipo_documento, documento_hash, documento_last4, documento_masked, correo, celular, ciudad,
                 servicio, empresa, mensaje, acepta_datos, estado, payment_status, fecha_creacion, fecha_actualizacion)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'Pendiente', 'Pendiente', ?, ?)
                """,
                (
                    clean_text(payload.get("nombre"), 180),
                    clean_text(payload.get("tipo_documento"), 40),
                    hash_document(documento),
                    document_last4(documento),
                    mask_document(documento),
                    clean_text(payload.get("correo"), 160),
                    clean_text(payload.get("celular") or payload.get("telefono"), 80),
                    clean_text(payload.get("ciudad"), 120),
                    clean_text(payload.get("servicio"), 180),
                    clean_text(payload.get("empresa"), 160),
                    clean_text(payload.get("mensaje"), 800),
                    utc_now(),
                    utc_now(),
                ),
            )
            if payload.get("referencia_pago") or payload.get("monto"):
                conn.execute(
                    """
                    INSERT INTO payments
                    (customer_id, nombre_cliente, servicio, monto, metodo, referencia, estado, notas, fecha_creacion, fecha_actualizacion)
                    VALUES (?, ?, ?, ?, 'Manual', ?, 'Pendiente', ?, ?, ?)
                    """,
                    (
                        customer_id,
                        clean_text(payload.get("nombre"), 180),
                        clean_text(payload.get("servicio"), 180),
                        clean_text(payload.get("monto"), 60),
                        clean_text(payload.get("referencia_pago"), 160),
                        clean_text(payload.get("mensaje"), 300),
                        utc_now(),
                        utc_now(),
                    ),
                )
        self.send_json({"ok": True, "message": "Solicitud registrada", "customer_id": customer_id}, 201)

    def api_create_company_request(self) -> None:
        payload = self.read_json()
        empresa = clean_text(payload.get("empresa"), 180)
        contacto = clean_text(payload.get("contacto") or payload.get("nombre"), 180)
        if not empresa or not contacto:
            raise ValueError("empresa y contacto requeridos")
        with db() as conn:
            conn.execute(
                """
                INSERT INTO company_requests
                (empresa, contacto, correo, celular, ciudad, cantidad_personas, servicio, mensaje, estado, fecha_creacion, fecha_actualizacion)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?)
                """,
                (
                    empresa,
                    contacto,
                    clean_text(payload.get("correo"), 160),
                    clean_text(payload.get("celular") or payload.get("telefono"), 80),
                    clean_text(payload.get("ciudad"), 120),
                    int(payload.get("cantidad_personas") or 1),
                    clean_text(payload.get("servicio"), 180),
                    clean_text(payload.get("mensaje"), 800),
                    utc_now(),
                    utc_now(),
                ),
            )
        self.send_json({"ok": True, "message": "Solicitud empresarial registrada"}, 201)

    def api_stats(self) -> None:
        if not self.require_admin():
            return
        with db() as conn:
            certs = conn.execute("SELECT COUNT(*) FROM certificates").fetchone()[0]
            annulled = conn.execute("SELECT COUNT(*) FROM certificates WHERE UPPER(estado) = 'ANULADO'").fetchone()[0]
            results = conn.execute("SELECT COUNT(*) FROM course_results").fetchone()[0]
            customers = conn.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
            pending_requests = conn.execute("SELECT COUNT(*) FROM contact_requests WHERE estado = 'Pendiente'").fetchone()[0]
            pending_payments = conn.execute("SELECT COUNT(*) FROM payments WHERE estado = 'Pendiente'").fetchone()[0]
            approved = conn.execute("SELECT COUNT(*) FROM course_results WHERE estado = 'Aprobado'").fetchone()[0]
            failed = conn.execute("SELECT COUNT(*) FROM course_results WHERE estado <> 'Aprobado'").fetchone()[0]
            services = conn.execute("SELECT COUNT(*) FROM services WHERE estado = 'Activo'").fetchone()[0]
        self.send_json(
            {
                "ok": True,
                "certificates": certs,
                "annulled": annulled,
                "course_results": results,
                "customers": customers,
                "pending_requests": pending_requests,
                "pending_payments": pending_payments,
                "approved_exams": approved,
                "failed_exams": failed,
                "active_services": services,
            }
        )

    def api_list_customers(self) -> None:
        if not self.require_admin():
            return
        with db() as conn:
            rows = conn.execute("SELECT * FROM customers ORDER BY id DESC LIMIT 500").fetchall()
        self.send_json({"ok": True, "clientes": [customer_to_dict(row) for row in rows]})

    def api_create_customer(self) -> None:
        admin = self.require_admin()
        if not admin:
            return
        payload = self.read_json()
        with db() as conn:
            customer_id = self.upsert_customer_from_payload(conn, payload)
            row = conn.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
            log_action(conn, admin["id"], "cliente_guardado", str(customer_id), self.client_address[0])
        self.send_json({"ok": True, "cliente": customer_to_dict(row)}, 201)

    def api_list_contact_requests(self) -> None:
        if not self.require_admin():
            return
        with db() as conn:
            rows = conn.execute("SELECT * FROM contact_requests ORDER BY id DESC LIMIT 500").fetchall()
        self.send_json({"ok": True, "solicitudes": [request_to_dict(row) for row in rows]})

    def api_update_contact_request(self, item_id: int) -> None:
        admin = self.require_admin()
        if not admin:
            return
        payload = self.read_json()
        estado = clean_text(payload.get("estado") or "En proceso", 40)
        payment_status = clean_text(payload.get("payment_status") or payload.get("pago") or "Pendiente", 40)
        with db() as conn:
            conn.execute("UPDATE contact_requests SET estado=?, payment_status=?, fecha_actualizacion=? WHERE id=?", (estado, payment_status, utc_now(), item_id))
            row = conn.execute("SELECT * FROM contact_requests WHERE id=?", (item_id,)).fetchone()
            log_action(conn, admin["id"], "solicitud_actualizada", str(item_id), self.client_address[0])
        if not row:
            self.send_json({"ok": False, "error": "Solicitud no encontrada"}, 404)
            return
        self.send_json({"ok": True, "solicitud": request_to_dict(row)})

    def api_list_company_requests(self) -> None:
        if not self.require_admin():
            return
        with db() as conn:
            rows = conn.execute("SELECT * FROM company_requests ORDER BY id DESC LIMIT 500").fetchall()
        self.send_json({"ok": True, "empresas": [company_request_to_dict(row) for row in rows]})

    def api_list_services(self) -> None:
        if not self.require_admin():
            return
        with db() as conn:
            rows = conn.execute("SELECT * FROM services ORDER BY orden, id").fetchall()
        self.send_json({"ok": True, "servicios": [service_to_dict(row) for row in rows]})

    def api_create_service(self) -> None:
        admin = self.require_admin()
        if not admin:
            return
        payload = self.read_json()
        nombre = clean_text(payload.get("nombre"), 180)
        if not nombre:
            raise ValueError("nombre requerido")
        slug = slugify(payload.get("slug") or nombre)
        with db() as conn:
            conn.execute(
                """
                INSERT INTO services
                (nombre, slug, descripcion, beneficios, requisitos, duracion, modalidad, precio, estado, orden, fecha_creacion, fecha_actualizacion)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(slug) DO UPDATE SET
                  nombre=excluded.nombre, descripcion=excluded.descripcion, beneficios=excluded.beneficios,
                  requisitos=excluded.requisitos, duracion=excluded.duracion, modalidad=excluded.modalidad,
                  precio=excluded.precio, estado=excluded.estado, orden=excluded.orden,
                  fecha_actualizacion=excluded.fecha_actualizacion
                """,
                (
                    nombre,
                    slug,
                    clean_text(payload.get("descripcion"), 900),
                    clean_text(payload.get("beneficios"), 900),
                    clean_text(payload.get("requisitos"), 900),
                    clean_text(payload.get("duracion"), 80),
                    clean_text(payload.get("modalidad"), 80),
                    clean_text(payload.get("precio"), 80),
                    clean_text(payload.get("estado") or "Activo", 40),
                    int(payload.get("orden") or 0),
                    utc_now(),
                    utc_now(),
                ),
            )
            log_action(conn, admin["id"], "servicio_guardado", nombre, self.client_address[0])
        self.send_json({"ok": True}, 201)

    def api_list_courses(self) -> None:
        if not self.require_admin():
            return
        with db() as conn:
            rows = conn.execute("SELECT * FROM courses ORDER BY id DESC").fetchall()
        self.send_json({"ok": True, "cursos": [course_to_dict(row) for row in rows]})

    def api_create_course(self) -> None:
        admin = self.require_admin()
        if not admin:
            return
        payload = self.read_json()
        nombre = clean_text(payload.get("nombre"), 180)
        if not nombre:
            raise ValueError("nombre requerido")
        slug = slugify(payload.get("slug") or nombre)
        with db() as conn:
            conn.execute(
                """
                INSERT INTO courses
                (nombre, slug, descripcion, duracion, modalidad, puntaje_minimo, intentos_maximos, estado, fecha_creacion, fecha_actualizacion)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(slug) DO UPDATE SET
                  nombre=excluded.nombre, descripcion=excluded.descripcion, duracion=excluded.duracion,
                  modalidad=excluded.modalidad, puntaje_minimo=excluded.puntaje_minimo,
                  intentos_maximos=excluded.intentos_maximos, estado=excluded.estado,
                  fecha_actualizacion=excluded.fecha_actualizacion
                """,
                (
                    nombre,
                    slug,
                    clean_text(payload.get("descripcion"), 900),
                    clean_text(payload.get("duracion"), 80),
                    clean_text(payload.get("modalidad"), 80),
                    int(payload.get("puntaje_minimo") or 80),
                    int(payload.get("intentos_maximos") or 2),
                    clean_text(payload.get("estado") or "Activo", 40),
                    utc_now(),
                    utc_now(),
                ),
            )
            course = conn.execute("SELECT id FROM courses WHERE slug=?", (slug,)).fetchone()
            if course and not conn.execute("SELECT 1 FROM exams WHERE course_id=? LIMIT 1", (course["id"],)).fetchone():
                conn.execute(
                    """
                    INSERT INTO exams
                    (course_id, nombre, puntaje_minimo, intentos_maximos, estado, fecha_creacion, fecha_actualizacion)
                    VALUES (?, ?, ?, ?, 'Activo', ?, ?)
                    """,
                    (course["id"], "Examen " + nombre, int(payload.get("puntaje_minimo") or 80), int(payload.get("intentos_maximos") or 2), utc_now(), utc_now()),
                )
            log_action(conn, admin["id"], "curso_guardado", nombre, self.client_address[0])
        self.send_json({"ok": True}, 201)

    def api_list_questions(self) -> None:
        if not self.require_admin():
            return
        with db() as conn:
            rows = conn.execute("SELECT * FROM questions ORDER BY id DESC LIMIT 500").fetchall()
        self.send_json({"ok": True, "preguntas": [question_to_dict(row) for row in rows]})

    def api_create_question(self) -> None:
        admin = self.require_admin()
        if not admin:
            return
        payload = self.read_json()
        pregunta = clean_text(payload.get("pregunta"), 600)
        if not pregunta:
            raise ValueError("pregunta requerida")
        options = payload.get("opciones")
        if isinstance(options, str):
            options = [clean_text(item, 180) for item in options.split("|") if clean_text(item, 180)]
        if not isinstance(options, list) or len(options) < 2:
            raise ValueError("minimo dos opciones")
        with db() as conn:
            course_id = int(payload.get("course_id") or 1)
            exam = conn.execute("SELECT id FROM exams WHERE course_id=? LIMIT 1", (course_id,)).fetchone()
            if not exam:
                cur = conn.execute(
                    "INSERT INTO exams (course_id, nombre, puntaje_minimo, intentos_maximos, estado, fecha_creacion, fecha_actualizacion) VALUES (?, 'Examen', 70, 2, 'Activo', ?, ?)",
                    (course_id, utc_now(), utc_now()),
                )
                exam_id = cur.lastrowid
            else:
                exam_id = int(exam["id"])
            conn.execute(
                """
                INSERT INTO questions
                (exam_id, course_id, pregunta, opciones_json, respuesta_correcta, puntaje, estado, fecha_creacion, fecha_actualizacion)
                VALUES (?, ?, ?, ?, ?, ?, 'Activo', ?, ?)
                """,
                (exam_id, course_id, pregunta, json.dumps(options, ensure_ascii=False), int(payload.get("respuesta_correcta") or 0), int(payload.get("puntaje") or 1), utc_now(), utc_now()),
            )
            log_action(conn, admin["id"], "pregunta_creada", pregunta[:120], self.client_address[0])
        self.send_json({"ok": True}, 201)

    def api_list_payments(self) -> None:
        if not self.require_admin():
            return
        with db() as conn:
            rows = conn.execute("SELECT * FROM payments ORDER BY id DESC LIMIT 500").fetchall()
        self.send_json({"ok": True, "pagos": [payment_to_dict(row) for row in rows]})

    def api_create_payment(self) -> None:
        admin = self.require_admin()
        if not admin:
            return
        payload = self.read_json()
        with db() as conn:
            conn.execute(
                """
                INSERT INTO payments
                (customer_id, nombre_cliente, servicio, monto, moneda, metodo, referencia, estado, comprobante_nombre, notas, fecha_creacion, fecha_actualizacion)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    int(payload.get("customer_id") or 0) or None,
                    clean_text(payload.get("nombre_cliente"), 180),
                    clean_text(payload.get("servicio"), 180),
                    clean_text(payload.get("monto"), 80),
                    clean_text(payload.get("moneda") or "COP", 20),
                    clean_text(payload.get("metodo") or "Manual", 80),
                    clean_text(payload.get("referencia"), 160),
                    clean_text(payload.get("estado") or "Pendiente", 40),
                    clean_text(payload.get("comprobante_nombre"), 180),
                    clean_text(payload.get("notas"), 500),
                    utc_now(),
                    utc_now(),
                ),
            )
            log_action(conn, admin["id"], "pago_guardado", clean_text(payload.get("referencia"), 160), self.client_address[0])
        self.send_json({"ok": True}, 201)

    def api_update_payment(self, item_id: int) -> None:
        admin = self.require_admin()
        if not admin:
            return
        payload = self.read_json()
        with db() as conn:
            conn.execute(
                "UPDATE payments SET estado=?, referencia=COALESCE(NULLIF(?, ''), referencia), notas=COALESCE(NULLIF(?, ''), notas), fecha_actualizacion=? WHERE id=?",
                (clean_text(payload.get("estado") or "Pendiente", 40), clean_text(payload.get("referencia"), 160), clean_text(payload.get("notas"), 500), utc_now(), item_id),
            )
            row = conn.execute("SELECT * FROM payments WHERE id=?", (item_id,)).fetchone()
            log_action(conn, admin["id"], "pago_actualizado", str(item_id), self.client_address[0])
        if not row:
            self.send_json({"ok": False, "error": "Pago no encontrado"}, 404)
            return
        self.send_json({"ok": True, "pago": payment_to_dict(row)})

    def api_list_faqs(self) -> None:
        if not self.require_admin():
            return
        with db() as conn:
            rows = conn.execute("SELECT * FROM faqs ORDER BY orden, id").fetchall()
        self.send_json({"ok": True, "faqs": [faq_to_dict(row) for row in rows]})

    def api_create_faq(self) -> None:
        admin = self.require_admin()
        if not admin:
            return
        payload = self.read_json()
        pregunta = clean_text(payload.get("pregunta"), 300)
        respuesta = clean_text(payload.get("respuesta"), 900)
        if not pregunta or not respuesta:
            raise ValueError("pregunta y respuesta requeridas")
        with db() as conn:
            conn.execute(
                "INSERT INTO faqs (pregunta, respuesta, categoria, estado, orden, fecha_creacion, fecha_actualizacion) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (pregunta, respuesta, clean_text(payload.get("categoria") or "General", 80), clean_text(payload.get("estado") or "Activo", 40), int(payload.get("orden") or 0), utc_now(), utc_now()),
            )
            log_action(conn, admin["id"], "faq_creada", pregunta, self.client_address[0])
        self.send_json({"ok": True}, 201)

    def api_list_testimonials(self) -> None:
        if not self.require_admin():
            return
        with db() as conn:
            rows = conn.execute("SELECT * FROM testimonials ORDER BY orden, id").fetchall()
        self.send_json({"ok": True, "testimonios": [testimonial_to_dict(row) for row in rows]})

    def api_create_testimonial(self) -> None:
        admin = self.require_admin()
        if not admin:
            return
        payload = self.read_json()
        nombre = clean_text(payload.get("nombre"), 180)
        texto = clean_text(payload.get("texto"), 900)
        if not nombre or not texto:
            raise ValueError("nombre y texto requeridos")
        with db() as conn:
            conn.execute(
                "INSERT INTO testimonials (nombre, cargo, texto, estado, orden, fecha_creacion, fecha_actualizacion) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (nombre, clean_text(payload.get("cargo"), 120), texto, clean_text(payload.get("estado") or "Activo", 40), int(payload.get("orden") or 0), utc_now(), utc_now()),
            )
            log_action(conn, admin["id"], "testimonio_creado", nombre, self.client_address[0])
        self.send_json({"ok": True}, 201)

    def api_list_audit_logs(self) -> None:
        if not self.require_admin():
            return
        with db() as conn:
            rows = conn.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200").fetchall()
        self.send_json({"ok": True, "logs": [dict(row) for row in rows]})

    def api_list_certificates(self) -> None:
        if not self.require_admin():
            return
        with db() as conn:
            rows = conn.execute("SELECT * FROM certificates ORDER BY id DESC LIMIT 500").fetchall()
        self.send_json({"ok": True, "certificados": [certificate_to_admin(row) for row in rows]})

    def api_create_certificate(self) -> None:
        admin = self.require_admin()
        if not admin:
            return
        payload = self.read_json()
        cert = normalize_certificate_payload(payload)
        if not cert["codigo_unico"]:
            raise ValueError("codigo requerido")
        with db() as conn:
            conn.execute(
                """
                INSERT INTO certificates
                (codigo_unico, nombre_estudiante, documento_hash, documento_last4, documento_masked,
                 curso, intensidad_horaria, fecha_emision, fecha_vencimiento, estado,
                 archivo_pdf_url, qr_url, validation_url, creado_por, fecha_creacion, fecha_actualizacion)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(codigo_unico) DO UPDATE SET
                  nombre_estudiante=excluded.nombre_estudiante,
                  documento_hash=excluded.documento_hash,
                  documento_last4=excluded.documento_last4,
                  documento_masked=excluded.documento_masked,
                  curso=excluded.curso,
                  fecha_emision=excluded.fecha_emision,
                  fecha_vencimiento=excluded.fecha_vencimiento,
                  estado=excluded.estado,
                  validation_url=excluded.validation_url,
                  fecha_actualizacion=excluded.fecha_actualizacion
                """,
                (
                    cert["codigo_unico"],
                    cert["nombre_estudiante"],
                    cert["documento_hash"],
                    cert["documento_last4"],
                    cert["documento_masked"],
                    cert["curso"],
                    cert["intensidad_horaria"],
                    cert["fecha_emision"],
                    cert["fecha_vencimiento"],
                    cert["estado"],
                    cert["archivo_pdf_url"],
                    cert["qr_url"],
                    cert["validation_url"],
                    admin["id"],
                    utc_now(),
                    utc_now(),
                ),
            )
            row = conn.execute("SELECT * FROM certificates WHERE codigo_unico = ?", (cert["codigo_unico"],)).fetchone()
            log_action(conn, admin["id"], "certificado_guardado", cert["codigo_unico"], self.client_address[0])
        self.send_json({"ok": True, "certificado": certificate_to_admin(row)}, 201)

    def api_public_certificates_json(self) -> None:
        if not self.require_admin():
            return
        with db() as conn:
            data = public_certificates_from_db(conn)
        self.send_json({"ok": True, "certificados": data, "total": len(data)})

    def api_publish_certificates_json(self) -> None:
        admin = self.require_admin()
        if not admin:
            return
        with db() as conn:
            total, written = write_public_certificates_json(conn)
            log_action(conn, admin["id"], "base_publica_certificados", f"{total} certificados", self.client_address[0])
        self.send_json({"ok": True, "total": total, "archivos": written})

    def api_annul_certificate(self, code: str) -> None:
        admin = self.require_admin()
        if not admin:
            return
        payload = self.read_json()
        reason = clean_text(payload.get("motivo") or payload.get("motivo_anulacion") or "Anulado desde panel", 300)
        code = clean_text(code, 80).upper()
        with db() as conn:
            row = conn.execute("SELECT * FROM certificates WHERE codigo_unico = ?", (code,)).fetchone()
            if not row:
                self.send_json({"ok": False, "error": "Certificado no encontrado"}, 404)
                return
            conn.execute(
                "UPDATE certificates SET estado = 'Anulado', motivo_anulacion = ?, fecha_actualizacion = ? WHERE codigo_unico = ?",
                (reason, utc_now(), code),
            )
            row = conn.execute("SELECT * FROM certificates WHERE codigo_unico = ?", (code,)).fetchone()
            log_action(conn, admin["id"], "certificado_anulado", code, self.client_address[0])
        self.send_json({"ok": True, "certificado": certificate_to_admin(row)})

    def api_upload_certificate_pdf(self, code: str) -> None:
        admin = self.require_admin()
        if not admin:
            return
        code = clean_text(code, 80).upper()
        payload = self.read_json()
        data_url = clean_text(payload.get("data_url") or "", MAX_JSON_BODY)
        content_b64 = payload.get("content_base64") or ""
        if data_url.startswith("data:"):
            content_b64 = data_url.split(",", 1)[1] if "," in data_url else ""
        if not content_b64:
            raise ValueError("PDF requerido")
        raw = base64.b64decode(content_b64, validate=False)
        if not raw.startswith(b"%PDF"):
            raise ValueError("El archivo no parece ser PDF")
        safe_code = "".join(ch for ch in code if ch.isalnum() or ch in ("-", "_"))[:80]
        filename = f"{safe_code}.pdf"
        target = PDF_DIR / filename
        target.write_bytes(raw)
        with db() as conn:
            row = conn.execute("SELECT * FROM certificates WHERE codigo_unico = ?", (code,)).fetchone()
            if not row:
                self.send_json({"ok": False, "error": "Certificado no encontrado"}, 404)
                return
            conn.execute(
                "UPDATE certificates SET archivo_pdf_path = ?, archivo_pdf_url = '', fecha_actualizacion = ? WHERE codigo_unico = ?",
                (str(target.relative_to(ROOT)), utc_now(), code),
            )
            log_action(conn, admin["id"], "pdf_privado_guardado", code, self.client_address[0])
        self.send_json({"ok": True, "archivo": filename, "privado": True})

    def api_list_results(self) -> None:
        if not self.require_admin():
            return
        with db() as conn:
            rows = conn.execute("SELECT * FROM course_results ORDER BY id DESC LIMIT 500").fetchall()
        self.send_json({"ok": True, "resultados": [result_to_admin(row) for row in rows]})

    def api_create_result(self) -> None:
        payload = self.read_json()
        nombre = clean_text(payload.get("nombre"), 180)
        if not nombre:
            raise ValueError("nombre requerido")
        documento = clean_text(payload.get("documento"), 80)
        puntaje = int(payload.get("puntaje") or 0)
        total = int(payload.get("total") or 0)
        porcentaje = int(payload.get("porcentaje") or (round((puntaje / total) * 100) if total else 0))
        estado = "Aprobado" if porcentaje >= 80 else "No aprobado"
        with db() as conn:
            conn.execute(
                """
                INSERT INTO course_results
                (nombre, documento_hash, documento_last4, documento_masked, correo, telefono,
                 curso, puntaje, total, porcentaje, estado, fecha, fecha_creacion)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    nombre,
                    hash_document(documento),
                    document_last4(documento),
                    mask_document(documento),
                    clean_text(payload.get("correo"), 160),
                    clean_text(payload.get("telefono"), 80),
                    clean_text(payload.get("curso") or "Manipulacion de Alimentos", 180),
                    puntaje,
                    total,
                    porcentaje,
                    estado,
                    clean_text(payload.get("fecha") or utc_now(), 80),
                    utc_now(),
                ),
            )
        self.send_json({"ok": True}, 201)

    def serve_static(self, request_path: str) -> None:
        path = urllib.parse.unquote(request_path)
        if path in ("", "/"):
            path = "/index.html"
        elif path == "/favicon.ico":
            path = "/assets/logos/logo-horizontal.png"
        if path == "/admin":
            self.redirect("/admin/")
            return
        if path == "/admin/":
            self.redirect("/admin/dashboard.html" if self.current_admin() else "/admin/login.html")
            return
        if path.startswith("/private/") or "/../" in path:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if path.startswith("/admin/") and path not in ("/admin/index.html", "/admin/login.html"):
            if not self.current_admin():
                self.redirect("/admin/login.html")
                return
        normalized = posixpath.normpath(path.lstrip("/"))
        target = (PUBLIC_DIR / normalized).resolve()
        try:
            target.relative_to(PUBLIC_DIR.resolve())
        except ValueError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if target.is_dir():
            index = target / "index.html"
            if index.exists():
                target = index
            else:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
        if not target.exists() or not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        mime = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        body = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if target.suffix.lower() in {".html", ".json", ".js", ".css"}:
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, location: str) -> None:
        self.send_response(HTTPStatus.FOUND)
        self.send_header("Location", location)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()


def main() -> None:
    validate_runtime_config()
    init_db()
    host = os.environ.get("MS_HOST", "127.0.0.1")
    port = int(os.environ.get("MS_PORT", "8080"))
    server = ThreadingHTTPServer((host, port), MultiserviciosHandler)
    print(f"Multiservicios backend listo en http://{host}:{port}/")
    print(f"Admin: http://{host}:{port}/admin/  usuario: {ADMIN_EMAIL}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido")


if __name__ == "__main__":
    main()
