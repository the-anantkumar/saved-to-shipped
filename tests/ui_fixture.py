"""Opt-in browser QA server. Synthetic saves and mocked hosted responses only."""

import io
import json
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

from saved_to_shipped import new_item, save_state
from saved_to_shipped.server import WorkbenchServer


def provider_response(request, timeout=30):
    run = {"id": "fixture-run", "status": "RUNNING", "defaultDatasetId": "fixture-dataset"}
    if "/actors/" in request.full_url:
        result = {"data": run}
    elif "/actor-runs/" in request.full_url:
        result = {"data": {**run, "status": "SUCCEEDED"}}
    else:
        result = [{"url": "https://www.linkedin.com/feed/update/urn:li:activity:123", "_status": "ok",
                   "text": "Build a local Python CLI that summarizes an expense CSV and checks category totals.",
                   "author": {"name": "Synthetic author"}},
                  {"activityId": "456", "_status": "ok", "postType": "image",
                   "text": "Learn how a database index changes query execution. Compare one query before and after an index, and record the result.",
                   "author": {"name": "Synthetic database author"}},
                  {"activityId": "789", "_status": "gated"}]
    return io.BytesIO(json.dumps(result).encode())


with tempfile.TemporaryDirectory() as folder:
    path = Path(folder) / "items.json"
    save_state(path, {"version": 1, "items": [new_item(f"https://www.linkedin.com/feed/update/urn:li:activity:{ident}", "2026-11-01") for ident in (123, 456, 789)]})
    server = WorkbenchServer(("127.0.0.1", 8011), path)
    with patch.dict(os.environ, {}, clear=True), patch("saved_to_shipped.enrichment.urlopen", side_effect=provider_response):
        print("Synthetic UI QA: http://127.0.0.1:8011/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
