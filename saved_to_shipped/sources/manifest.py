"""CSV/JSON import contract for Instagram and any future source.

This does not claim to parse Instagram's native data-export format. Users or
future adapters can provide normalized items with platform, URL and context.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from .base import ImportedSave, csv_rows, get_field


def parse_manifest(path: Path, default_platform: str = "manual") -> list[ImportedSave]:
    if path.suffix.lower() == ".csv":
        records = csv_rows(path.read_bytes())
    elif path.suffix.lower() == ".json":
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
        records = payload.get("items") if isinstance(payload, dict) else payload
        if not isinstance(records, list) or any(not isinstance(item, dict) for item in records):
            raise ValueError("Manifest JSON must be a list or {\"items\": [...]} object")
        records = [{str(key).strip().lower().replace(" ", "_"): value for key, value in row.items()} for row in records]
    else:
        raise ValueError("Manifest import supports CSV and JSON; normalize your export first")
    result = []
    for record in records:
        url = get_field(record, "url", "permalink", "link")
        if not url:
            continue
        platform = get_field(record, "platform", "source") or default_platform
        if not re.fullmatch(r"[a-z][a-z0-9_-]{1,29}", platform):
            raise ValueError(f"Invalid platform name: {platform!r}")
        result.append(ImportedSave(
            platform=platform, url=url,
            saved_at=get_field(record, "saved_at", "date_saved", "saved_date", "date"),
            external_id=get_field(record, "external_id", "source_id"),
            title=get_field(record, "title", "caption"),
            content=get_field(record, "content", "text", "description", "body"),
            author=get_field(record, "author", "username", "creator"),
        ))
    return result
