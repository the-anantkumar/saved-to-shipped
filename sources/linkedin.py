"""LinkedIn's official Saved Items CSV/ZIP adapter (URLs and saved dates)."""

from __future__ import annotations

import re
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from .base import ImportedSave, csv_rows, get_field


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
                raw = archive.read(candidates[0])
        except BadZipFile as exc:
            raise ValueError(f"Not a readable ZIP archive: {path}") from exc
    else:
        raw = path.read_bytes()
    result = []
    for row in csv_rows(raw):
        url = get_field(row, "url", "saved_item_url", "link", "content_url")
        if url:
            result.append(ImportedSave(
                platform="linkedin", url=url,
                saved_at=get_field(row, "date_saved", "saved_date", "date", "saved_at"),
            ))
    if not result:
        raise ValueError("No saved URLs found. Check that you imported LinkedIn's Saved Items CSV.")
    return result
