#!/usr/bin/env python3
"""Verifica DNS/HTTPS y las rutas criticas de Multiservicios."""

from __future__ import annotations

import argparse
import json
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch(url: str, follow_redirects: bool = True) -> tuple[int, bytes, dict[str, str]]:
    handlers = [urllib.request.HTTPSHandler(context=ssl.create_default_context())]
    if not follow_redirects:
        handlers.append(NoRedirect())
    opener = urllib.request.build_opener(*handlers)
    request = urllib.request.Request(url, headers={"User-Agent": "MultiserviciosProductionCheck/1.0"})
    try:
        with opener.open(request, timeout=15) as response:
            return response.status, response.read(), dict(response.headers)
    except urllib.error.HTTPError as error:
        return error.code, error.read(), dict(error.headers)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True, help="Ej: https://multiservicios.com")
    parser.add_argument("--certificate-code", default="", help="Codigo real opcional para validar")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    parsed = urllib.parse.urlparse(base)
    if parsed.scheme != "https" or not parsed.hostname:
        print("ERROR: --base-url debe usar HTTPS y un dominio valido", file=sys.stderr)
        return 2

    checks = [
        ("inicio", "/", {200}),
        ("cursos", "/cursos.html", {200}),
        ("modulos", "/apps/modulos-examen/index.html", {200}),
        ("validacion", "/validar-certificado.html", {200}),
        ("logo", "/assets/logos/logo-horizontal.png", {200}),
        ("admin protegido", "/admin/", {302}),
    ]
    failures = []
    for name, path, expected in checks:
        status, body, headers = fetch(base + path, follow_redirects=False)
        ok = status in expected and bool(body or status == 302)
        if name == "admin protegido":
            ok = ok and headers.get("Location", "").endswith("/admin/login.html")
        print(f"{'OK' if ok else 'ERROR'} {name}: HTTP {status}")
        if not ok:
            failures.append(name)

    status, body, _ = fetch(base + "/api/health")
    try:
        health = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        health = {}
    health_ok = status == 200 and health.get("ok") is True and health.get("environment") == "production"
    print(f"{'OK' if health_ok else 'ERROR'} backend: HTTP {status}, entorno={health.get('environment')}")
    if not health_ok:
        failures.append("backend")

    if args.certificate_code:
        query = urllib.parse.urlencode({"codigo": args.certificate_code})
        status, body, _ = fetch(base + "/api/certificados/validar?" + query)
        try:
            certificate = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            certificate = {}
        cert_ok = status == 200 and certificate.get("found") is True
        print(f"{'OK' if cert_ok else 'ERROR'} certificado {args.certificate_code}: HTTP {status}")
        if not cert_ok:
            failures.append("certificado")

    if failures:
        print("FALLO: " + ", ".join(failures), file=sys.stderr)
        return 1
    print("Produccion verificada correctamente: " + base)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
