#!/usr/bin/env python3
"""Saved → Shipped: turn saved posts from multiple sources into an action queue.

Uses only the Python standard library. Importers read local user-provided files.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import tempfile
from collections import Counter
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .sources import ADAPTERS, read_source


KINDS = {"untriaged", "project", "learning", "experience", "reference", "skip"}
STATUSES = {"inbox", "ready", "doing", "done", "parked"}
AI_FIELDS = {
    "kind", "title", "why", "impact", "relevance", "novelty", "effort_hours",
    "next_action", "definition_of_done", "repo_suggestion", "commit_message",
    "confidence", "tags",
}


def canonical_url(raw: str) -> str:
    parts = urlsplit(raw.strip())
    if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username or parts.password:
        raise ValueError(f"Not an HTTP(S) URL: {raw!r}")
    ignored = {"trk", "lipi", "originalsubdomain", "midtoken", "ebp"}
    query = [
        (key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if key.lower() not in ignored and not key.lower().startswith("utm_")
    ]
    return urlunsplit(("https", parts.netloc.lower(), parts.path.rstrip("/") or "/", urlencode(query), ""))


def item_id(url: str, platform: str = "linkedin") -> str:
    """Stable per-platform identity; preserve pre-v0.2 LinkedIn IDs."""
    key = canonical_url(url) if platform == "linkedin" else f"{platform}\0{canonical_url(url)}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]


def new_item(url: str, saved_at: str, platform: str = "linkedin", *,
             title: str = "", content: str = "", author: str = "",
             external_id: str = "", metadata: dict | None = None) -> dict:
    clean_url = canonical_url(url)
    return {
        "id": item_id(clean_url, platform), "platform": platform,
        "external_id": external_id, "author": author, "metadata": metadata or {},
        "url": clean_url, "saved_at": saved_at,
        "title": title, "content": content, "note": "", "kind": "untriaged",
        "status": "inbox", "why": "", "impact": 3, "relevance": 3,
        "novelty": 3, "effort_hours": 0, "next_action": "",
        "definition_of_done": "", "repo_suggestion": "", "commit_message": "",
        "confidence": "unknown", "tags": [],
    }


def load_state(path: Path) -> dict:
    if not path.exists():
        return {"version": 1, "items": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("version") != 1 or not isinstance(data.get("items"), list):
        raise ValueError("State file must contain version=1 and an items array")
    # Backward-compatible loading of the LinkedIn-only v0 state format.
    for item in data["items"]:
        item.setdefault("platform", "linkedin")
        item.setdefault("metadata", {})
        item.setdefault("external_id", "")
        item.setdefault("author", "")
    return data


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Atomic replace prevents a crash from leaving half-written JSON.
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        json.dump(state, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
        temp_name = handle.name
    Path(temp_name).replace(path)


def parse_saved_items(source: Path) -> list[tuple[str, str]]:
    """Compatibility helper for the old LinkedIn-only importer."""
    return [(canonical_url(item.url), item.saved_at)
            for item in read_source(source, adapter="linkedin")]


def import_items(source: Path, state_path: Path, adapter: str = "linkedin",
                 platform: str = "manual") -> tuple[int, int, int]:
    state = load_state(state_path)
    existing = {item["id"]: item for item in state["items"]}
    imported = read_source(source, adapter=adapter, platform=platform)
    added = 0
    for record in imported:
        try:
            ident = item_id(record.url, record.platform)
        except ValueError:
            continue
        if ident not in existing:
            item = new_item(
                record.url, record.saved_at, record.platform,
                title=record.title, content=record.content, author=record.author,
                external_id=record.external_id, metadata=record.metadata,
            )
            state["items"].append(item)
            existing[ident] = item
            added += 1
        else:
            current = existing[ident]
            for key, value in (("saved_at", record.saved_at), ("title", record.title),
                               ("content", record.content), ("author", record.author),
                               ("external_id", record.external_id)):
                if not current.get(key) and value:
                    current[key] = value
            if not current.get("metadata") and record.metadata:
                current["metadata"] = record.metadata
    save_state(state_path, state)
    return len(imported), added, len(state["items"])


def select_item(state: dict, selector: str) -> dict:
    if selector.startswith(("https://", "http://")):
        found = [item for item in state["items"] if item["url"] == canonical_url(selector)]
    else:
        found = [item for item in state["items"] if item["id"] == selector]
    if not found:
        raise ValueError(f"Item {selector!r} not found. Use the ID from `list`.")
    if len(found) > 1:
        raise ValueError(f"URL {selector!r} occurs in multiple platforms; select by item ID")
    return found[0]


def attach(args: argparse.Namespace) -> None:
    state = load_state(args.state)
    item = select_item(state, args.item)
    if args.title is not None:
        item["title"] = args.title.strip()
    if args.content_file:
        item["content"] = args.content_file.read_text(encoding="utf-8").strip()
    if args.note is not None:
        item["note"] = args.note.strip()
    save_state(args.state, state)
    print(f"Attached context to {item['id']}: {item['url']}")


def triage_prompt(state: dict, limit: int) -> str:
    pending = [item for item in state["items"] if item["kind"] == "untriaged"]
    with_context = [item for item in pending if item["content"] or item["note"]]
    missing = [item for item in pending if not item["content"] and not item["note"]]
    lines = [
        "# Saved → Shipped — ChatGPT triage batch", "",
        "You are my pragmatic build partner. Convert the content below into high-value,",
        "small, verifiable next steps for a developer.",
        f"My goals: {state.get('goals') or 'Build useful small projects and learn through practical experiments.'}",
        "Prioritize genuinely useful work over artificial commit counts.", "",
        "For each item with actual context, classify as project, learning, experience,",
        "reference, or skip. Return a single JSON object: {\"items\": [{...}]}.",
        "Each object must include id, kind, title, why, impact (1-5), relevance (1-5),",
        "novelty (1-5), effort_hours (hours for the next action; 0.25-2),",
        "next_action (concrete, <=2 hours),",
        "definition_of_done (testable), repo_suggestion (can be blank),",
        "commit_message (only for projects), confidence (high/medium/low), tags (array).",
        "Optionally include project_name to group related saves into a small project.",
        "Preserve each ID exactly. Do not invent facts from URLs, infer post contents,",
        "or present recommendations without source support. If context is weak,",
        "set kind=reference and confidence=low, then explain the missing information.",
        "Output JSON only; I will apply it to the local backlog.", "",
        f"## Ready for triage ({min(len(with_context), limit)} of {len(with_context)})", "",
    ]
    for item in with_context[:limit]:
        lines.extend([
            f"### ID {item['id']}", f"URL: {item['url']}",
            f"Platform: {item.get('platform', 'linkedin')}",
            f"Saved: {item.get('saved_at') or 'unknown'}",
            f"Author: {item.get('author') or '(unknown)'}",
            f"Existing title: {item.get('title') or '(unknown)'}",
            f"Post text: {item.get('content') or '(not supplied)'}",
            f"Content coverage: {item.get('enrichment', {}).get('coverage', 'User-supplied context')}",
            f"My note: {item.get('note') or '(none)'}", "",
        ])
    lines.extend([
        "## Needs post content (do NOT classify based on URL alone)", "",
        f"{len(missing)} untriaged items have no post text or note. Add them with",
        "`attach` after opening the items yourself and copying relevant details.",
        "First IDs needing context:", "",
    ])
    for item in missing[:25]:
        lines.append(f"- {item['id']}: {item['url']}")
    return "\n".join(lines) + "\n"


def apply_triage(file: Path, state_path: Path) -> int:
    payload = json.loads(file.read_text(encoding="utf-8"))
    state = load_state(state_path)
    count = apply_triage_records(state, payload)
    save_state(state_path, state)
    return count


def apply_triage_records(state: dict, payload, *, mark_ready: bool = True) -> int:
    records = payload.get("items", []) if isinstance(payload, dict) else payload
    if not isinstance(records, list):
        raise ValueError("Triage JSON must be an array or {\"items\": [...]} object")
    existing = {item["id"]: item for item in state["items"]}
    seen = set()
    for record in records:
        if not isinstance(record, dict) or not isinstance(record.get("id"), str):
            raise ValueError("Each triage item must be an object with a string id")
        ident = record.get("id")
        if ident not in existing or ident in seen:
            raise ValueError(f"Unknown or duplicate triage ID: {ident}")
        seen.add(ident)
        if not (existing[ident].get("content", "") + existing[ident].get("note", "")).strip():
            raise ValueError(f"No supplied post text or note for {ident}; refusing unsupported classification")
        if not isinstance(record.get("kind"), str) or record.get("kind") not in KINDS - {"untriaged"}:
            raise ValueError(f"Invalid kind for {ident}: {record.get('kind')}")
        for key in ("title", "next_action", "definition_of_done"):
            if not isinstance(record.get(key), str) or not record[key].strip():
                raise ValueError(f"{key} must be nonempty text for {ident}")
        for key in ("title", "why", "next_action", "definition_of_done", "repo_suggestion", "commit_message", "project_name"):
            if key in record and (not isinstance(record[key], str) or len(record[key]) > 20000):
                raise ValueError(f"{key} must be text with at most 20000 characters for {ident}")
        for key in ("impact", "relevance", "novelty"):
            if key in record and (not isinstance(record[key], (int, float)) or isinstance(record[key], bool) or not 1 <= record[key] <= 5):
                raise ValueError(f"{key} must be 1-5 for {ident}")
        effort = record.get("effort_hours")
        if not isinstance(effort, (int, float)) or isinstance(effort, bool) or not math.isfinite(effort) or not 0.25 <= effort <= 2:
            raise ValueError(f"effort_hours must be between 0.25 and 2 for {ident}")
        if "tags" in record and (not isinstance(record["tags"], list) or any(not isinstance(x, str) for x in record["tags"])):
            raise ValueError(f"tags must be a list of strings for {ident}")
        if not isinstance(record.get("confidence", "unknown"), str) or record.get("confidence", "unknown") not in {"high", "medium", "low", "unknown"}:
            raise ValueError(f"Invalid confidence for {ident}")
    for record in records:
        item = existing[record["id"]]
        for key in AI_FIELDS:
            if key in record:
                item[key] = record[key]
        if mark_ready and item["status"] == "inbox" and item["kind"] not in {"skip", "reference"}:
            item["status"] = "ready"
    return len(records)


def score(item: dict) -> float:
    effort = float(item.get("effort_hours") or 2)
    confidence_penalty = {"high": 0, "medium": 0.5, "low": 1.5, "unknown": 2}.get(item.get("confidence"), 2)
    return round(
        2 * float(item.get("relevance", 3))
        + 1.5 * float(item.get("impact", 3))
        + float(item.get("novelty", 3))
        - 0.35 * min(effort, 40)
        - confidence_penalty,
        2,
    )


def _card(item: dict) -> list[str]:
    lines = [
        f"### {item.get('title') or 'Untitled item'}",
        f"- Source: {item['url']}",
        f"- Why: {item.get('why') or 'Needs a clear motivation'}",
        f"- First-action effort: {item.get('effort_hours') or 'TBD'} hours",
        f"- Next action: {item.get('next_action') or 'Define a concrete first step'}",
        f"- Done when: {item.get('definition_of_done') or 'Set a testable finish line'}",
    ]
    if item.get("kind") == "project":
        lines.extend([
            f"- Suggested repo: {item.get('repo_suggestion') or 'Choose before starting'}",
            f"- Suggested commit: `{item.get('commit_message') or 'TBD'}`",
        ])
    return [*lines, ""]


def create_plan(state: dict, hours: float) -> str:
    actionable = [
        item for item in state["items"]
        if item.get("kind") in {"project", "learning", "experience"}
        and item.get("status") in {"ready", "doing"}
        and item.get("next_action") and item.get("title")
    ]
    ordered = sorted(actionable, key=score, reverse=True)
    projects = [i for i in ordered if i["kind"] == "project"]
    selected = []
    remaining = hours
    for item in projects:
        effort = float(item.get("effort_hours") or 2)
        if len(selected) >= 2:
            break
        if effort <= remaining:
            selected.append(item)
            remaining -= effort
    lines = [
        "# Saved → Shipped — Weekly Build Sprint", "",
        f"Time budget: {hours:g} hours. Planned project effort: {hours - remaining:g} hours.",
        "Prefer one useful, tested feature and a real commit over numerous cosmetic commits.", "",
        "## Build queue", "",
    ]
    if not selected:
        lines.extend(["No context-backed project fits this budget yet. Add post text and triage it first.", ""])
    for item in selected:
        lines.extend(_card(item))
    for kind, heading in (("learning", "Optional: Learn"), ("experience", "Optional: Experience")):
        lines.extend([f"## {heading}", ""])
        candidates = [i for i in ordered if i["kind"] == kind]
        if candidates:
            lines.extend(_card(candidates[0]))
        else:
            lines.extend(["Nothing ready yet.", ""])
    lines.extend([
        "## End-of-week checkpoint", "",
        "- [ ] Link one meaningful commit or PR to an idea above", 
        "- [ ] Record what was learned and whether the idea was worth the time",
        "- [ ] Move finished items to `done`; park ideas that are no longer compelling",
        "- [ ] Triage a few more saves only after shipping something", "",
    ])
    return "\n".join(lines)


def export_issues(state: dict, folder: Path) -> int:
    folder.mkdir(parents=True, exist_ok=True)
    count = 0
    for item in state["items"]:
        if item.get("kind") != "project" or item.get("status") not in {"ready", "doing"}:
            continue
        if not item.get("title") or not item.get("next_action"):
            continue
        slug = re.sub(r"[^a-z0-9]+", "-", item["title"].lower()).strip("-")[:50] or item["id"]
        path = folder / f"{slug}-{item['id']}.md"
        body = [
            f"# {item['title']}", "",
            f"Original inspiration ({item.get('platform', 'linkedin')}): {item['url']}", "",
            "## Why", "", item.get("why") or "To be clarified", "",
            "## First step", "", item["next_action"], "",
            "## Acceptance criteria", "", f"- [ ] {item.get('definition_of_done') or 'Define and meet a testable acceptance criterion'}", "",
            f"Estimated effort: {item.get('effort_hours') or 'TBD'} hours", "",
            f"Suggested commit: `{item.get('commit_message') or 'TBD'}`", "",
        ]
        path.write_text("\n".join(body), encoding="utf-8")
        count += 1
    return count


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Turn saved posts across platforms into a real build backlog")
    from .settings import default_state_path
    parser.add_argument("--state", type=Path, default=default_state_path(), help="Persistent state JSON (defaults to the app data directory)")
    commands = parser.add_subparsers(dest="command", required=True)
    ingest = commands.add_parser("ingest", help="Import LinkedIn, Reddit or a normalized CSV/JSON manifest")
    ingest.add_argument("source", type=Path)
    ingest.add_argument("--adapter", choices=ADAPTERS, default="linkedin",
                        help="Input format (default: linkedin)")
    ingest.add_argument("--platform", default="manual",
                        help="Platform label for --adapter manifest (e.g. instagram)")
    commands.add_parser("list", help="List imported items and what needs context")
    annotate = commands.add_parser("attach", help="Attach manually supplied post text / notes")
    annotate.add_argument("item", help="12-character item ID or URL")
    annotate.add_argument("--title")
    annotate.add_argument("--content-file", type=Path)
    annotate.add_argument("--note")
    prompt_cmd = commands.add_parser("prompt", help="Generate a ChatGPT triage prompt without guessing post contents")
    prompt_cmd.add_argument("--limit", type=int, default=20)
    prompt_cmd.add_argument("--out", type=Path, default=Path("output/triage_prompt.md"))
    apply_cmd = commands.add_parser("apply", help="Apply ChatGPT's structured triage JSON")
    apply_cmd.add_argument("file", type=Path)
    plan_cmd = commands.add_parser("plan", help="Generate a weekly build sprint")
    plan_cmd.add_argument("--hours", type=float, default=6)
    plan_cmd.add_argument("--out", type=Path, default=Path("output/weekly_sprint.md"))
    issues_cmd = commands.add_parser("issues", help="Export draft GitHub issues as Markdown (does not publish)")
    issues_cmd.add_argument("--out", type=Path, default=Path("output/issues"))
    status_cmd = commands.add_parser("status", help="Update an item's status")
    status_cmd.add_argument("item")
    status_cmd.add_argument("status", choices=sorted(STATUSES))
    args = parser.parse_args(argv)
    if args.command == "ingest":
        rows, added, total = import_items(args.source, args.state, adapter=args.adapter, platform=args.platform)
        print(f"Read {rows} rows; added {added} new items; now tracking {total} distinct saves.")
    elif args.command == "list":
        state = load_state(args.state)
        for item in state["items"]:
            context = "context" if item.get("content") or item.get("note") else "needs text"
            print(f"{item['id']}  {item.get('platform', 'linkedin'):10}  {item['kind']:10}  {item['status']:6}  {context:10}  {item.get('title') or item['url']}")
        print(f"Total: {len(state['items'])}; kinds: {dict(Counter(i['kind'] for i in state['items']))}")
    elif args.command == "attach":
        attach(args)
    elif args.command == "prompt":
        if args.limit < 1:
            raise ValueError("--limit must be >= 1")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(triage_prompt(load_state(args.state), args.limit), encoding="utf-8")
        print(f"Wrote ChatGPT triage prompt: {args.out}")
    elif args.command == "apply":
        print(f"Applied triage for {apply_triage(args.file, args.state)} items.")
    elif args.command == "plan":
        if args.hours <= 0:
            raise ValueError("--hours must be positive")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(create_plan(load_state(args.state), args.hours), encoding="utf-8")
        print(f"Wrote sprint plan: {args.out}")
    elif args.command == "issues":
        print(f"Wrote {export_issues(load_state(args.state), args.out)} draft issues in {args.out}.")
    elif args.command == "status":
        state = load_state(args.state)
        item = select_item(state, args.item)
        item["status"] = args.status
        save_state(args.state, state)
        print(f"Updated {item['id']} to {item['status']}.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, json.JSONDecodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)
