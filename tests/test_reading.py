import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from saved_to_shipped import new_item, save_state
from saved_to_shipped import workbench as work


class ReadingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "items.json"
        self.item = new_item("https://linkedin.com/posts/reading-example", "2026-11-01",
                             title="How indexes work", content="An index trades storage and writes for faster reads.")
        self.item.update(kind="learning", note="Try this in my local database", enrichment={"status": "partial"})
        save_state(self.path, {"version": 1, "items": [self.item]})

    def update(self, **patch):
        return work.update_reading(self.path, {"id": self.item["id"], **patch})

    def test_reading_without_task_fields_preserves_the_save(self):
        before = copy.deepcopy(self.item)
        self.update(queued=True)
        self.update(status="reading")
        self.update(progress=42.4)
        result = self.update(status="read")
        self.assertEqual("read", result["status"])
        self.assertEqual(100, result["progress"])
        self.assertFalse(result["queued"])
        self.assertIn("started_at", result)
        self.assertIn("completed_at", result)
        self.assertFalse(self.update(queued=True)["queued"])
        saved = work.read(self.path)["items"][0]
        self.assertEqual(before, {key: value for key, value in saved.items() if key != "reading"})
        self.assertEqual(result["status"], saved["reading"]["status"])

    def test_stale_progress_cannot_rewind_but_marking_unread_can(self):
        self.update(status="reading", progress=75)
        self.assertEqual(75, self.update(progress=20)["progress"])
        self.update(status="read")
        self.assertEqual(100, self.update(progress=30)["progress"])
        reset = self.update(status="unread")
        self.assertEqual(0, reset["progress"])
        self.assertNotIn("completed_at", reset)
        self.assertNotIn("started_at", reset)

    def test_scroll_progress_never_implicitly_marks_read(self):
        self.update(status="reading")
        result = self.update(progress=100)
        self.assertEqual("reading", result["status"])
        self.assertNotIn("completed_at", result)

    def test_legacy_progress_is_derived_without_mutating_the_file(self):
        for status, expected in [("ready", "unread"), ("doing", "reading"), ("done", "read")]:
            item = {**self.item, "status": status}
            save_state(self.path, {"version": 1, "items": [item]})
            before = self.path.read_bytes()
            self.assertEqual(expected, work.snapshot(self.path)["items"][0]["reading"]["status"])
            self.assertEqual(before, self.path.read_bytes())
            self.update(queued=False)
            self.assertEqual(status, work.read(self.path)["items"][0]["status"])

    def test_invalid_updates_are_atomic(self):
        before = self.path.read_bytes()
        for patch in [{}, {"status": "done"}, {"status": []}, {"progress": True}, {"progress": float("nan")},
                      {"progress": float("inf")}, {"progress": -1}, {"progress": 101}, {"progress": "50"},
                      {"queued": 1}, {"status": "read", "queued": "yes"}]:
            with self.subTest(patch=patch):
                with self.assertRaises(ValueError):
                    self.update(**patch)
                self.assertEqual(before, self.path.read_bytes())

    def test_only_readable_learning_reference_and_experience_support_reading(self):
        for kind, content in [("project", "Build this"), ("untriaged", "An idea"), ("learning", "")]:
            item = {**self.item, "kind": kind, "content": content, "note": ""}
            save_state(self.path, {"version": 1, "items": [item]})
            before = self.path.read_bytes()
            with self.assertRaises(ValueError):
                self.update(status="reading")
            self.assertEqual(before, self.path.read_bytes())
        for kind in ["reference", "experience"]:
            save_state(self.path, {"version": 1, "items": [{**self.item, "kind": kind}]})
            self.assertEqual("reading", self.update(status="reading")["status"])

    def test_workspace_backup_contains_reading_progress(self):
        self.update(status="reading", progress=63, queued=True)
        with ZipFile(io.BytesIO(work.export_bundle(self.path))) as archive:
            item = json.loads(archive.read("backlog.json"))["items"][0]
        self.assertEqual(63, item["reading"]["progress"])
        self.assertTrue(item["reading"]["queued"])


if __name__ == "__main__":
    unittest.main()
