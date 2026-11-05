import http.client
import io
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from saved_to_shipped.server import WorkbenchServer


class HostedPipelineTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.temp = tempfile.TemporaryDirectory()
        self.server = WorkbenchServer(("127.0.0.1", 0), Path(self.temp.name) / "items.json")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()
        self.env.stop()

    def request(self, route, payload=None, *, raw=False):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode() if payload is not None else None
        connection.request("GET" if payload is None else "POST", route, body=body,
                           headers={"X-Workbench-Token": self.server.token})
        response = connection.getresponse()
        status, data = response.status, response.read()
        connection.close()
        return status, data if raw else json.loads(data)

    def test_setup_import_retrieve_classify_review_export(self):
        status, _ = self.request("/api/settings", {"apify_token": "private-fixture-token", "goals": "Build personal developer tools"})
        self.assertEqual(200, status)
        self.assertEqual(200, self.request("/onboarding.js", raw=True)[0])
        csv = b"savedItem,CreatedTime\nhttps://www.linkedin.com/feed/update/urn:li:activity:123,2026-11-01 12:00:00\n"
        status, imported = self.request("/api/import?filename=Saved_Items_123456.csv", csv)
        self.assertEqual(200, status)
        self.assertEqual(1, imported["added"])
        run = {"id": "fixture-run", "status": "RUNNING", "defaultDatasetId": "fixture-dataset"}
        responses = [io.BytesIO(json.dumps({"data": run}).encode()),
                     io.BytesIO(json.dumps({"data": {**run, "status": "SUCCEEDED"}}).encode()),
                     io.BytesIO(json.dumps([{"url": "https://www.linkedin.com/feed/update/urn:li:activity:123", "text": "Build a small Python quote API backed by SQLite.", "_status": "ok", "author": {"name": "Synthetic author"}}]).encode())]
        with patch("saved_to_shipped.enrichment.urlopen", side_effect=responses) as provider:
            self.assertEqual(200, self.request("/api/retrieve/start", {"limit": 10, "max_charge": 0.5})[0])
            status, result = self.request("/api/retrieve/poll", {})
            self.assertEqual(200, status)
            self.assertEqual(1, result["counts"]["extracted"])
            self.assertEqual(3, provider.call_count)
            self.assertEqual(400, self.request("/api/retrieve/start", {})[0])
            self.assertEqual(3, provider.call_count)
        status, snapshot = self.request("/api/state")
        self.assertTrue(snapshot["settings"]["extractor_available"])
        self.assertNotIn("private-fixture-token", json.dumps(snapshot))
        item = snapshot["items"][0]
        self.assertTrue(item["has_context"])
        self.assertEqual("2026-11-01 12:00:00", item["saved_at"])
        self.assertEqual(1, self.request("/api/classify", {})[1]["classified"])
        self.assertEqual(200, self.request("/api/item", {"id": item["id"], "status": "ready"})[0])
        _, bundle = self.request("/api/export", raw=True)
        with ZipFile(io.BytesIO(bundle)) as archive:
            state = json.loads(archive.read("backlog.json"))
            self.assertEqual("ready", state["items"][0]["status"])
            self.assertEqual("Build personal developer tools", state["goals"])
            self.assertTrue(any(name.startswith("issues/") for name in archive.namelist()))
            self.assertNotIn("settings.json", archive.namelist())
            self.assertNotIn("private-fixture-token", archive.read("backlog.json").decode())

    def test_demo_cannot_change_real_keys_or_start_paid_runs(self):
        with patch("saved_to_shipped.enrichment.urlopen") as provider:
            self.assertEqual(400, self.request("/api/settings?workspace=demo", {"apify_token": "fixture"})[0])
            self.assertEqual(400, self.request("/api/retrieve/start?workspace=demo", {})[0])
            provider.assert_not_called()
