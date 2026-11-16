import http.client
import io
import json
import os
import tempfile
import threading
import unittest
from unittest.mock import patch
from pathlib import Path
from zipfile import ZipFile

from saved_to_shipped.server import WorkbenchServer
from saved_to_shipped import new_item, save_state
from saved_to_shipped import enrichment


class ServerStartupTests(unittest.TestCase):
    def test_numeric_loopback_startup_does_not_depend_on_reverse_dns(self):
        with tempfile.TemporaryDirectory() as folder, patch("socket.getfqdn", side_effect=AssertionError("Unexpected reverse DNS")):
            server = WorkbenchServer(("127.0.0.1", 0), Path(folder) / "items.json")
            try:
                self.assertEqual("127.0.0.1", server.server_name)
                self.assertGreater(server.server_port, 0)
                self.assertEqual(server.socket.getsockname()[1], server.server_port)
            finally:
                server.server_close()


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
        for route in ["/", "/app.js", "/onboarding.js", "/theme.js", "/reading.js", "/style.css"]:
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

    def test_reading_endpoint_requires_token_and_keeps_task_status(self):
        demo = json.loads(self.request("GET", "/api/state?workspace=demo")[2])
        item = next(item for item in demo["items"] if item["kind"] == "learning")
        payload = json.dumps({"id": item["id"], "status": "read"})
        route = "/api/reading?workspace=demo"
        self.assertEqual(403, self.request("POST", route, payload)[0])
        headers = {"X-Workbench-Token": self.server.token, "Content-Type": "application/json"}
        status, _, body = self.request("POST", route, payload, headers)
        self.assertEqual(200, status)
        self.assertEqual("read", json.loads(body)["reading"]["status"])
        after = json.loads(self.request("GET", "/api/state?workspace=demo")[2])
        self.assertEqual(item["status"], next(saved for saved in after["items"] if saved["id"] == item["id"])["status"])
        project = next(item for item in demo["items"] if item["kind"] == "project")
        self.assertEqual(400, self.request("POST", route, json.dumps({"id": project["id"], "status": "read"}), headers)[0])

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


class RetrievalSelectionHTTPTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "items.json"
        self.server = WorkbenchServer(("127.0.0.1", 0), self.path)
        self.server.settings.update({"apify_token": "synthetic-http-token"})
        self.items = [new_item(f"https://www.linkedin.com/posts/synthetic-selection-{n}", "2026-11-01") for n in range(2)]
        save_state(self.path, {"version": 1, "items": self.items})
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close_server)
        self.run = {"id": "synthetic-selection-run", "status": "RUNNING", "defaultDatasetId": "synthetic-selection-dataset"}

    def close_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def start(self, payload):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request("POST", "/api/retrieve/start", json.dumps(payload), {
            "X-Workbench-Token": self.server.token, "Content-Type": "application/json",
        })
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result

    def test_nonfirst_approved_save_is_the_only_url_submitted(self):
        chosen = self.items[1]
        with patch.object(enrichment.Apify, "start", return_value=self.run) as submit:
            status, job = self.start({"ids": [chosen["id"]], "limit": 1, "max_charge": 0.25})
        self.assertEqual(200, status)
        self.assertEqual(([chosen["url"]], 0.25), submit.call_args.args)
        self.assertEqual([chosen["id"]], job["item_ids"])
        self.assertNotIn(self.items[0]["id"], job["item_ids"])

    def test_http_selection_order_is_retained_in_provider_and_intent(self):
        chosen = list(reversed(self.items))
        with patch.object(enrichment.Apify, "start", return_value=self.run) as submit:
            status, job = self.start({"ids": [item["id"] for item in chosen], "limit": 2})
        self.assertEqual(200, status)
        self.assertEqual([item["url"] for item in chosen], submit.call_args.args[0])
        self.assertEqual([item["id"] for item in chosen], job["item_ids"])

    def test_invalid_http_selection_never_submits_or_persists_a_run(self):
        self.items[1]["content"] = "Synthetic source already supplied"
        save_state(self.path, {"version": 1, "items": self.items})
        before = self.path.read_bytes()
        ident = self.items[0]["id"]
        invalid = [None, [], {}, "not-a-list", [ident, ident], ["missing-selection"],
                   [ident, "missing-selection"], [""], ["x" * 51], [False], [[]], [self.items[1]["id"]]]
        with patch.object(enrichment.Apify, "start") as submit:
            for ids in invalid:
                with self.subTest(ids=ids):
                    self.assertEqual(400, self.start({"ids": ids, "limit": 2})[0])
                    self.assertEqual(before, self.path.read_bytes())
            submit.assert_not_called()


if __name__ == "__main__":
    unittest.main()
