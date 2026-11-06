import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from saved_to_shipped import triage_prompt
from saved_to_shipped.settings import Settings, default_state_path


class SettingsTests(unittest.TestCase):
    def test_private_keys_are_persistent_but_never_returned(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            path = Path(folder) / "settings.json"
            settings = Settings(path)
            settings.update({"apify_token": "private-test-token", "openai_key": "private-model-token"})
            self.assertTrue(settings.public()["extractor_available"])
            self.assertNotIn("private-", json.dumps(settings.public()))
            self.assertEqual("private-test-token", Settings(path).get("apify_token"))
            if os.name == "posix":
                self.assertEqual(0o600, path.stat().st_mode & 0o777)
            settings.update({"apify_token": ""})
            self.assertEqual("private-test-token", settings.get("apify_token"))
            settings.update({"clear_apify_token": True})
            self.assertFalse(settings.public()["extractor_available"])

    def test_environment_overrides_local_configuration(self):
        with tempfile.TemporaryDirectory() as folder:
            settings = Settings(Path(folder) / "settings.json")
            settings.update({"apify_token": "stored"})
            with patch.dict(os.environ, {"APIFY_TOKEN": "environment"}):
                self.assertEqual("environment", settings.get("apify_token"))

    def test_configured_data_directory_and_generic_goals(self):
        with patch.dict(os.environ, {"SAVED_TO_SHIPPED_DATA_DIR": "/tmp/example-saves"}):
            self.assertEqual(Path("/tmp/example-saves/items.json"), default_state_path())
        prompt = triage_prompt({"items": [], "goals": "Learn Rust by building small tools"}, 20)
        self.assertIn("Learn Rust", prompt)
        self.assertNotIn("Anant", prompt)
        self.assertNotIn("TRLR", prompt)
