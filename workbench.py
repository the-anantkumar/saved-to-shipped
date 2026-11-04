"""Local workbench operations shared by the HTTP interface and tests."""

from __future__ import annotations

import csv
import io
import json
import math
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from saved_to_shipped import (KINDS, STATUSES, create_plan, export_issues, import_items,
                             load_state, new_item, save_state, score, select_item)


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def has_context(item: dict) -> bool:
    return bool((item.get("content", "") + item.get("note", "")).strip())


def text(value, name: str, limit: int = 20000) -> str:
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError(f"{name} must be text with at most {limit} characters")
    return value.strip()


def read(path: Path) -> dict:
    state = load_state(path)
    state.setdefault("projects", [])
    state.setdefault("imports", [])
    return state


def snapshot(path: Path) -> dict:
    state = read(path)
    for item in state["items"]:
        item["has_context"] = has_context(item)
        item["score"] = score(item)
    return state


def import_linkedin(source: Path, path: Path, filename: str) -> dict:
    rows, added, total = import_items(source, path)
    state = read(path)
    result = {"filename": filename, "rows": rows, "added": added,
              "duplicates": rows - added, "total": total, "at": now()}
    state["imports"].insert(0, result)
    state["imports"] = state["imports"][:20]
    save_state(path, state)
    return result


def capture(path: Path, payload: dict) -> str:
    state = read(path)
    item = new_item(text(payload.get("url", ""), "URL", 4000), now()[:10],
                    title=text(payload.get("title", ""), "Title", 300),
                    content=text(payload.get("content", ""), "Post text"))
    from urllib.parse import urlsplit
    host = urlsplit(item["url"]).hostname or ""
    if host != "linkedin.com" and not host.endswith(".linkedin.com"):
        raise ValueError("Use a LinkedIn post or article URL")
    item["note"] = text(payload.get("note", ""), "Note")
    if any(existing["id"] == item["id"] for existing in state["items"]):
        raise ValueError("This link is already in your inbox. Open it to add context.")
    state["items"].insert(0, item)
    save_state(path, state)
    return item["id"]


def project_for(state: dict, name: str) -> str:
    existing = next((p for p in state["projects"] if p["name"].casefold() == name.casefold()), None)
    if existing:
        return existing["id"]
    project = {"id": uuid.uuid4().hex[:12], "name": name, "description": "", "created_at": now()}
    state["projects"].append(project)
    return project["id"]


def save_project(path: Path, payload: dict) -> str:
    state = read(path)
    name = text(payload.get("name", ""), "Project name", 100)
    if not name:
        raise ValueError("Give the project a name")
    ident = payload.get("id")
    if ident:
        project = next((p for p in state["projects"] if p["id"] == ident), None)
        if not project:
            raise ValueError("Project not found")
        if any(p["id"] != ident and p["name"].casefold() == name.casefold() for p in state["projects"]):
            raise ValueError("A project with this name already exists")
        project["name"] = name
    else:
        ident = project_for(state, name)
        project = next(p for p in state["projects"] if p["id"] == ident)
    project["description"] = text(payload.get("description", ""), "Description", 2000)
    save_state(path, state)
    return ident


def update_item(path: Path, ident: str, payload: dict) -> None:
    state = read(path)
    item = select_item(state, ident)
    for key in ("title", "content", "note", "why", "next_action", "definition_of_done", "outcome_url"):
        if key in payload:
            item[key] = text(payload[key], key, 300 if key == "title" else 20000)
    if item.get("outcome_url"):
        from saved_to_shipped import canonical_url
        item["outcome_url"] = canonical_url(item["outcome_url"])
    if "kind" in payload:
        if payload["kind"] not in KINDS:
            raise ValueError("Choose a valid classification")
        item["kind"] = payload["kind"]
    if item["kind"] != "untriaged" and not has_context(item):
        raise ValueError("Add post text or a useful note before classifying this save")
    if "project_id" in payload:
        project = payload["project_id"]
        if project and not any(p["id"] == project for p in state["projects"]):
            raise ValueError("Choose an existing project")
        item["project_id"] = project
    if "effort_hours" in payload:
        value = payload["effort_hours"]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0.25 <= value <= 2:
            raise ValueError("First-action effort must be between 0.25 and 2 hours")
        item["effort_hours"] = value
    if "status" in payload:
        if payload["status"] not in STATUSES:
            raise ValueError("Choose a valid status")
        item["status"] = payload["status"]
    if item["status"] in {"ready", "doing", "done"}:
        if not has_context(item) or item["kind"] == "untriaged" or not item["next_action"] or not item["definition_of_done"] or not item["title"]:
            raise ValueError("A backlog task needs context, classification, title, next action, and a done condition")
        if not 0.25 <= item.get("effort_hours", 0) <= 2:
            raise ValueError("Set a first-action estimate between 0.25 and 2 hours")
    item["updated_at"] = now()
    save_state(path, state)


