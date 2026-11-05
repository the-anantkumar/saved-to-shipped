"""Run with the installed environment's Python, outside the checkout's imports."""

import http.client
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

with tempfile.TemporaryDirectory() as folder:
    process = subprocess.Popen(
        [sys.executable, "-I", "-m", "saved_to_shipped", "--port", "0", "--state", str(Path(folder) / "items.json")],
        cwd=folder, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    try:
        banner = process.stdout.readline()
        match = re.search(r"127\.0\.0\.1:(\d+)", banner)
        if not match:
            raise AssertionError("Installed app did not start: " + process.stderr.read())
        connection = http.client.HTTPConnection("127.0.0.1", int(match.group(1)), timeout=5)
        for route in ("/", "/app.js", "/style.css", "/api/state"):
            connection.request("GET", route)
            response = connection.getresponse()
            body = response.read()
            assert response.status == 200 and body, (route, response.status)
            if route == "/api/state":
                assert json.loads(body)["items"] == []
        connection.close()
        print("Installed package starts outside the checkout and serves all web assets.")
    finally:
        process.terminate()
        process.communicate(timeout=5)
