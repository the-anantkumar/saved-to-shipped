"""Import a user-supplied Reddit OAuth `saved` listing JSON response.

This adapter does NOT obtain tokens or query Reddit. It expects already-authorized
data, such as a JSON response the user exported themselves.
"""

from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urljoin

from .base import ImportedSave


def parse_reddit_listing(path: Path) -> list[ImportedSave]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
        raise ValueError("Expected a Reddit Listing JSON object with data.children")
    children = payload["data"].get("children")
    if not isinstance(children, list):
        raise ValueError("Expected a Reddit Listing JSON object with data.children")
    records = []
    for child in children:
        if not isinstance(child, dict) or child.get("kind") not in {"t1", "t3"}:
            continue
        item = child.get("data") or {}
        if not isinstance(item, dict):
            continue
        permalink = str(item.get("permalink") or "").strip()
        if not permalink:
            continue
        url = urljoin("https://www.reddit.com", permalink)
        post = child["kind"] == "t3"
        content = str(item.get("selftext") or "") if post else str(item.get("body") or "")
        records.append(ImportedSave(
            platform="reddit", url=url,
            saved_at=str(item.get("saved_at") or ""),
            external_id=str(item.get("name") or item.get("id") or ""),
            title=str(item.get("title") or ("Saved Reddit comment" if not post else "")),
            content="" if content in {"[deleted]", "[removed]"} else content,
            author=str(item.get("author") or ""),
            metadata={"subreddit": str(item.get("subreddit") or ""),
                      "item_type": "post" if post else "comment",
                      "published_utc": item.get("created_utc")},
        ))
    return records
