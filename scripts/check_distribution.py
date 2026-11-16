"""Inspect release archives and optionally install each in a fresh environment.

Run after `python -m build`: python scripts/check_distribution.py --dist dist --install
Only the Python standard library is needed. Archives are inspected without extraction.
"""

from __future__ import annotations

import argparse
import ast
import configparser
from email.parser import BytesParser
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tarfile
import tempfile
import venv
from zipfile import ZipFile

PACKAGE = "saved_to_shipped"
MODULES = {"__init__", "__main__", "_version", "core", "server", "settings", "workbench", "classifier", "enrichment", "demo_data"}
ASSETS = {"index.html", "app.js", "onboarding.js", "reading.js", "theme.js", "style.css", "favicon.svg"}
SOURCE_FILES = {
    "LICENSE", "README.md", "pyproject.toml", "MANIFEST.in", "server.py", "saved_to_shipped.py",
    "CONTRIBUTING.md", "ARCHITECTURE.md", "PRODUCT_SPEC.md", "ROADMAP.md", "CHANGELOG.md", "SECURITY.md",
    ".env.example", "requirements-dev.txt", "PKG-INFO", "setup.cfg",
}
PRIVATE_PARTS = {"data", "output", ".local", ".git", ".venv", "venv", "__pycache__", ".aws", ".codex", ".agents"}
PRIVATE_NAMES = {"items.json", "settings.json", "backlog.json", "credentials", "credentials.json", ".netrc", ".DS_Store"}
ENTRY_POINTS = {"saved-to-shipped": "saved_to_shipped.server:main", "saved-to-shipped-cli": "saved_to_shipped.core:main"}


