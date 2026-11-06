import io
from pathlib import Path
import tarfile
import tempfile
import unittest

from scripts.check_distribution import ASSETS, MODULES, check_members, check_path, inspect_archive


def wheel_files():
    prefix = "saved_to_shipped-1.2.3.dist-info/"
    files = {f"saved_to_shipped/{module}.py": b"" for module in MODULES}
    files.update({"saved_to_shipped/web/" + asset: b"synthetic asset" for asset in ASSETS})
    files["saved_to_shipped/_version.py"] = b'__version__ = "1.2.3"\n'
    files[prefix + "METADATA"] = b"Metadata-Version: 2.4\nName: saved-to-shipped\nVersion: 1.2.3\nLicense-Expression: MIT\nRequires-Python: >=3.10\n"
    files[prefix + "entry_points.txt"] = b"[console_scripts]\nsaved-to-shipped = saved_to_shipped.server:main\nsaved-to-shipped-cli = saved_to_shipped.core:main\n"
    files[prefix + "licenses/LICENSE"] = b"Synthetic license fixture"
    return files


class DistributionTests(unittest.TestCase):
    def test_complete_wheel_and_runtime_version_agree(self):
        self.assertEqual("1.2.3", check_members(wheel_files(), "wheel"))

    def test_missing_reading_asset_fails_release_check(self):
        files = wheel_files()
        del files["saved_to_shipped/web/reading.js"]
        with self.assertRaisesRegex(ValueError, "reading.js"):
            check_members(files, "wheel")

    def test_private_state_and_unexpected_wheel_files_are_rejected(self):
        for name in ["data/items.json", "saved_to_shipped/settings.json", ".env.local", ".local/provider-output.txt", "tests/test_private.py"]:
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    check_members({**wheel_files(), name: b"synthetic private sentinel"}, "wheel")

    def test_version_entry_point_and_runtime_dependency_drift_fail(self):
        prefix = "saved_to_shipped-1.2.3.dist-info/"
        for name, replacement in [
            (prefix + "METADATA", wheel_files()[prefix + "METADATA"].replace(b"Version: 1.2.3", b"Version: 9.9.9")),
            (prefix + "METADATA", wheel_files()[prefix + "METADATA"] + b"Requires-Dist: unexpected-package\n"),
            (prefix + "entry_points.txt", b"[console_scripts]\nsaved-to-shipped = missing:main\n"),
        ]:
            with self.assertRaises(ValueError):
                check_members({**wheel_files(), name: replacement}, "wheel")

    def test_archive_paths_and_source_links_cannot_escape(self):
        for name in ("../private.py", "/private.py", "C:/private.py", "package/../../private.py", "package\\private.py"):
            with self.assertRaises(ValueError):
                check_path(name)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "source.tar.gz"
            for link in (False, True):
                with tarfile.open(path, "w:gz") as archive:
                    member = tarfile.TarInfo("package/link.py" if link else "../private.py")
                    if link:
                        member.type = tarfile.SYMTYPE
                        member.linkname = "../../private.py"
                    archive.addfile(member, None if link else io.BytesIO(b""))
                with self.assertRaises(ValueError):
                    inspect_archive(path, "sdist")
