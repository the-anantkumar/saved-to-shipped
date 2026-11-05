import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from saved_to_shipped.sources.linkedin import parse_linkedin
from saved_to_shipped import import_items, load_state


class LinkedInImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def zip(self, files):
        target = self.root / "archive.zip"
        with ZipFile(target, "w") as archive:
            for name, content in files.items():
                archive.writestr(name, content)
        return target

    def test_full_archive_reads_only_saved_items_and_handles_bom(self):
        target = self.zip({"export/Saved Items.csv": "\ufeffDate Saved,URL\n2026-11-01,https://linkedin.com/posts/example\n",
                           "Messages.csv": "unrelated private data"})
        rows = parse_linkedin(target)
        self.assertEqual(1, len(rows))
        self.assertEqual("2026-11-01", rows[0].saved_at)
        self.assertEqual("", rows[0].content)

    def test_numeric_filename_suffix_and_camel_case_headers(self):
        target = self.zip({
            "export/Saved_Items_123456789.csv": (
                "savedItem,CreatedTime\n"
                "https://www.linkedin.com/feed/update/urn:li:activity:1234567890,2026-11-01 12:34:56\n"
            ),
            "SavedJobs_123456789.csv": "unrelated saved jobs",
        })
        records = parse_linkedin(target)
        self.assertEqual(1, len(records))
        self.assertEqual("https://www.linkedin.com/feed/update/urn:li:activity:1234567890", records[0].url)
        self.assertEqual("2026-11-01 12:34:56", records[0].saved_at)
        self.assertEqual("", records[0].content)
        state = self.root / "state.json"
        self.assertEqual((1, 1, 1), import_items(target, state))
        self.assertEqual((1, 0, 1), import_items(target, state))
        self.assertEqual("2026-11-01 12:34:56", load_state(state)["items"][0]["saved_at"])

    def test_numeric_suffix_csv_can_be_imported_directly(self):
        target = self.root / "Saved_Items_123456789.csv"
        target.write_text("savedItem,CreatedTime\nhttps://linkedin.com/posts/example,2026-11-01 12:34:56\n", encoding="utf-8")
        self.assertEqual(1, len(parse_linkedin(target)))

    def test_original_and_suffixed_files_remain_ambiguous(self):
        target = self.zip({"Saved_Items.csv": "", "Saved_Items_123456789.csv": ""})
        with self.assertRaisesRegex(ValueError, "Multiple"):
            parse_linkedin(target)

    def test_missing_or_ambiguous_saved_items_is_actionable(self):
        with self.assertRaisesRegex(ValueError, "No Saved_Items"):
            parse_linkedin(self.zip({"Saved_Jobs.csv": "Date,URL"}))
        with self.assertRaisesRegex(ValueError, "Multiple"):
            parse_linkedin(self.zip({"a/Saved_Items.csv": "", "b/Saved_Items.csv": ""}))

    def test_corrupt_zip_is_actionable(self):
        target = self.root / "broken.zip"
        target.write_bytes(b"not a zip")
        with self.assertRaisesRegex(ValueError, "Not a readable ZIP"):
            parse_linkedin(target)

    def test_invalid_row_does_not_partially_import(self):
        target = self.zip({"Saved_Items.csv": "Date,URL\n2026-11-01,https://linkedin.com/posts/a\n2026-11-02,javascript:alert(1)"})
        state = self.root / "state.json"
        with self.assertRaisesRegex(ValueError, "row 3"):
            import_items(target, state)
        self.assertEqual([], load_state(state)["items"])

    def test_uncompressed_size_is_bounded(self):
        target = self.zip({"Saved_Items.csv": "Date,URL\n2026-11-01,https://linkedin.com/posts/a"})
        with patch("saved_to_shipped.sources.linkedin.MAX_SAVED_ITEMS_BYTES", 10):
            with self.assertRaisesRegex(ValueError, "8 MiB"):
                parse_linkedin(target)

    def test_malformed_csv_reports_row(self):
        target = self.root / "Saved_Items.csv"
        target.write_text("Date,URL\n2026-11-01,https://linkedin.com/posts/a,extra", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Too many columns"):
            parse_linkedin(target)


if __name__ == "__main__":
    unittest.main()
