import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

import classifier
import workbench as work
from saved_to_shipped import new_item, save_state


class ClassifierTests(unittest.TestCase):
    def setUp(self):
        self.item = new_item("https://linkedin.com/posts/example", "2026-11-01", content="Build a quote API")
        self.unknown = new_item("https://linkedin.com/posts/unknown", "2026-11-02", title="Suggestive title")
        self.state = {"version": 1, "items": [self.item, self.unknown], "projects": []}
        self.record = {"id": self.item["id"], "kind": "project", "title": "Quote API", "why": "A small useful tool",
                       "next_action": "Write a quote storage endpoint", "definition_of_done": "An API test stores and retrieves one quote",
                       "project_name": "Personal tools", "effort_hours": 1, "confidence": "medium", "tags": ["api"],
                       "impact": 3, "relevance": 4, "novelty": 3, "commit_message": "feat: store quotes", "repo_suggestion": ""}

    def response(self, payload=None, status="completed"):
        return io.BytesIO(json.dumps({"status": status, "output": [{"type": "message", "content": [
            {"type": "output_text", "text": json.dumps(payload or {"items": [self.record]})}]}]}).encode())

    @patch.dict("os.environ", {"OPENAI_API_KEY": "test-key", "OPENAI_MODEL": "test-model"})
    def test_request_sends_context_only_and_validates_batch(self):
        with patch("classifier.urlopen", return_value=self.response()) as request:
            self.assertEqual([self.record], classifier.classify(self.state)["items"])
        sent = json.loads(request.call_args.args[0].data)
        self.assertFalse(sent["store"])
        self.assertEqual("test-model", sent["model"])
        self.assertNotIn(self.unknown["id"], sent["input"])
        self.assertNotIn(self.item["url"], sent["input"])
        self.assertTrue(sent["text"]["format"]["strict"])

    @patch.dict("os.environ", {}, clear=True)
    def test_key_is_optional_and_missing_key_does_not_make_request(self):
        with patch("classifier.urlopen") as request:
            with self.assertRaisesRegex(ValueError, "OPENAI_API_KEY"):
                classifier.classify(self.state)
            request.assert_not_called()
        self.assertFalse(classifier.configuration()["available"])

    @patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"})
    def test_partial_invented_and_duplicate_ids_are_rejected(self):
        for records in [[], [dict(self.record, id="invented")], [self.record, self.record]]:
            with patch("classifier.urlopen", return_value=self.response({"items": records})):
                with self.assertRaisesRegex(ValueError, "invalid or incomplete"):
                    classifier.classify(self.state)

    @patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"})
    def test_provider_failure_has_actionable_message_without_secrets(self):
        for error in [HTTPError("https://api.openai.com", 429, "secret data", {}, None), URLError("secret data")]:
            with patch("classifier.urlopen", side_effect=error):
                with self.assertRaisesRegex(ValueError, "No items were changed") as result:
                    classifier.classify(self.state)
                self.assertNotIn("secret", str(result.exception))
        with patch("classifier.urlopen", return_value=self.response(status="incomplete")):
            with self.assertRaisesRegex(ValueError, "did not complete"):
                classifier.classify(self.state)

    def test_application_is_atomic_and_keeps_web_suggestions_in_review(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "items.json"
            save_state(path, self.state)
            bad = dict(self.record, id=self.unknown["id"])
            with self.assertRaisesRegex(ValueError, "No supplied"):
                work.apply_classification(path, {"items": [self.record, bad]})
            self.assertEqual("untriaged", work.read(path)["items"][0]["kind"])
            self.assertEqual(1, work.apply_classification(path, {"items": [self.record]}, "OpenAI"))
            state = work.read(path)
            self.assertEqual("inbox", state["items"][0]["status"])
            self.assertEqual("OpenAI", state["items"][0]["classification_method"])
            self.assertEqual("Personal tools", state["projects"][0]["name"])

    def test_malformed_field_types_and_infinite_estimates_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "items.json"
            save_state(path, self.state)
            for fields in [{"title": []}, {"kind": []}, {"confidence": []}, {"tags": "api"}, {"effort_hours": float("nan")}, {"effort_hours": 10}, {"next_action": ""}]:
                with self.assertRaises(ValueError):
                    work.apply_classification(path, {"items": [dict(self.record, **fields)]})
            self.assertEqual("untriaged", work.read(path)["items"][0]["kind"])


if __name__ == "__main__":
    unittest.main()
