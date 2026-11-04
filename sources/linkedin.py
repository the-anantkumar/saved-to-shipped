"""LinkedIn's official Saved Items CSV/ZIP adapter (URLs and saved dates)."""

from __future__ import annotations

import re
from pathlib import Path
from zipfile import BadZipFile, ZipFile
from urllib.parse import urlsplit

from .base import ImportedSave, csv_rows, get_field

MAX_SAVED_ITEMS_BYTES = 8 * 1024 * 1024


def parse_linkedin(path: Path) -> list[ImportedSave]:
    if path.suffix.lower() == ".zip":
        try:
            with ZipFile(path) as archive:
                candidates = [
                    name for name in archive.namelist()
                    if re.search(r"saved[\s_-]*items?\.csv$", Path(name).name, re.I)
                ]
                if not candidates:
                    raise ValueError("No Saved_Items.csv found inside the ZIP. Request the larger LinkedIn data archive.")
                if len(candidates) != 1:
                    raise ValueError(f"Multiple Saved Items CSVs found: {candidates}. Import one CSV directly.")
                entry = archive.getinfo(candidates[0])
                if entry.file_size > MAX_SAVED_ITEMS_BYTES:
                    raise ValueError("Saved Items CSV exceeds the 8 MiB limit. Split it into smaller CSVs.")
                raw = archive.read(entry)
        except (BadZipFile, RuntimeError, NotImplementedError) as exc:
            raise ValueError(f"Not a readable ZIP archive: {path}") from exc
    else:
        if path.stat().st_size > MAX_SAVED_ITEMS_BYTES:
            raise ValueError("Saved Items CSV exceeds the 8 MiB limit. Split it into smaller CSVs.")
        raw = path.read_bytes()
    result = []
    for line, row in enumerate(csv_rows(raw), start=2):
        url = get_field(row, "url", "saved_item_url", "link", "content_url")
        if url:
            parts = urlsplit(url)
            if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username or parts.password:
                raise ValueError(f"Invalid saved URL at CSV row {line}. Use an HTTP(S) link without credentials.")
            result.append(ImportedSave(
                platform="linkedin", url=url,
                saved_at=get_field(row, "date_saved", "saved_date", "date", "saved_at"),
            ))
    if not result:
        raise ValueError("No saved URLs found. Check that you imported LinkedIn's Saved Items CSV.")
    return result
