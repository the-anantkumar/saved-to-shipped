import csv
import io
import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from saved_to_shipped import (
    apply_triage,
    canonical_url,
    create_plan,
    export_issues,
    import_items,
    item_id,
    load_state,
    new_item,
    parse_saved_items,
    save_state,
    triage_prompt,
)


class SavedToShippedTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / "data" / "items.json"
        self.url = "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/"

    def _csv_bytes(self):
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Date Saved", "URL"])
        writer.writerow(["2026-11-01", self.url + "?utm_source=test"])
        writer.writerow(["2026-11-02", self.url])
        return output.getvalue().encode("utf-8-sig")

    def test_csv_and_zip_ingest_are_idempotent(self):
        csv_file = self.root / "Saved_Items.csv"
        csv_file.write_bytes(self._csv_bytes())
        with ZipFile(self.root / "LinkedInExport.zip", "w") as archive:
            archive.writestr("Basic_LinkedInDataExport/Saved_Items.csv", self._csv_bytes())
        self.assertEqual(2, len(parse_saved_items(csv_file)))
        self.assertEqual((2, 1, 1), import_items(csv_file, self.state))
        self.assertEqual((2, 0, 1), import_items(self.root / "LinkedInExport.zip", self.state))
        state = load_state(self.state)
        self.assertEqual(self.url.rstrip("/"), state["items"][0]["url"])
        self.assertEqual("2026-11-01", state["items"][0]["saved_at"])

    def test_import_does_not_erase_annotations(self):
        csv_file = self.root / "Saved_Items.csv"
        csv_file.write_bytes(self._csv_bytes())
        import_items(csv_file, self.state)
        state = load_state(self.state)
        state["items"][0]["note"] = "Build this for WhatsApp quotes"
        save_state(self.state, state)
        import_items(csv_file, self.state)
        self.assertEqual("Build this for WhatsApp quotes", load_state(self.state)["items"][0]["note"])

    def test_unsubstantiated_triage_is_rejected(self):
        item = new_item(self.url, "2026-11-01")
        save_state(self.state, {"version": 1, "items": [item]})
        response = self.root / "triage.json"
        response.write_text(json.dumps({"items": [{"id": item["id"], "kind": "project", "title": "Speculative"}]}))
        with self.assertRaisesRegex(ValueError, "No supplied post text"):
            apply_triage(response, self.state)

    def test_triage_to_sprint_and_issue(self):
        item = new_item(self.url, "2026-11-01")
        item["note"] = "A 90-minute project: make a small quote-tracking API"
        save_state(self.state, {"version": 1, "items": [item]})
        response = self.root / "triage.json"
        response.write_text(json.dumps({"items": [{
            "id": item["id"], "kind": "project", "title": "Quote tracker",
            "why": "Learn small service patterns", "impact": 4, "relevance": 5,
            "novelty": 3, "effort_hours": 1.5,
            "next_action": "Write a POST /quotes handler and a test",
            "definition_of_done": "Handler and test both pass",
            "repo_suggestion": "whatsapp-api-scripts",
            "commit_message": "feat: add quote capture endpoint",
            "confidence": "high", "tags": ["api", "whatsapp"],
        }]}), encoding="utf-8")
        self.assertEqual(1, apply_triage(response, self.state))
        state = load_state(self.state)
        self.assertEqual("ready", state["items"][0]["status"])
        sprint = create_plan(state, 2)
        self.assertIn("Quote tracker", sprint)
        self.assertIn("feat: add quote capture endpoint", sprint)
        issue_dir = self.root / "issues"
        self.assertEqual(1, export_issues(state, issue_dir))
        self.assertIn("POST /quotes", next(issue_dir.iterdir()).read_text())

    def test_tracking_parameters_are_stripped(self):
        self.assertEqual(canonical_url(self.url), canonical_url(self.url + "?trk=foo&utm_source=bar"))
        self.assertEqual(item_id(self.url), item_id(self.url + "?utm_campaign=hello"))

    def test_reddit_json_listing_import(self):
        reddit_listing = {
            "kind": "Listing", "data": {"children": [
                {"kind": "t3", "data": {
                    "name": "t3_abc", "permalink": "/r/learnpython/comments/abc/test/",
                    "title": "How to build a CLI", "selftext": "Build a small parser",
                    "created_utc": 1700000000, "subreddit": "learnpython", "author": "someone"
                }},
                {"kind": "t1", "data": {
                    "name": "t1_def", "permalink": "/r/learnpython/comments/abc/test/def/",
                    "body": "Tests make parsing safer", "author": "other"
                }},
            ]}
        }
        file = self.root / "reddit.json"
        file.write_text(json.dumps(reddit_listing), encoding="utf-8")
        self.assertEqual((2, 2, 2), import_items(file, self.state, adapter="reddit"))
        items = load_state(self.state)["items"]
        self.assertTrue(all(item["platform"] == "reddit" for item in items))
        self.assertEqual("", items[0]["saved_at"])  # Published date is NOT saved date.
        self.assertEqual(1700000000, items[0]["metadata"]["published_utc"])
        self.assertEqual("Build a small parser", items[0]["content"])
        self.assertIn("Platform: reddit", triage_prompt(load_state(self.state), 20))

    def test_instagram_manifest_import_without_scraping(self):
        file = self.root / "instagram.csv"
        file.write_text(
            "url,saved_at,title,content,author\n"
            "https://www.instagram.com/p/ABC123/,2026-11-01,A saved tutorial,An idea about designing tools,creator\n",
            encoding="utf-8",
        )
        self.assertEqual((1, 1, 1), import_items(file, self.state, adapter="instagram"))
        self.assertEqual((1, 0, 1), import_items(file, self.state, adapter="instagram"))
        saved = load_state(self.state)["items"][0]
        self.assertEqual("instagram", saved["platform"])
        self.assertEqual("creator", saved["author"])
        self.assertTrue(saved["content"])

    def test_manifest_is_platform_neutral(self):
        file = self.root / "multi.json"
        file.write_text(json.dumps({"items": [
            {"platform": "instagram", "url": self.url, "title": "On Instagram"},
            {"platform": "reddit", "url": self.url, "title": "On Reddit"},
        ]}), encoding="utf-8")
        self.assertEqual((2, 2, 2), import_items(file, self.state, adapter="manifest"))
        ids = [i["id"] for i in load_state(self.state)["items"]]
        self.assertEqual(2, len(set(ids)))

    def test_legacy_linkedin_state_migrates_in_place(self):
        old_item = new_item(self.url, "2026-11-01")
        for field in ("platform", "external_id", "author", "metadata"):
            del old_item[field]
        save_state(self.state, {"version": 1, "items": [old_item]})
        loaded = load_state(self.state)
        self.assertEqual("linkedin", loaded["items"][0]["platform"])
        self.assertEqual(old_item["id"], loaded["items"][0]["id"])


if __name__ == "__main__":
    unittest.main()
