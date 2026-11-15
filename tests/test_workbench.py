import io
import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from saved_to_shipped import workbench as work
from saved_to_shipped.demo_data import demo_state
from saved_to_shipped import save_state


class WorkbenchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "items.json"

    def capture(self, content="Build a small Python API with SQLite"):
        return work.capture(self.path, {"url": "https://www.linkedin.com/posts/example", "content": content})

    def test_capture_to_classification_to_backlog_to_export(self):
        ident = self.capture()
        self.assertEqual(1, work.suggest(self.path))
        item = work.read(self.path)["items"][0]
        self.assertEqual("project", item["kind"])
        self.assertEqual("inbox", item["status"])
        self.assertEqual("local rules", item["classification_method"])
        self.assertTrue(item["project_id"])
        work.update_item(self.path, ident, {"status": "ready"})
        work.update_item(self.path, ident, {"status": "doing"})
        with ZipFile(io.BytesIO(work.export_bundle(self.path))) as archive:
            self.assertIn("weekly_sprint.md", archive.namelist())
            self.assertTrue(any(n.startswith("issues/") for n in archive.namelist()))
            self.assertIn("small Python", archive.read("weekly_sprint.md").decode())
            self.assertIn("Personal tools", archive.read("backlog.csv").decode())
        work.update_item(self.path, ident, {"status": "done", "outcome_url": "https://github.com/example/repo/pull/1"})
        self.assertEqual("done", work.read(self.path)["items"][0]["status"])

    def test_no_classification_from_url_or_title_alone(self):
        ident = self.capture("")
        work.update_item(self.path, ident, {"title": "Build an AI agent"})
        self.assertEqual(0, work.suggest(self.path))
        with self.assertRaisesRegex(ValueError, "post text"):
            work.update_item(self.path, ident, {"kind": "project"})

    def test_weekly_preference_persists_without_changing_goals_and_exports_in_v1_backup(self):
        self.capture()
        state = work.read(self.path)
        state["goals"] = "Learn with one experiment"
        save_state(self.path, state)
        work.save_preferences(self.path, {"weekly_hours": 2.5})
        self.assertEqual(2.5, work.snapshot(self.path)["weekly_hours"])
        self.assertEqual("Learn with one experiment", work.read(self.path)["goals"])
        with ZipFile(io.BytesIO(work.export_bundle(self.path))) as archive:
            self.assertEqual(2.5, json.loads(archive.read("backlog.json"))["weekly_hours"])
        for value in [None, True, 0, 169, float("nan"), "2"]:
            with self.assertRaises(ValueError):
                work.save_preferences(self.path, {"weekly_hours": value})
        self.assertEqual(2.5, work.read(self.path)["weekly_hours"])

    def test_empty_sections_keep_their_space_and_inline_learning_infers_it(self):
        for kind in ["project", "learning", "experience"]:
            ident = work.save_project(self.path, {"name": "Empty " + kind, "kind": kind})
            self.assertEqual(kind, next(group for group in work.read(self.path)["projects"] if group["id"] == ident)["kind"])
        ident = self.capture("A useful lesson on SQL indexes")
        work.update_item(self.path, ident, {"kind": "reference", "new_project_name": "Index learning"})
        self.assertEqual("learning", next(group for group in work.read(self.path)["projects"] if group["name"] == "Index learning")["kind"])
        with self.assertRaises(ValueError):
            work.save_project(self.path, {"name": "Invalid", "kind": "unknown"})

    def test_incomplete_task_cannot_enter_backlog(self):
        ident = self.capture()
        with self.assertRaisesRegex(ValueError, "backlog task"):
            work.update_item(self.path, ident, {"status": "ready"})
        self.assertEqual("inbox", work.read(self.path)["items"][0]["status"])

    def test_invalid_estimate_rolls_back_entire_update(self):
        ident = self.capture()
        for value in [True, float("nan"), float("inf"), -1, 10, "one"]:
            with self.assertRaises(ValueError):
                work.update_item(self.path, ident, {"title": "Should not persist", "effort_hours": value})
        self.assertEqual("", work.read(self.path)["items"][0]["title"])

    def test_classification_is_repeatable_and_preserves_edits(self):
        self.capture()
        work.suggest(self.path)
        state = work.read(self.path)
        state["items"][0]["next_action"] = "My edited task"
        save_state(self.path, state)
        self.assertEqual(0, work.suggest(self.path))
        self.assertEqual("My edited task", work.read(self.path)["items"][0]["next_action"])
        self.assertEqual(1, len(work.read(self.path)["projects"]))

    def test_project_assignment_and_rename(self):
        ident = self.capture()
        project = work.save_project(self.path, {"name": "My project"})
        work.update_item(self.path, ident, {"project_id": project})
        work.save_project(self.path, {"id": project, "name": "New name", "description": "A useful outcome"})
        self.assertEqual("New name", work.read(self.path)["projects"][0]["name"])
        with self.assertRaisesRegex(ValueError, "existing project"):
            work.update_item(self.path, ident, {"project_id": "missing"})

    def test_inline_section_creation_assigns_and_reuses_names(self):
        ident = self.capture("Learn how database indexes work")
        work.update_item(self.path, ident, {"kind": "learning", "title": "Indexes", "note": "Try this later"})
        work.update_reading(self.path, {"id": ident, "status": "reading", "progress": 42})
        before = work.read(self.path)["items"][0]
        work.update_item(self.path, ident, {"title": "Indexes in practice", "new_project_name": "  Database notes  "})
        state = work.read(self.path)
        self.assertEqual(1, len(state["projects"]))
        self.assertEqual("Database notes", state["projects"][0]["name"])
        item = state["items"][0]
        self.assertEqual(state["projects"][0]["id"], item["project_id"])
        self.assertEqual("Indexes in practice", item["title"])
        for key in ("content", "note", "status", "kind", "reading"):
            self.assertEqual(before[key], item[key])
        work.update_item(self.path, ident, {"new_project_name": "DATABASE NOTES"})
        self.assertEqual(1, len(work.read(self.path)["projects"]))

    def test_inline_project_creation_can_approve_a_task_in_one_save(self):
        ident = self.capture()
        work.suggest(self.path)
        work.update_item(self.path, ident, {"new_project_name": "My next build", "status": "ready"})
        state = work.read(self.path)
        item = state["items"][0]
        self.assertEqual("ready", item["status"])
        self.assertEqual("My next build", next(p for p in state["projects"] if p["id"] == item["project_id"])["name"])

    def test_invalid_inline_creation_never_saves_a_partial_item_or_orphan_group(self):
        ident = self.capture()
        before = self.path.read_bytes()
        for patch in [{"new_project_name": name} for name in ("", "   ", "x" * 101, None, [])] + [
            {"new_project_name": "New section", "project_id": ""},
            {"new_project_name": "New section", "status": "ready"},
            {"new_project_name": "New section", "effort_hours": 10},
        ]:
            with self.subTest(patch=patch):
                with self.assertRaises(ValueError):
                    work.update_item(self.path, ident, {"title": "Unsaved edit", **patch})
                self.assertEqual(before, self.path.read_bytes())

    def test_capture_rejects_duplicates_and_foreign_hosts(self):
        self.capture()
        with self.assertRaisesRegex(ValueError, "already"):
            self.capture()
        with self.assertRaisesRegex(ValueError, "LinkedIn"):
            work.capture(self.path, {"url": "https://linkedin.com.example.org/posts/a"})

    def test_demo_has_no_context_fabrication_and_classifies_only_ten(self):
        state = demo_state()
        self.assertEqual(10, work.classify_local(state))
        self.assertEqual(2, sum(i["kind"] == "untriaged" for i in state["items"]))
        self.assertTrue(all(i["metadata"]["synthetic"] for i in state["items"]))

    def test_csv_export_neutralizes_formula_titles(self):
        ident = self.capture()
        work.update_item(self.path, ident, {"title": "=HYPERLINK(1)"})
        with ZipFile(io.BytesIO(work.export_bundle(self.path))) as archive:
            self.assertIn("'=HYPERLINK(1)", archive.read("backlog.csv").decode())


if __name__ == "__main__":
    unittest.main()
