"""Hosted LinkedIn content retrieval with persisted, resumable Apify runs.

Contracts:
https://docs.apify.com/api/v2/actors-runs-post
https://apify.com/data_minds/linkedin-post-scraper
"""

from __future__ import annotations

import json
import math
import re
import threading
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from . import workbench as work
from .core import canonical_url, save_state
from .settings import DEFAULT_ACTOR, Settings

ACTIVE = {"STARTING", "READY", "RUNNING", "TIMING-OUT", "ABORTING", "UNCERTAIN", "RESULT_ERROR"}
TERMINAL = {"SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"}


class ProviderError(ValueError):
    def __init__(self, message: str, *, uncertain: bool = False):
        super().__init__(message)
        self.uncertain = uncertain


class Apify:
    def __init__(self, settings: Settings):
        self.token = settings.get("apify_token")
        self.actor = settings.get("actor", DEFAULT_ACTOR)
        if not self.token:
            raise ProviderError("Add your Apify API token in Settings before retrieving posts.")
        if not re.fullmatch(r"[\w-]+/[\w-]+", self.actor):
            raise ProviderError("APIFY_ACTOR must use the owner/actor-name format.")

    def request(self, route: str, payload=None, *, starting=False):
        request = Request("https://api.apify.com/v2" + route,
                          data=None if payload is None else json.dumps(payload).encode(),
                          headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"},
                          method="GET" if payload is None else "POST")
        try:
            with urlopen(request, timeout=30) as response:
                # Bound unexpected provider responses, and never expose their raw body.
                raw = response.read(16 * 1024 * 1024 + 1)
                if len(raw) > 16 * 1024 * 1024:
                    raise ValueError("Response too large")
                return json.loads(raw)
        except HTTPError as error:
            messages = {401: "Apify rejected the token. Check it in Settings.",
                        403: "Apify denied this run. Check actor access, permissions, and account credit.",
                        402: "Apify requires account credit for this run.",
                        429: "Apify is rate limiting requests. Wait before checking again."}
            raise ProviderError(messages.get(error.code, f"Apify returned HTTP {error.code}. Check your run in the Apify console."),
                                uncertain=starting and error.code >= 500) from None
        except (URLError, OSError, TimeoutError, ValueError):
            raise ProviderError("Apify did not return a readable response. Check the connection and your Apify console.", uncertain=starting) from None

    def start(self, urls: list[str], max_charge: float) -> dict:
        params = urlencode({"maxTotalChargeUsd": max_charge, "maxItems": len(urls),
                            "timeout": 1800, "restartOnError": "false"})
        result = self.request(f"/actors/{self.actor.replace('/', '~')}/runs?{params}", {
            "urls": urls, "limitPerSource": 1, "discoverMorePosts": False,
            "includeProfileActivity": False, "deepScrape": True,
            "numComments": 0, "numLikes": 0, "includeGated": True,
            "saveMedia": False, "fetchDocumentDetails": True,
        }, starting=True)
        return self.run_data(result, starting=True)

    @staticmethod
    def run_data(result, *, starting=False) -> dict:
        run = result.get("data") if isinstance(result, dict) else None
        if not isinstance(run, dict) or not isinstance(run.get("id"), str) or not re.fullmatch(r"[\w-]+", run["id"]):
            raise ProviderError("Apify returned an invalid run reference. Check the console before starting another run.", uncertain=starting)
        if not isinstance(run.get("status"), str) or run["status"] not in ACTIVE | TERMINAL:
            raise ProviderError("Apify returned an unknown run status. Check the console.", uncertain=starting)
        dataset = run.get("defaultDatasetId", "")
        if dataset and (not isinstance(dataset, str) or not re.fullmatch(r"[\w-]+", dataset)):
            raise ProviderError("Apify returned an invalid dataset reference.", uncertain=starting)
        return run

    def poll(self, run_id: str) -> dict:
        return self.run_data(self.request(f"/actor-runs/{run_id}"))

    def stop(self, run_id: str) -> dict:
        return self.run_data(self.request(f"/actor-runs/{run_id}/abort", {}))

    def items(self, dataset_id: str) -> list[dict]:
        result = []
        for offset in range(0, 5000, 100):
            page = self.request(f"/datasets/{dataset_id}/items?clean=true&limit=100&offset={offset}")
            if not isinstance(page, list) or any(not isinstance(row, dict) for row in page):
                raise ProviderError("Apify returned an unexpected dataset. Your existing saves were preserved.")
            result.extend(page)
            if len(page) < 100:
                return result
        raise ProviderError("The provider dataset exceeded the supported size. Your existing saves were preserved.")


