import io
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from saved_to_shipped import new_item, save_state
from saved_to_shipped import enrichment as fetch
from saved_to_shipped import workbench as work
from saved_to_shipped.settings import Settings


class EnrichmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / "items.json"
        self.settings = Settings(self.root / "settings.json")
        self.settings.update({"apify_token": "private-test-token"})
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.items = [new_item(f"https://www.linkedin.com/feed/update/urn:li:activity:{index}", "2026-11-01") for index in (123, 456)]
        self.items[0]["note"] = "A note that must survive retrieval"
        save_state(self.path, {"version": 1, "items": self.items})
        self.manager = fetch.Retrieval(self.path, self.settings, threading.RLock())
        self.run = {"id": "run123", "status": "RUNNING", "defaultDatasetId": "dataset123"}
        self.output = [{"url": self.items[0]["url"], "_status": "ok", "text": "Build an API that stores quotes.", "author": {"name": "Example author"}, "links": ["https://example.org/guide"]},
                       {"activityId": "456", "_status": "gated"}]

    def start(self):
        with patch.object(fetch.Apify, "start", return_value=self.run):
            return self.manager.start()

    def finish(self, records=None, status="SUCCEEDED"):
        with patch.object(fetch.Apify, "poll", return_value={**self.run, "status": status}), patch.object(fetch.Apify, "items", return_value=self.output if records is None else records):
            return self.manager.poll()

    def test_run_resumes_after_restart_and_caches_content(self):
        started = self.start()
        self.assertEqual(2, started["total"])
        self.manager = fetch.Retrieval(self.path, self.settings, threading.RLock())
        done = self.finish()
        self.assertEqual(1, done["counts"]["extracted"])
        self.assertEqual(1, done["counts"]["gated"])
        saved = work.read(self.path)["items"]
        self.assertEqual(self.items[0]["note"], saved[0]["note"])
        self.assertEqual("Example author", saved[0]["author"])
        self.assertEqual("inbox", saved[0]["status"])
        self.assertEqual("run123", saved[0]["enrichment"]["run_id"])
        with patch.object(fetch.Apify, "poll") as call:
            self.assertEqual({"idle": True}, self.manager.poll())
            call.assert_not_called()
        with self.assertRaisesRegex(ValueError, "No matching saves"):
            self.manager.start()

    def test_new_run_cannot_duplicate_pending_or_unapplied_work(self):
        self.start()
        with self.assertRaisesRegex(ValueError, "already pending"):
            self.manager.start()
        state = work.read(self.path)
        state["retrieval_jobs"][0]["status"] = "SUCCEEDED"
        save_state(self.path, state)
        with self.assertRaisesRegex(ValueError, "already pending"):
            self.manager.start()

    def test_explicit_selection_keeps_requested_order_without_fetching_other_saves(self):
        chosen = [self.items[1]["id"], self.items[0]["id"]]
        with patch.object(fetch.Apify, "start", return_value=self.run) as start:
            result = self.manager.start(ids=chosen, limit=2, max_charge=0.5)
        self.assertEqual(chosen, result["item_ids"])
        self.assertEqual(([self.items[1]["url"], self.items[0]["url"]], 0.5), start.call_args.args)
        self.assertEqual(chosen, work.read(self.path)["retrieval_jobs"][0]["item_ids"])

    def test_invalid_explicit_selections_never_persist_or_submit_a_run(self):
        before = self.path.read_bytes()
        ident = self.items[0]["id"]
        invalid = [(ids, 2) for ids in [None, "not-a-list", {}, [], [ident, ident], [""], [" "],
                                       ["x" * 51], [123], [False], [[]], ["unknown-save"], [ident, "unknown-save"]]]
        invalid.append(([self.items[0]["id"], self.items[1]["id"]], 1))
        with patch.object(fetch.Apify, "start") as start:
            for ids, limit in invalid:
                with self.subTest(ids=ids, limit=limit), self.assertRaises(ValueError):
                    self.manager.start(ids=ids, limit=limit)
                self.assertEqual(before, self.path.read_bytes())
            start.assert_not_called()

    def test_ineligible_explicit_selection_never_falls_back_to_another_save(self):
        for changes in [{"content": "Already supplied context"}, {"status": "parked"},
                        {"status": "done"}, {"enrichment": {"status": "missing"}}]:
            state = work.read(self.path)
            state["items"][1] = {**self.items[1], **changes}
            save_state(self.path, state)
            before = self.path.read_bytes()
            with patch.object(fetch.Apify, "start") as start, self.assertRaisesRegex(ValueError, "selected saves"):
                self.manager.start(ids=[self.items[1]["id"]], limit=1)
            start.assert_not_called()
            self.assertEqual(before, self.path.read_bytes())

    def test_explicit_retry_submits_only_the_selected_unavailable_save(self):
        state = work.read(self.path)
        for item in state["items"]:
            item["enrichment"] = {"status": "missing"}
        save_state(self.path, state)
        with patch.object(fetch.Apify, "start", return_value=self.run) as start:
            result = self.manager.start(ids=[self.items[1]["id"]], limit=1, retry=True)
        self.assertEqual([self.items[1]["id"]], result["item_ids"])
        self.assertEqual([self.items[1]["url"]], start.call_args.args[0])

    def test_user_edits_during_retrieval_win(self):
        self.start()
        work.update_item(self.path, self.items[0]["id"], {"content": "My own manually supplied context", "title": "My title"})
        result = self.finish()
        self.assertEqual(1, result["counts"]["preserved"])
        saved = work.read(self.path)["items"][0]
        self.assertEqual("My own manually supplied context", saved["content"])
        self.assertEqual("My title", saved["title"])

    def test_unrelated_rows_and_login_wall_text_never_become_context(self):
        self.start()
        result = self.finish([{"url": "https://linkedin.com/posts/example-activity-999", "text": "Unrelated post"},
                              {"url": self.items[1]["url"], "text": "Sign in to LinkedIn to continue"}])
        self.assertEqual(1, result["counts"]["missing"])
        self.assertEqual(1, result["counts"]["gated"])
        self.assertTrue(all(not item["content"] for item in work.read(self.path)["items"]))

    def test_media_coverage_and_document_transcript_are_explicit(self):
        self.start()
        result = self.finish([{"url": self.items[0]["url"], "text": "Read the guide", "media": {"document": {"title": "Guide"}}},
                              {"url": self.items[1]["url"], "text": "A guide", "media": {"document": {"transcript": "Actual document text"}}}])
        self.assertEqual(1, result["counts"]["partial"])
        self.assertEqual(1, result["counts"]["extracted"])
        self.assertIn("Actual document text", work.read(self.path)["items"][1]["content"])

    def test_poll_failure_can_retry_without_starting_a_new_paid_run(self):
        self.start()
        with patch.object(fetch.Apify, "poll", side_effect=fetch.ProviderError("Temporary connection issue")):
            with self.assertRaisesRegex(ValueError, "Temporary"):
                self.manager.poll()
        with patch.object(fetch.Apify, "start") as start:
            self.finish()
            start.assert_not_called()

    def test_uncertain_submission_requires_explicit_dismissal(self):
        chosen = [self.items[1]["id"]]
        with patch.object(fetch.Apify, "start", side_effect=fetch.ProviderError("Connection ended", uncertain=True)) as start:
            with self.assertRaises(ValueError):
                self.manager.start(ids=chosen, limit=1)
            self.assertEqual([self.items[1]["url"]], start.call_args.args[0])
        self.assertEqual("UNCERTAIN", work.read(self.path)["retrieval_jobs"][0]["status"])
        self.assertEqual(chosen, work.read(self.path)["retrieval_jobs"][0]["item_ids"])
        with patch.object(fetch.Apify, "start") as replay:
            with self.assertRaisesRegex(ValueError, "already pending"):
                self.manager.start(ids=chosen, limit=1)
            replay.assert_not_called()
        self.manager.dismiss_uncertain()
        self.assertEqual("DISMISSED", work.read(self.path)["retrieval_jobs"][0]["status"])

    def test_known_provider_failure_and_input_limits(self):
        for values in [{"limit": 0}, {"limit": True}, {"max_charge": float("nan")}, {"max_charge": 100}, {"retry": "yes"}]:
            with self.assertRaises(ValueError):
                self.manager.start(**values)
        with patch.object(fetch.Apify, "start", side_effect=fetch.ProviderError("Invalid key")):
            with self.assertRaisesRegex(ValueError, "Invalid key"):
                self.manager.start()
        self.assertEqual("FAILED", work.read(self.path)["retrieval_jobs"][0]["status"])

    def test_retries_include_only_unavailable_saves(self):
        self.start()
        self.finish()
        with patch.object(fetch.Apify, "start", return_value=self.run) as start:
            result = self.manager.start(retry=True)
        self.assertEqual(1, result["total"])
        self.assertEqual([self.items[1]["url"]], start.call_args.args[0])

    def test_provider_request_has_cost_bound_and_no_extra_discovery(self):
        response = io.BytesIO(json.dumps({"data": self.run}).encode())
        with patch("saved_to_shipped.enrichment.urlopen", return_value=response) as send:
            fetch.Apify(self.settings).start([self.items[0]["url"]], 0.5)
        request = send.call_args.args[0]
        body = json.loads(request.data)
        self.assertIn("maxTotalChargeUsd=0.5", request.full_url)
        self.assertNotIn("private-test-token", request.full_url)
        self.assertFalse(body["discoverMorePosts"])
        self.assertEqual(1, body["limitPerSource"])
        self.assertEqual([], [key for key in body if "cookie" in key.lower()])

    def test_provider_errors_do_not_echo_tokens_or_raw_body(self):
        for error in [HTTPError("https://api.apify.com", 401, "private-test-token", {}, None), URLError("private-test-token")]:
            with patch("saved_to_shipped.enrichment.urlopen", side_effect=error):
                with self.assertRaises(fetch.ProviderError) as raised:
                    fetch.Apify(self.settings).start([self.items[0]["url"]], 1)
            self.assertNotIn("private-test-token", str(raised.exception))

    def test_dataset_pagination_and_post_identifier_matching(self):
        pages = [io.BytesIO(json.dumps([{"text": "row"}] * 100).encode()), io.BytesIO(b'[{"text":"last"}]')]
        with patch("saved_to_shipped.enrichment.urlopen", side_effect=pages) as send:
            self.assertEqual(101, len(fetch.Apify(self.settings).items("dataset123")))
        self.assertIn("offset=100", send.call_args.args[0].full_url)
        self.assertEqual(fetch.post_key(self.items[0]["url"]), fetch.post_key("https://www.linkedin.com/posts/example_activity-123-test"))
        self.assertEqual("", fetch.post_key("https://evil.example/activity:123"))

    def test_stopped_run_keeps_any_results_already_collected(self):
        self.start()
        with patch.object(fetch.Apify, "stop", return_value={**self.run, "status": "ABORTING"}):
            self.assertEqual("ABORTING", self.manager.stop()["status"])
        done = self.finish(self.output[:1], status="ABORTED")
        self.assertEqual(1, done["counts"]["extracted"])
        self.assertEqual(1, done["counts"]["missing"])

    def test_equivalent_saved_urls_share_one_fetch_and_both_receive_content(self):
        state = work.read(self.path)
        state["items"].append(new_item("https://m.linkedin.com/feed/update/urn:li:activity:123", "2026-11-02"))
        save_state(self.path, state)
        with patch.object(fetch.Apify, "start", return_value=self.run) as start:
            self.manager.start()
        self.assertEqual(2, len(start.call_args.args[0]))
        self.assertEqual(2, self.finish()["counts"]["extracted"])
        self.assertTrue(work.read(self.path)["items"][2]["content"])

    def test_inflight_submission_cannot_be_dismissed_to_start_duplicate_work(self):
        entered, release = threading.Event(), threading.Event()
        def delayed_start(*args):
            entered.set()
            release.wait(2)
            return self.run
        with patch.object(fetch.Apify, "start", side_effect=delayed_start):
            worker = threading.Thread(target=self.manager.start)
            worker.start()
            try:
                self.assertTrue(entered.wait(2))
                with self.assertRaisesRegex(ValueError, "still in progress"):
                    self.manager.dismiss_uncertain()
            finally:
                release.set()
                worker.join(timeout=2)
        self.assertEqual("run123", work.read(self.path)["retrieval_jobs"][0]["run_id"])