THEMES = [
    ("AI playground", r"\b(agent|agents|rag|llm|mcp|prompt|prompts|embedding|embeddings|retrieval)\b",
     "Make a minimal local experiment for this idea with one input and one recorded output.",
     "The experiment runs locally and includes one passing check plus a short note on the result."),
    ("Personal tools", r"\b(automat\w*|api|dashboard|bookmark\w*|python|workflow|sqlite|script\w*)\b",
     "Build the smallest local proof of concept for the workflow described in your note.",
     "One sample input produces the expected output and a repeatable check verifies it."),
    ("Learning lab", r"\b(learn\w*|tutorial|database|index\w*|course|study|explain)\b",
     "Reproduce one example from the supplied context and record what changed.",
     "A runnable example and five lines explaining the result are saved together."),
]


def classify_local(state: dict) -> int:
    """Transparent keyword suggestions, not a semantic model or source enrichment."""
    count = 0
    for item in state["items"]:
        if item["kind"] != "untriaged" or item["status"] != "inbox" or not has_context(item):
            continue
        context = (item.get("content", "") + " " + item.get("note", "")).strip()
        theme = next((t for t in THEMES if re.search(t[1], context, re.I)), None)
        if re.search(r"\b(hackathon|attend|event|conference|register)\b", context, re.I):
            kind = "experience"
        elif re.search(r"\b(build|prototype|implement|automate|create)\b", context, re.I):
            kind = "project"
        elif re.search(r"\b(learn\w*|tutorial|study|understand\w*|course)\b", context, re.I):
            kind = "learning"
        else:
            kind = "reference"
        item.update(kind=kind, title=item.get("title") or context.split("\n")[0][:90],
                    confidence="low", classification_method="local rules", effort_hours=1,
                    why="Draft from keywords in your supplied context. Review the action before starting.",
                    tags=[theme[0].lower().replace(" ", "-")] if theme else [])
        if kind == "experience":
            action, done = "Check the original event details and record dates, eligibility, and your decision.", "The dates and requirements are verified and an attend or skip decision is recorded."
        elif kind == "reference":
            action, done = "Write a two-sentence summary and name a situation where this reference helps.", "The summary and a concrete use case are attached to this save."
        else:
            _, _, action, done = theme or ("", "", "Test one small idea from your supplied context.", "A repeatable example and a short result note are saved.")
        item["next_action"], item["definition_of_done"] = action, done
        if theme:
            item["project_id"] = project_for(state, theme[0])
        count += 1
    return count


def suggest(path: Path) -> int:
    state = read(path)
    count = classify_local(state)
    save_state(path, state)
    return count


def export_bundle(path: Path, hours: float = 6) -> bytes:
    import tempfile
    state = read(path)
    buffer = io.BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        archive.writestr("backlog.json", json.dumps(state, indent=2, ensure_ascii=False))
        archive.writestr("weekly_sprint.md", create_plan(state, hours))
        table = io.StringIO()
        fields = ["id", "title", "url", "saved_at", "kind", "status", "project", "effort_hours", "next_action", "definition_of_done", "outcome_url"]
        writer = csv.DictWriter(table, fieldnames=fields)
        writer.writeheader()
        projects = {p["id"]: p["name"] for p in state["projects"]}
        for item in state["items"]:
            row = {key: item.get(key, "") for key in fields}
            row["project"] = projects.get(item.get("project_id"), "")
            # Prevent a copied post title from becoming a spreadsheet formula.
            writer.writerow({k: "'" + v if isinstance(v, str) and v.startswith(("=", "+", "-", "@", "\t", "\r")) else v for k, v in row.items()})
        archive.writestr("backlog.csv", table.getvalue())
        with tempfile.TemporaryDirectory() as folder:
            export_issues(state, Path(folder))
            for issue in sorted(Path(folder).glob("*.md")):
                archive.writestr("issues/" + issue.name, issue.read_bytes())
    return buffer.getvalue()
