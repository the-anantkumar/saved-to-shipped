# Contributing

Help a developer get from an export to a useful next step with less work.

## Run locally

Use Python 3.10+ from the repository:

```bash
python3 server.py
```

For installed-command development, create a virtual environment and run `python -m pip install -e .`. The source launchers and installed entry points use the same namespaced implementation.

## Verify a change

```bash
python3 -m unittest discover -s tests -v
node --check saved_to_shipped/web/app.js
node --check saved_to_shipped/web/onboarding.js
```

After packaging or asset changes, install a regular wheel build into an isolated environment with `python -m pip install .`, then run `python tests/smoke_installed.py` with that environment's Python. The smoke test starts the installed app outside this checkout and checks all browser assets and the state endpoint.

For browser QA without an account or charge:

```bash
python3 -m tests.ui_fixture
```

Open http://127.0.0.1:8011/. This server uses temporary synthetic saves and mocked Apify responses. Any nonempty test token works in its Settings. It makes no provider calls. Stop it with Ctrl+C; its temporary workspace is removed.

## Fixtures and provider adapters

Use synthetic URLs and text in tests. Never commit a personal archive, notes, messages, API token, or authenticated browser state. File names and headers can be reproduced without including real account identifiers or post contents.

Keep source import separate from remote enrichment. A provider adapter needs a documented input/output contract, deterministic source matching, bounded requests, explicit unavailable/partial outcomes, and tests for failures and retries. Avoid work that silently creates additional paid submissions.

Preserve user edits on repeat imports and during hosted work. New state fields must load safely when absent from older version-1 stores. Key storage must remain separate from the exportable workspace.

## Reporting bugs

Include the app version, Python/OS version, the step that failed, and a redacted error. For archive-format issues, include only the column names and a synthetic example. Do not attach the real ZIP or provider keys to public issues.

## Release gates

Automated tests and a successful demo are necessary but do not prove a third-party actor's live behavior. Before a release promises automated retrieval, run a small real batch, inspect text and media coverage, confirm unavailable outcomes and charges, and complete setup from a clean developer environment. Model classification needs its own live quality check.

Contributions are licensed under this repository's MIT license.
