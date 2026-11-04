"""Small adapter registry; add providers without changing sprint/triage code."""

from __future__ import annotations

from pathlib import Path

from .base import ImportedSave
from .linkedin import parse_linkedin
from .manifest import parse_manifest
from .reddit import parse_reddit_listing


ADAPTERS = ("linkedin", "reddit", "manifest", "instagram")


def read_source(path: Path, adapter: str = "linkedin", platform: str = "manual") -> list[ImportedSave]:
    if adapter == "linkedin":
        return parse_linkedin(path)
    if adapter == "reddit":
        return parse_reddit_listing(path)
    if adapter == "instagram":
        return parse_manifest(path, default_platform="instagram")
    if adapter == "manifest":
        return parse_manifest(path, default_platform=platform)
    raise ValueError(f"Unknown adapter {adapter!r}; available: {', '.join(ADAPTERS)}")
