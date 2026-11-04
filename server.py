#!/usr/bin/env python3
"""Run the personal, loopback-only Saved to Shipped web workbench."""

from __future__ import annotations

import argparse
import io
import json
import math
import mimetypes
import secrets
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from zipfile import ZIP_DEFLATED, ZipFile

import workbench as work
from demo_data import demo_state
from saved_to_shipped import save_state, triage_prompt, apply_triage

ROOT = Path(__file__).resolve().parent
MAX_UPLOAD = 128 * 1024 * 1024


class WorkbenchServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, state_path: Path):
        super().__init__(address, Handler)
        self.state_path = state_path
        self.demo_path = state_path.parent / "demo" / state_path.name
        self.lock = threading.RLock()
        self.token = secrets.token_urlsafe(32)
        if not self.demo_path.exists():
            state = demo_state()
            work.classify_local(state)
            for index, item in enumerate(state["items"][:8]):
                item["status"] = "done" if index == 0 else "doing" if index == 1 else "ready"
            save_state(self.demo_path, state)


class Handler(BaseHTTPRequestHandler):
    server_version = "SavedToShipped/1.0"

    def log_message(self, format, *args):
        # Avoid printing personal post URLs or request bodies to logs.
        pass

    def send(self, data: bytes, content_type: str, status: int = 200, filename: str = ""):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(data)

    def json(self, data, status=200):
        self.send(json.dumps(data, ensure_ascii=False, allow_nan=False).encode(), "application/json; charset=utf-8", status)

    def route(self):
        parsed = urlsplit(self.path)
        query = parse_qs(parsed.query)
        workspace = query.get("workspace", ["personal"])[0]
        if workspace not in {"personal", "demo"}:
            raise ValueError("Unknown workspace")
        state_path = self.server.demo_path if workspace == "demo" else self.server.state_path
        return parsed.path, query, state_path

    def trusted(self):
        expected = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        if self.headers.get("Host") not in expected:
            self.json({"error": "Use the local URL printed by the server"}, 403)
            return False
        return True

    def do_GET(self):
        if not self.trusted():
            return
        try:
            route, query, state_path = self.route()
            with self.server.lock:
                if route == "/api/state":
                    self.json({**work.snapshot(state_path), "token": self.server.token})
                elif route == "/api/prompt":
                    self.send(triage_prompt(work.read(state_path), 20).encode(), "text/markdown; charset=utf-8", filename="triage_prompt.md")
                elif route == "/api/export":
                    hours = float(query.get("hours", [6])[0])
                    if not math.isfinite(hours) or not 0 < hours <= 168:
                        raise ValueError("Time budget must be between 0 and 168 hours")
                    self.send(work.export_bundle(state_path, hours), "application/zip", filename="saved-to-shipped.zip")
                elif route == "/api/sample":
                    buffer = io.BytesIO()
                    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
                        archive.writestr("Saved_Items.csv", "Date Saved,URL\n2026-11-01,https://www.linkedin.com/feed/update/urn:li:activity:900000000000000001\n2026-11-02,https://www.linkedin.com/feed/update/urn:li:activity:900000000000000002\n")
                        archive.writestr("README.txt", "Synthetic URLs for importer testing only. These do not represent real posts. LinkedIn Saved Items contain dates and URLs, not post bodies.")
                    self.send(buffer.getvalue(), "application/zip", filename="synthetic-linkedin-archive.zip")
                elif route in {"/", "/app.js", "/style.css"}:
                    asset = ROOT / "web" / ("index.html" if route == "/" else route.lstrip("/"))
                    self.send(asset.read_bytes(), (mimetypes.guess_type(asset.name)[0] or "text/plain") + "; charset=utf-8")
                else:
                    self.json({"error": "Not found"}, 404)
        except (ValueError, OSError) as exc:
            self.json({"error": str(exc)}, 400)

    def do_POST(self):
        if not self.trusted():
            return
        if self.headers.get("X-Workbench-Token") != self.server.token:
            self.json({"error": "Reload the workbench and try again"}, 403)
            return
        try:
            route, query, state_path = self.route()
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_UPLOAD:
                self.json({"error": "Upload a file or request smaller than 128 MiB"}, 413)
                return
            if route != "/api/import" and length > 1024 * 1024:
                raise ValueError("Request is too large. Use a smaller triage batch.")
            body = self.rfile.read(length)
            with self.server.lock:
                if route == "/api/import":
                    filename = query.get("filename", [""])[0].replace("\\", "/").rsplit("/", 1)[-1][:200]
                    suffix = Path(filename).suffix.lower()
                    if suffix not in {".zip", ".csv"}:
                        raise ValueError("Choose a LinkedIn ZIP archive or Saved Items CSV")
                    with tempfile.TemporaryDirectory() as folder:
                        source = Path(folder) / ("import" + suffix)
                        source.write_bytes(body)
                        result = work.import_linkedin(source, state_path, filename)
                    self.json(result)
                    return
                payload = json.loads(body)
                if not isinstance(payload, dict):
                    raise ValueError("Request must be a JSON object")
                if route == "/api/capture":
                    self.json({"id": work.capture(state_path, payload)})
                elif route == "/api/item":
                    work.update_item(state_path, work.text(payload.get("id", ""), "ID", 50), payload)
                    self.json({"ok": True})
                elif route == "/api/project":
                    self.json({"id": work.save_project(state_path, payload)})
                elif route == "/api/classify":
                    self.json({"classified": work.suggest(state_path)})
                elif route == "/api/triage":
                    with tempfile.TemporaryDirectory() as folder:
                        file = Path(folder) / "triage.json"
                        file.write_text(json.dumps(payload), encoding="utf-8")
                        count = apply_triage(file, state_path)
                    self.json({"classified": count})
                else:
                    self.json({"error": "Not found"}, 404)
        except (ValueError, OSError, TypeError, KeyError) as exc:
            self.json({"error": str(exc)}, 400)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8010)
    parser.add_argument("--state", type=Path, default=ROOT / "data" / "items.json")
    args = parser.parse_args()
    server = WorkbenchServer(("127.0.0.1", args.port), args.state.resolve())
    print(f"Saved to Shipped: http://127.0.0.1:{server.server_port}/", flush=True)
    print(f"Try the isolated demo: http://127.0.0.1:{server.server_port}/?workspace=demo", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
