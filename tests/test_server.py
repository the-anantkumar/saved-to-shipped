import http.client
import io
import json
import tempfile
import threading
import unittest
from pathlib import Path
from zipfile import ZipFile

from saved_to_shipped.server import WorkbenchServer


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.server = WorkbenchServer(("127.0.0.1", 0), Path(cls.temp.name) / "items.json")
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def request(self, method, route, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request(method, route, body=body, headers=headers or {})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_ui_assets_and_private_response_headers(self):
        for route in ["/", "/app.js", "/style.css"]:
            status, headers, body = self.request("GET", route)
            self.assertEqual(200, status)
            self.assertTrue(body)
            self.assertEqual("no-store", headers["Cache-Control"])
            self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertEqual(404, self.request("GET", "/saved_to_shipped.py")[0])

    def test_demo_is_isolated_from_personal_workspace(self):
        personal = json.loads(self.request("GET", "/api/state")[2])
        demo = json.loads(self.request("GET", "/api/state?workspace=demo")[2])
        self.assertEqual([], personal["items"])
        self.assertEqual(12, len(demo["items"]))
        self.assertTrue(demo["demo"])
        self.assertNotIn("OPENAI_API_KEY", json.dumps(personal))

    def test_csrf_and_dns_rebinding_requests_are_blocked(self):
        self.assertEqual(403, self.request("POST", "/api/classify", "{}")[0])
        self.assertEqual(403, self.request("GET", "/api/state", headers={"Host": "evil.example"})[0])

    def test_sample_archive_import_and_reimport_are_idempotent(self):
        sample = self.request("GET", "/api/sample")[2]
        route = "/api/import?workspace=demo&filename=sample.zip"
        headers = {"X-Workbench-Token": self.server.token}
        status, _, body = self.request("POST", route, sample, headers)
        self.assertEqual(200, status)
        self.assertEqual(0, json.loads(body)["added"])
        self.assertEqual(2, json.loads(body)["duplicates"])
        with ZipFile(io.BytesIO(self.request("GET", "/api/export?workspace=demo")[2])) as archive:
            self.assertIn("backlog.csv", archive.namelist())
            self.assertIn("backlog.json", archive.namelist())

    def test_invalid_upload_and_nonfinite_budget_are_handled(self):
        headers = {"X-Workbench-Token": self.server.token}
        for filename, body in [("bad.zip", b"not a zip"), ("bad.exe", b"executable")]:
            self.assertEqual(400, self.request("POST", "/api/import?filename=" + filename, body, headers)[0])
        self.assertEqual(400, self.request("GET", "/api/export?hours=nan")[0])
        self.assertEqual(400, self.request("GET", "/api/state?workspace=unknown")[0])
        self.assertEqual(400, self.request("POST", "/api/triage", b"[]", headers)[0])


if __name__ == "__main__":
    unittest.main()
