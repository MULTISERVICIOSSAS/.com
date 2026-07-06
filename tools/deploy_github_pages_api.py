#!/usr/bin/env python3
"""Publish selected Multiservicios files to GitHub Pages without git.

Usage from the project root:
  set GITHUB_TOKEN=ghp_xxx
  python tools/deploy_github_pages_api.py
"""

from __future__ import annotations

import base64
import getpass
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OWNER = os.environ.get("GITHUB_OWNER", "MULTISERVICIOSSAS")
REPO = os.environ.get("GITHUB_REPO", ".com")
BRANCH = os.environ.get("GITHUB_BRANCH", "main")

FILES = [
    "admin/dashboard.html",
    "js/dashboard.js",
    "admin/generador-certificados/index.html",
    "sitio-completo/assets/js/app.js",
    "public/admin/dashboard.html",
    "public/js/dashboard.js",
    "public/admin/generador-certificados/index.html",
    "public/sitio-completo/assets/js/app.js",
]


def github_api_url(path: str) -> str:
    encoded_path = "/".join(urllib.parse.quote(part, safe="") for part in path.split("/"))
    owner = urllib.parse.quote(OWNER, safe="")
    repo = urllib.parse.quote(REPO, safe="")
    return f"https://api.github.com/repos/{owner}/{repo}/contents/{encoded_path}"


def request_json(url: str, token: str, method: str = "GET", payload: dict | None = None) -> dict:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=body, method=method)
    request.add_header("Accept", "application/vnd.github+json")
    request.add_header("Authorization", f"Bearer {token}")
    request.add_header("X-GitHub-Api-Version", "2022-11-28")
    if body is not None:
      request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GitHub API {method} {url} failed: {error.code} {detail}") from error


def current_sha(path: str, token: str) -> str | None:
    url = github_api_url(path) + "?ref=" + urllib.parse.quote(BRANCH, safe="")
    try:
        return request_json(url, token).get("sha")
    except RuntimeError as error:
        if "failed: 404" in str(error):
            return None
        raise


def publish_file(path: str, token: str) -> None:
    source = ROOT / path
    if not source.exists():
        raise FileNotFoundError(path)
    content = base64.b64encode(source.read_bytes()).decode("ascii")
    sha = current_sha(path, token)
    payload = {
        "message": f"Actualizar {path}",
        "content": content,
        "branch": BRANCH,
    }
    if sha:
        payload["sha"] = sha
    request_json(github_api_url(path), token, method="PUT", payload=payload)
    print(f"OK {path}")


def main() -> int:
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not token:
        token = getpass.getpass("GitHub token con permiso Contents Read/Write: ").strip()
    if not token:
        print("No se recibio token. No se publico nada.", file=sys.stderr)
        return 2
    for path in FILES:
        publish_file(path, token)
    print("Publicacion terminada. GitHub Pages puede tardar cerca de 1 minuto en actualizar.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
