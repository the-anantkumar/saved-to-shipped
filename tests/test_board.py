import copy
import tempfile
import unittest
from pathlib import Path

from saved_to_shipped import new_item, save_state
from saved_to_shipped import workbench as work


class BoardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "items.json"
        self.items = []
        for index in range(4):
            item = new_item(f"https://linkedin.com/posts/example-{index}", "2026-11-01", content="Build a small local API")
            item.update(title=f"Task {index}", kind="project", status="ready", effort_hours=1,
                        next_action="Implement one endpoint", definition_of_done="An endpoint check passes",
                        note="My personal motivation", enrichment={"status": "partial", "coverage": "post text only"})
            self.items.append(item)
        save_state(self.path, {"version": 1, "items": self.items})

    def move(self, index, status, before=None):
        work.move_item(self.path, {"id": self.items[index]["id"], "status": status,
                                   "before_id": self.items[before]["id"] if before is not None else None})

    def order(self, state, status):
        lane = {item["id"] for item in state["items"] if item["status"] == status}
        return [ident for ident in state["board_order"] if ident in lane]

    def test_cross_lane_move_preserves_context_and_saved_order(self):
        before = copy.deepcopy(self.items[0])
        work.move_item(self.path, {"id": before["url"], "status": "doing"})
        state = work.read(self.path)
        moved = next(item for item in state["items"] if item["id"] == before["id"])
        self.assertEqual("doing", moved["status"])
        for key in ("content", "note", "next_action", "definition_of_done", "enrichment"):
            self.assertEqual(before[key], moved[key])
        self.assertEqual([before["id"]], self.order(state, "doing"))
        # A separate load, like an app restart, retains the explicit order.
        self.assertEqual(state["board_order"], work.read(self.path)["board_order"])

    def test_reorder_within_lane_and_append_to_end(self):
        self.move(3, "ready", before=1)
        self.assertEqual([self.items[index]["id"] for index in (0, 3, 1, 2)], self.order(work.read(self.path), "ready"))
        self.move(0, "ready")
        self.assertEqual([self.items[index]["id"] for index in (3, 1, 2, 0)], self.order(work.read(self.path), "ready"))

    def test_stale_or_invalid_destination_does_not_partially_move(self):
        self.move(1, "done")
        before = self.path.read_bytes()
        for payload in [
            {"id": self.items[0]["id"], "status": "doing", "before_id": self.items[1]["id"]},
            {"id": self.items[0]["id"], "status": "doing", "before_id": "missing"},
            {"id": self.items[0]["id"], "status": "ready", "before_id": self.items[0]["id"]},
            {"id": self.items[0]["id"], "status": "unknown"},
            {"id": self.items[0]["id"], "status": "doing", "before_id": []},
        ]:
            with self.assertRaises(ValueError):
                work.move_item(self.path, payload)
            self.assertEqual(before, self.path.read_bytes())

    def test_incomplete_save_cannot_bypass_review_validation_by_dragging(self):
        state = work.read(self.path)
        state["items"][0].update(kind="untriaged", next_action="", definition_of_done="")
        save_state(self.path, state)
        before = self.path.read_bytes()
        with self.assertRaisesRegex(ValueError, "backlog task"):
            self.move(0, "ready")
        self.assertEqual(before, self.path.read_bytes())

    def test_review_and_notes_updates_are_independent(self):
        ident = self.items[0]["id"]
        work.update_item(self.path, ident, {"next_action": "A revised task", "status": "doing"})
        item = work.read(self.path)["items"][0]
        self.assertEqual(self.items[0]["note"], item["note"])
        self.assertEqual(self.items[0]["content"], item["content"])
        work.update_item(self.path, ident, {"note": "New personal context"})
        item = work.read(self.path)["items"][0]
        self.assertEqual("A revised task", item["next_action"])
        self.assertEqual("doing", item["status"])


if __name__ == "__main__":
    unittest.main()
