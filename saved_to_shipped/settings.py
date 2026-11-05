"""Private local configuration, separate from exported workspace data."""

from __future__ import annotations

import json
import os
from pathlib import Path

from .core import save_state

DEFAULT_ACTOR = "data_minds/linkedin-post-scraper"


def default_state_path() -> Path:
    configured = os.environ.get("SAVED_TO_SHIPPED_DATA_DIR")
    if configured:
        return Path(configured).expanduser() / "items.json"
    checkout = Path(__file__).resolve().parent.parent
    if (checkout / "server.py").is_file() and (checkout / "pyproject.toml").is_file():
        return checkout / "data" / "items.json"
    base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "saved-to-shipped" / "items.json"


class Settings:
    def __init__(self, path: Path):
        self.path = path

    def values(self) -> dict:
        data = json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else {}
        if not isinstance(data, dict):
            raise ValueError("Local settings must contain a JSON object")
        return data

    def get(self, key: str, default: str = "") -> str:
        environment = {"apify_token": "APIFY_TOKEN", "actor": "APIFY_ACTOR", "openai_key": "OPENAI_API_KEY", "model": "OPENAI_MODEL"}
        return os.environ.get(environment[key]) or self.values().get(key) or default

    def public(self) -> dict:
        return {"extractor_available": bool(self.get("apify_token")),
                "actor": self.get("actor", DEFAULT_ACTOR),
                "ai_available": bool(self.get("openai_key")),
                "model": self.get("model", "gpt-4.1-mini")}

    def update(self, payload: dict) -> None:
        data = self.values()
        for key in ("apify_token", "openai_key", "model"):
            if key not in payload or payload[key] == "":
                continue
            value = payload[key]
            if not isinstance(value, str) or len(value) > 4096 or "\n" in value or "\r" in value:
                raise ValueError(f"Invalid {key.replace('_', ' ')}")
            data[key] = value.strip()
        for key in ("apify_token", "openai_key"):
            if payload.get("clear_" + key) is True:
                data.pop(key, None)
        # Atomic JSON writes use a private 0600 temporary file before replacement.
        save_state(self.path, data)
