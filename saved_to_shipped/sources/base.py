"""The platform-neutral contract: all importers produce these records."""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ImportedSave:
    platform: str
    url: str
    saved_at: str = ""
    external_id: str = ""
    title: str = ""
    content: str = ""
    author: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


def decode_text(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16", "cp1252"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("Could not decode the supplied file")


def csv_rows(raw: bytes) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(decode_text(raw)))
    if not reader.fieldnames:
        raise ValueError("CSV has no header row")
    result = []
    for line, row in enumerate(reader, start=2):
        if None in row:
            raise ValueError(f"Too many columns at CSV row {line}. Quote text containing commas.")
        result.append({(key or "").strip().lower().replace(" ", "_"): (value or "").strip()
                       for key, value in row.items()})
    return result


def get_field(row: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""
