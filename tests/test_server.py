import http.client
import json
import tempfile
import threading
import unittest
import urllib.parse
from pathlib import Path

import server


class MultiserviciosServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        server.STORAGE_DIR = Path(cls.temp_dir.name)
        server.PDF_DIR = server.STORAGE_DIR / "pdfs"
        server.DB_PATH = server.STORAGE_DIR / "db" / "test.sqlite3"
        server.ADMIN_EMAIL = "admin@example.com"
        server.ADMIN_PASSWORD = "Test-password-2026"
        server.init_db()
        cls.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.MultiserviciosHandler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)
        cls.temp_dir.cleanup()

    def request(self, method, path, payload=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        body = json.dumps(payload).encode() if payload is not None else None
        request_headers = dict(headers or {})
        if body is not None:
            request_headers["Content-Type"] = "application/json"
        connection.request(method, path, body=body, headers=request_headers)
        response = connection.getresponse()
        data = json.loads(response.read().decode())
        response_headers = dict(response.getheaders())
        connection.close()
        return response.status, data, response_headers

    def login(self):
        status, data, headers = self.request("POST", "/api/auth/login", {"clave": server.ADMIN_PASSWORD})
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])
        return headers["Set-Cookie"].split(";", 1)[0]

    def test_health_and_public_certificate_validation(self):
        status, data, _ = self.request("GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(data["service"], "multiservicios")

        with server.db() as conn:
            code = conn.execute("SELECT codigo_unico FROM certificates ORDER BY id LIMIT 1").fetchone()[0]
        status, data, _ = self.request("GET", "/api/certificados/validar?codigo=" + code)
        self.assertEqual(status, 200)
        self.assertTrue(data["found"])

    def test_admin_requires_authentication(self):
        status, _, _ = self.request("GET", "/api/admin/stats")
        self.assertEqual(status, 401)

    def test_login_cookie_and_authenticated_admin(self):
        cookie = self.login()
        status, data, headers = self.request("GET", "/api/admin/stats", headers={"Cookie": cookie})
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])
        self.assertEqual(headers["X-Frame-Options"], "DENY")

    def test_admin_mutation_rejects_cross_site_origin(self):
        cookie = self.login()
        status, data, _ = self.request(
            "POST",
            "/api/admin/clientes",
            {"nombre": "Prueba"},
            {"Cookie": cookie, "Origin": "https://attacker.example"},
        )
        self.assertEqual(status, 403)
        self.assertIn("Origen", data["error"])

    def test_login_rate_limit(self):
        server.clear_failed_logins("127.0.0.1")
        for _ in range(server.LOGIN_MAX_ATTEMPTS):
            status, _, _ = self.request("POST", "/api/auth/login", {"clave": "incorrecta"})
            self.assertEqual(status, 401)
        status, _, headers = self.request("POST", "/api/auth/login", {"clave": server.ADMIN_PASSWORD})
        self.assertEqual(status, 429)
        self.assertIn("Retry-After", headers)
        server.clear_failed_logins("127.0.0.1")


class SecurityUnitTests(unittest.TestCase):
    def test_password_hash_round_trip(self):
        salt, digest = server.password_hash("Clave-segura-2026")
        self.assertTrue(server.verify_password("Clave-segura-2026", salt, digest))
        self.assertFalse(server.verify_password("otra", salt, digest))

    def test_document_is_masked(self):
        self.assertEqual(server.mask_document("1.234.567.890"), "****7890")
        self.assertNotIn("1234567890", server.hash_document("1.234.567.890"))

    def test_certificate_urls_use_public_domain(self):
        previous = server.PUBLIC_URL
        try:
            server.PUBLIC_URL = "https://multiservicios.example"
            validation_url, qr_url = server.certificate_public_urls("MS-PRUEBA-1")
        finally:
            server.PUBLIC_URL = previous
        self.assertEqual(validation_url, "https://multiservicios.example/validar-certificado.html?codigo=MS-PRUEBA-1")
        self.assertIn(urllib.parse.quote(validation_url, safe=""), qr_url)


if __name__ == "__main__":
    unittest.main()