def check_path(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if "\\" in name or path.is_absolute() or any(part in {".", "..", ""} for part in name.split("/")) or ":" in name:
        raise ValueError(f"Unsafe archive path: {name}")
    if any(part in PRIVATE_PARTS | PRIVATE_NAMES for part in path.parts) or any(part.startswith(".env") and part != ".env.example" for part in path.parts):
        raise ValueError(f"Private workspace file in archive: {name}")
    if path.suffix.lower() in {".zip", ".pyc", ".pyo", ".pem", ".key"}:
        raise ValueError(f"Unexpected private or generated file in archive: {name}")
    return path


def check_members(files: dict[str, bytes], kind: str) -> str:
    """Check content boundaries, runtime assets, version, and entry points."""
    for name in files:
        path = check_path(name)
        root = path.parts[0]
        if root == PACKAGE:
            if path.suffix not in {".py", ".html", ".css", ".js", ".svg"}:
                raise ValueError(f"Unexpected application file: {name}")
        elif kind == "wheel" and root.startswith(PACKAGE + "-") and root.endswith(".dist-info"):
            pass
        elif kind == "sdist" and (name in SOURCE_FILES or root in {"tests", "scripts", "docs", PACKAGE + ".egg-info"}):
            pass
        else:
            raise ValueError(f"Unexpected distribution file: {name}")
    required = {f"{PACKAGE}/{module}.py" for module in MODULES} | {f"{PACKAGE}/web/{asset}" for asset in ASSETS}
    if kind == "sdist":
        required |= {"LICENSE", "README.md", "pyproject.toml", "MANIFEST.in", "server.py", "saved_to_shipped.py",
                     "tests/__init__.py", "tests/smoke_installed.py", "tests/ui_fixture.py", "tests/ui_behavior.mjs",
                     "tests/theme_behavior.mjs", "scripts/check_distribution.py", "CONTRIBUTING.md", "docs/RELEASING.md"}
    missing = required - files.keys()
    if missing:
        raise ValueError("Missing distribution files: " + ", ".join(sorted(missing)))
    tree = ast.parse(files[f"{PACKAGE}/_version.py"].decode("utf-8"))
    version = next((ast.literal_eval(node.value) for node in tree.body if isinstance(node, ast.Assign)
                    and any(isinstance(target, ast.Name) and target.id == "__version__" for target in node.targets)), None)
    if not isinstance(version, str) or not version:
        raise ValueError("Package must declare a literal __version__")
    metadata_name = f"{PACKAGE}-{version}.dist-info/METADATA" if kind == "wheel" else "PKG-INFO"
    if metadata_name not in files:
        raise ValueError("Distribution metadata is missing or disagrees with the runtime version")
    metadata = BytesParser().parsebytes(files[metadata_name])
    if metadata["Name"] != "saved-to-shipped" or metadata["Version"] != version:
        raise ValueError("Distribution name/version disagrees with the application")
    if metadata["License-Expression"] != "MIT" or metadata["Requires-Python"] != ">=3.10":
        raise ValueError("Review the distribution license and Python requirement")
    if metadata.get_all("Requires-Dist"):
        raise ValueError("The runtime is documented as dependency-free; review new dependencies before release")
    prefix = f"{PACKAGE}-{version}.dist-info/" if kind == "wheel" else PACKAGE + ".egg-info/"
    entry_name = prefix + "entry_points.txt"
    if entry_name not in files:
        raise ValueError("Console entry points are missing")
    entries = configparser.ConfigParser()
    entries.read_string(files[entry_name].decode("utf-8"))
    if not entries.has_section("console_scripts") or dict(entries["console_scripts"]) != ENTRY_POINTS:
        raise ValueError("Console entry points do not match the documented commands")
    if kind == "wheel" and prefix + "licenses/LICENSE" not in files:
        raise ValueError("The installed wheel must include its license")
    return version


def inspect_archive(path: Path, kind: str) -> str:
    files = {}
    if kind == "wheel":
        with ZipFile(path) as archive:
            for member in archive.infolist():
                if member.is_dir():
                    continue
                if member.filename in files:
                    raise ValueError("Duplicate archive member: " + member.filename)
                check_path(member.filename)
                files[member.filename] = archive.read(member)
    else:
        with tarfile.open(path, "r:gz") as archive:
            roots = set()
            for member in archive.getmembers():
                if member.isdir():
                    continue
                if not member.isfile():
                    raise ValueError("Source archives may contain regular files only: " + member.name)
                parts = check_path(member.name).parts
                if len(parts) < 2:
                    raise ValueError("Source archive needs one top-level directory")
                roots.add(parts[0])
                name = "/".join(parts[1:])
                if name in files:
                    raise ValueError("Duplicate archive member: " + name)
                files[name] = archive.extractfile(member).read()
            if len(roots) != 1:
                raise ValueError("Source archive needs one top-level directory")
    return check_members(files, kind)


def install_smoke(archive: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="save2ship-release-") as folder:
        environment = Path(folder) / "environment"
        venv.EnvBuilder(with_pip=True).create(environment)
        executable = environment / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
        subprocess.run([str(executable), "-m", "pip", "install", "--no-deps", str(archive.resolve())], check=True, timeout=240)
        smoke = Path(__file__).resolve().parents[1] / "tests" / "smoke_installed.py"
        subprocess.run([str(executable), str(smoke)], cwd=folder, check=True, timeout=60)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, default=Path("dist"))
    parser.add_argument("--install", action="store_true", help="Install both artifacts into separate clean environments and run the local smoke flow")
    args = parser.parse_args()
    artifacts = {"wheel": list(args.dist.glob("*.whl")), "sdist": list(args.dist.glob("*.tar.gz"))}
    if any(len(paths) != 1 for paths in artifacts.values()):
        parser.error("Choose a directory containing exactly one wheel and one source archive; use a fresh build output directory")
    versions = {inspect_archive(paths[0], kind) for kind, paths in artifacts.items()}
    if len(versions) != 1:
        raise ValueError("Wheel and source archive versions differ")
    for kind, paths in artifacts.items():
        print(f"Verified {kind}: {paths[0].name}", flush=True)
        if args.install:
            install_smoke(paths[0])
    print("Release artifacts contain the expected code, assets, commands, and source helpers.")


if __name__ == "__main__":
    main()