def post_key(value) -> str:
    if not isinstance(value, (str, int)) or isinstance(value, bool):
        return ""
    value = str(value).strip()
    if value.startswith(("http://", "https://")):
        host = urlsplit(value).hostname or ""
        if host != "linkedin.com" and not host.endswith(".linkedin.com"):
            return ""
    match = re.search(r"(?:activity[:\-])(\d+)", value)
    if match:
        return "activity:" + match.group(1)
    if value.isdigit():
        return "activity:" + value
    try:
        return canonical_url(value)
    except ValueError:
        return ""


def record_keys(record: dict) -> set[str]:
    values = [record.get(key) for key in ("url", "shareUrl", "activityId", "urn", "_source")]
    source = record.get("_source")
    if isinstance(source, dict):
        values.extend(source.get(key) for key in ("url", "inputUrl", "sourceUrl"))
    return {key for value in values if (key := post_key(value))}


def eligible(item: dict, retry: bool = False) -> bool:
    parsed = urlsplit(item["url"])
    host = parsed.hostname or ""
    if item.get("platform") != "linkedin" or (host != "linkedin.com" and not host.endswith(".linkedin.com")):
        return False
    if not parsed.path.startswith(("/feed/update/", "/posts/", "/pulse/")):
        return False
    if item.get("content", "").strip() or item.get("status") in {"parked", "done"}:
        return False
    status = item.get("enrichment", {}).get("status", "new")
    return status in ({"error", "missing", "gated", "deleted", "empty"} if retry else {"new"})


def apply_results(state: dict, job: dict, records: list[dict]) -> dict:
    targets = {item["id"]: item for item in state["items"] if item["id"] in job["item_ids"]}
    by_key = {}
    for ident, item in targets.items():
        by_key.setdefault(post_key(item["url"]), set()).add(ident)
    grouped = {ident: [] for ident in targets}
    for record in records:
        matches = record_keys(record) & by_key.keys()
        if len(matches) == 1:
            for ident in by_key[next(iter(matches))]:
                grouped[ident].append(record)
    counts = {"extracted": 0, "partial": 0, "gated": 0, "deleted": 0, "empty": 0, "error": 0, "missing": 0, "preserved": 0}
    for ident, item in targets.items():
        # An edit made while a hosted job was running always wins.
        if item.get("content", "").strip():
            counts["preserved"] += 1
            continue
        options = grouped[ident]
        record = next((row for row in options if row.get("_status", "ok") == "ok" and isinstance(row.get("text"), str) and row["text"].strip()), options[0] if options else {})
        status = record.get("_status", "ok") if record else "missing"
        if not isinstance(status, str) or status not in {"ok", "gated", "deleted", "error", "missing"}:
            status = "error"
        body = record.get("text", "")
        if not isinstance(body, str):
            body = ""
        body = body.strip()
        # Login wall text is not a recovered post.
        if body.lower().startswith(("sign in to linkedin", "join linkedin", "log in to linkedin")):
            status = "gated"
        metadata = {"status": status, "provider": "apify", "actor": job["actor"],
                    "run_id": job["run_id"], "retrieved_at": work.now()}
        if status == "ok":
            media = record.get("media") if isinstance(record.get("media"), dict) else {}
            document = media.get("document") if isinstance(media.get("document"), dict) else {}
            transcript = document.get("transcript")
            transcript = transcript.strip() if isinstance(transcript, str) else ""
            if transcript:
                body += "\n\nDocument transcript:\n" + transcript
            if not body.strip():
                status = "empty"
            else:
                metadata["content_truncated"] = len(body) > 20000
                item["content"] = body[:20000]
                if not item.get("title"):
                    item["title"] = record.get("title", "")[:300] if isinstance(record.get("title"), str) and record["title"].strip() else body.splitlines()[0][:100]
                author = record.get("author")
                name = author.get("name", "") if isinstance(author, dict) else author
                if not item.get("author") and isinstance(name, str):
                    item["author"] = name[:300]
                links = record.get("links", [])
                safe_links = []
                for link in links[:30] if isinstance(links, list) else []:
                    value = link.get("url", "") if isinstance(link, dict) else link
                    try:
                        if isinstance(value, str):
                            safe_links.append(canonical_url(value))
                    except ValueError:
                        continue
                metadata["links"] = safe_links
                metadata["coverage"] = "post text and supplied document transcript" if transcript else "post text only"
                status = "partial" if (document and not transcript) or record.get("postType") in {"image", "video"} or metadata["content_truncated"] else "extracted"
        metadata["status"] = status
        item["enrichment"] = metadata
        counts[status] += 1
    return counts


