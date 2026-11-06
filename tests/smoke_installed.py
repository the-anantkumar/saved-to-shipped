"""Check installed commands, assets, local organizing, exports, and restart persistence."""

from contextlib import contextmanager
from importlib.metadata import version
import http.client
import io
import json
import os
from pathlib import Path
from queue import Empty, Queue
import re
import subprocess
import sys
import sysconfig
import tempfile
import threading
from zipfile import ZipFile


def isolated_environment():
    # A release check must not inherit provider keys or the user's data directory.
    return {key: value for key, value in os.environ.items()
            if not key.startswith(("APIFY_", "OPENAI_", "SAVED_TO_SHIPPED_"))}


@contextmanager
def installed_server(folder):
    process = subprocess.Popen(
        [sys.executable, "-I", "-m", "saved_to_shipped", "--no-browser", "--port", "0", "--state", str(Path(folder) / "items.json")],
        cwd=folder, env=isolated_environment(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    lines = Queue()
    threading.Thread(target=lambda: lines.put(process.stdout.readline()), daemon=True).start()
    try:
        try:
            banner = lines.get(timeout=15)
        except Empty as exc:
            raise AssertionError("Installed app did not print its local URL within 15 seconds") from exc
        match = re.search(r"127\.0\.0\.1:(\d+)", banner)
        if not match:
            raise AssertionError("Installed app did not start successfully")
        port = int(match.group(1))

        def request(route, payload=None, token=None):
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
            headers = {"Content-Type": "application/json", "X-Workbench-Token": token or ""}
            try:
                connection.request("GET" if payload is None else "POST", route,
                                   body=None if payload is None else json.dumps(payload), headers=headers)
                response = connection.getresponse()
                body = response.read()
                assert response.status == 200, (route, response.status, body[:300])
                return json.loads(body) if "application/json" in response.getheader("Content-Type", "") else body
            finally:
                connection.close()

        yield request
    finally:
        if process.poll() is None:
            process.terminate()
        try:
            process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate(timeout=5)


def main():
    with tempfile.TemporaryDirectory(prefix="save2ship-smoke-") as folder:
        command = Path(sysconfig.get_path("scripts")) / ("saved-to-shipped.exe" if sys.platform == "win32" else "saved-to-shipped")
        result = subprocess.run([str(command), "--version"], cwd=folder, env=isolated_environment(),
                                check=True, capture_output=True, text=True, timeout=15)
        assert result.stdout.strip() == "Saved to Shipped " + version("saved-to-shipped")
        doctor = subprocess.run([str(command), "--doctor", "--state", str(Path(folder) / "items.json")],
                                cwd=folder, env=isolated_environment(), check=True, capture_output=True, text=True, timeout=15)
        health = json.loads(doctor.stdout)
        assert not health["extractor_available"] and not health["ai_available"]
        with installed_server(folder) as request:
            for route in ("/", "/app.js", "/onboarding.js", "/theme.js", "/reading.js", "/style.css"):
                assert request(route), route
            state = request("/api/state")
            assert state["items"] == []
            token = state["token"]
            build = request("/api/capture", {"url": "https://linkedin.com/posts/synthetic-release-build",
                            "content": "Build a small local Python API backed by SQLite."}, token)["id"]
            learn = request("/api/capture", {"url": "https://linkedin.com/posts/synthetic-release-learning",
                            "content": "Learn how a database index changes query execution."}, token)["id"]
            assert request("/api/classify", {}, token)["classified"] == 2
            request("/api/item", {"id": build, "new_project_name": "Release practice", "status": "ready"}, token)
            request("/api/move", {"id": build, "status": "doing"}, token)
            request("/api/item", {"id": learn, "new_project_name": "Database reading", "note": "A synthetic takeaway"}, token)
            request("/api/reading", {"id": learn, "status": "reading", "progress": 42, "queued": True}, token)
            with ZipFile(io.BytesIO(request("/api/export"))) as archive:
                backup = json.loads(archive.read("backlog.json"))
                assert {"backlog.json", "backlog.csv", "weekly_sprint.md"} <= set(archive.namelist())
                assert "settings.json" not in archive.namelist()
                saved = next(item for item in backup["items"] if item["id"] == learn)
                assert saved["reading"]["progress"] == 42 and saved["reading"]["queued"]
                assert saved["status"] == "inbox" and saved["note"] == "A synthetic takeaway"
        with installed_server(folder) as request:
            state = request("/api/state")
            assert len(state["items"]) == 2
            assert next(item for item in state["items"] if item["id"] == build)["status"] == "doing"
            assert next(item for item in state["items"] if item["id"] == learn)["reading"]["progress"] == 42
        print("Installed commands, assets, organizing, reading, exports, and restart persistence pass without providers.")


if __name__ == "__main__":
    main()
