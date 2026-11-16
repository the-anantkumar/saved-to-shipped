# Contributing

Small fixes to importing, reading and returning to saved ideas are welcome. Start with the [roadmap](ROADMAP.md) or open an issue describing the problem you want to solve.

## Branches and pull requests

| Branch | Purpose |
| --- | --- |
| `main` | The free, open-source app and its optional hosted implementation. No subscription checkout or paid-only limits. |
| `payment` | Future monetization work, based on the current OSS release. Billing is not enabled yet. |

Create a short-lived branch from the relevant base and open a pull request back to that branch. Include the problem, the resulting behavior and the checks you ran. Keep commits small and use descriptive messages without em dashes.

Put shared product fixes on `main` first, then bring those commits into `payment`. Keep billing changes on `payment`; do not merge that branch wholesale into `main`. Delete a short-lived branch once its pull request is merged or superseded and its useful work is preserved.

The previous payment prototype is archived at the [`checkpoint/paid-subscriptions-2026-11-15` tag](https://github.com/the-anantkumar/saved-to-shipped/tree/refs/tags/checkpoint/paid-subscriptions-2026-11-15) (`da7652b`). Restore any of it through a focused payment pull request, with current tests. The checkpoint predates the OSS polish and data-loss fixes, so it is not a replacement for the current app.

For agent-assisted work, read [AGENTS.md](AGENTS.md) and the [agent workflow](docs/AGENT_WORKFLOW.md). The repository's agent configuration is optional development tooling, excluded from application packages.

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
node --check saved_to_shipped/web/reading.js
node --check saved_to_shipped/web/theme.js
node --test tests/*_behavior.mjs
```

After packaging or asset changes, build both distribution formats and verify them:

```bash
python -m pip install -r requirements-dev.txt
python -m build --outdir dist/candidate
python -m twine check --strict dist/candidate/*
python scripts/check_distribution.py --dist dist/candidate --install
```

Use a fresh output directory. The checker rejects missing assets, mismatched versions, known private files, and unexpected wheel contents. It installs the wheel and source archive into separate temporary environments, then runs the provider-free app flow outside the checkout. This includes commands, organizing, inline section creation, reading, exports, and restart persistence. See [the release guide](docs/RELEASING.md) for evidence and publication steps.

CI runs source tests and an installed-app smoke test on Linux, macOS, and Windows; Linux covers Python 3.10, 3.12, and 3.14. Browser JavaScript and distribution checks run in their own jobs. Build tooling is optional and never added to the application's runtime dependencies.

Hosted development requires a Git checkout, Node 24 and its own dependency install. From `hosted/`, run `npm ci`, `npm run typecheck` and `npm test`. Install the pinned Chromium with `PLAYWRIGHT_BROWSERS_PATH=.local/playwright npx playwright install chromium`, then run `PLAYWRIGHT_BROWSERS_PATH=.local/playwright npm run test:e2e`. `npm run uat` starts a disposable acceptance-test workspace with visible account controls, sample content and mocked providers. Follow [the UAT checklist](docs/UAT.md); `npm run test:uat` checks those controls automatically. `npm run test:product` covers the return flow, selected retrieval and absence of paid controls in the free beta. `npm run release:check` builds the closed application and verifies artifact boundaries without deploying. See the [hosted README](hosted/README.md) for capacity experiments and their limits. No cloud account or real provider key is needed for these checks.

From `hosted/`, `node tests/polish-interactions.mjs` checks global keyboard search, dirty-note recovery, failed saves, focus return and delayed retrieval responses in an isolated local workspace. It needs Python 3.10+ as `python3`; set `SAVE2SHIP_TEST_PYTHON` to another interpreter path when needed. The test uses synthetic data and no provider calls.

For browser QA without an account or charge:

```bash
python3 -m tests.ui_fixture
```

Open http://127.0.0.1:8011/. This server uses temporary synthetic saves and mocked Apify responses. Any nonempty test token works in its Settings. It makes no provider calls. Stop it with Ctrl+C; its temporary workspace is removed.

The [free beta](docs/FREE_BETA.md) needs no payment setup. Hosted changes must preserve the storage, identity and quota requirements in the [production plan](docs/PRODUCTION_PLAN.md).

## Fixtures and provider adapters

Use synthetic URLs and text in tests. Never commit a personal archive, notes, messages, API token, or authenticated browser state. File names and headers can be reproduced without including real account identifiers or post contents.

Keep source import separate from remote enrichment. A provider adapter needs a documented input/output contract, deterministic source matching, bounded requests, explicit unavailable/partial outcomes, and tests for failures and retries. Avoid work that silently creates additional paid submissions.

Preserve user edits on repeat imports and during hosted work. New state fields must load safely when absent from older version-1 stores. Key storage must remain separate from the exportable workspace.

## Reporting bugs

Include the app version, Python/OS version, the step that failed, and a redacted error. For archive-format issues, include only the column names and a synthetic example. Do not attach the real ZIP or provider keys to public issues.

For security-sensitive reports, follow [SECURITY.md](SECURITY.md) rather than posting details in a public bug report.

## Release gates

Automated tests and a successful demo are necessary but do not prove a third-party actor's live behavior. Before a release promises automated retrieval, run a small real batch, inspect text and media coverage, confirm unavailable outcomes and charges, and complete setup from a clean developer environment. Model classification needs its own live quality check.

Contributions are licensed under this repository's MIT license.