class Retrieval:
    def __init__(self, state_path: Path, settings: Settings, lock: threading.RLock):
        self.path, self.settings, self.lock = state_path, settings, lock
        self.poll_lock = threading.Lock()
        self.submitting = False

    def start(self, *, limit: int = 10, max_charge: float = 1, retry: bool = False) -> dict:
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 1000:
            raise ValueError("Choose between 1 and 1000 saves per run")
        if isinstance(max_charge, bool) or not isinstance(max_charge, (int, float)) or not math.isfinite(max_charge) or not 0.01 <= max_charge <= 20:
            raise ValueError("Set a per-run spending limit between $0.01 and $20")
        if not isinstance(retry, bool):
            raise ValueError("Retry must be true or false")
        client = Apify(self.settings)
        with self.lock:
            state = work.read(self.path)
            if any(job["status"] in ACTIVE or (job.get("run_id") and not job.get("applied_at")) for job in state.get("retrieval_jobs", [])):
                raise ValueError("A retrieval run is already pending. Check that run before starting another.")
            items = [item for item in state["items"] if eligible(item, retry)][:limit]
            if not items:
                raise ValueError("No matching saves need retrieval. Import an archive first, or choose Retry unavailable.")
            job = {"id": uuid.uuid4().hex[:12], "status": "STARTING", "actor": client.actor,
                   "item_ids": [item["id"] for item in items], "total": len(items),
                   "max_charge_usd": max_charge, "created_at": work.now(), "error": ""}
            state.setdefault("retrieval_jobs", []).insert(0, job)
            state["retrieval_jobs"] = state["retrieval_jobs"][:20]
            save_state(self.path, state)
            self.submitting = True
        try:
            urls = {post_key(item["url"]): item["url"] for item in items}
            run = client.start(list(urls.values()), max_charge)
            return self.update_job(job["id"], run_id=run["id"], dataset_id=run.get("defaultDatasetId", ""), status=run["status"])
        except ProviderError as error:
            self.update_job(job["id"], status="UNCERTAIN" if error.uncertain else "FAILED", error=str(error))
            raise
        finally:
            with self.lock:
                self.submitting = False

    def update_job(self, ident: str, **values) -> dict:
        with self.lock:
            state = work.read(self.path)
            job = next(job for job in state["retrieval_jobs"] if job["id"] == ident)
            job.update(values, updated_at=work.now())
            save_state(self.path, state)
            return dict(job)

    def poll(self) -> dict:
        # A browser refresh or second tab cannot apply the same dataset twice.
        if not self.poll_lock.acquire(blocking=False):
            return {"busy": True}
        try:
            return self._poll()
        finally:
            self.poll_lock.release()

    def _poll(self) -> dict:
        with self.lock:
            state = work.read(self.path)
            job = next((dict(job) for job in state.get("retrieval_jobs", []) if job.get("run_id") and not job.get("applied_at")), None)
        if not job:
            return {"idle": True}
        client = Apify(self.settings)
        try:
            run = client.poll(job["run_id"])
            if run["status"] in ACTIVE:
                return self.update_job(job["id"], status=run["status"], error="")
            dataset_id = run.get("defaultDatasetId") or job.get("dataset_id")
            if not dataset_id:
                raise ProviderError("The completed run has no dataset. Inspect it in the Apify console.")
            records = client.items(dataset_id)
            with self.lock:
                state = work.read(self.path)
                current = next(entry for entry in state["retrieval_jobs"] if entry["id"] == job["id"])
                if current.get("applied_at"):
                    return dict(current)
                counts = apply_results(state, {**job, "run_id": run["id"]}, records)
                current.update(status=run["status"], counts=counts, dataset_id=dataset_id,
                               applied_at=work.now(), updated_at=work.now(), error="")
                save_state(self.path, state)
                return dict(current)
        except ProviderError as error:
            self.update_job(job["id"], status="RESULT_ERROR", error=str(error))
            raise

    def dismiss_uncertain(self) -> None:
        with self.lock:
            if self.submitting:
                raise ValueError("The submission is still in progress. Wait for its response before dismissing it.")
            state = work.read(self.path)
            job = next((job for job in state.get("retrieval_jobs", []) if job["status"] in {"UNCERTAIN", "STARTING"} and not job.get("run_id")), None)
            if not job:
                raise ValueError("There is no uncertain submission to dismiss")
            job.update(status="DISMISSED", updated_at=work.now())
            save_state(self.path, state)

    def stop(self) -> dict:
        with self.lock:
            state = work.read(self.path)
            job = next((dict(job) for job in state.get("retrieval_jobs", []) if job.get("run_id") and not job.get("applied_at")), None)
        if not job:
            raise ValueError("There is no pending hosted run")
        run = Apify(self.settings).stop(job["run_id"])
        return self.update_job(job["id"], status=run["status"], error="")
