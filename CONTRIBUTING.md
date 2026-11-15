# Contributing

Help a developer get from an export to a useful next step with less work.

For agent-assisted development, use a Git checkout and start with its root `AGENTS.md` and the [agent workflow](docs/AGENT_WORKFLOW.md). Project-scoped roles and skills live in `.codex/agents/` and `.agents/skills/`; they inherit your model and permissions. Hosted work follows the acceptance criteria in [the production plan](docs/PRODUCTION_PLAN.md). These development tools do not add application runtime dependencies and are not included in package archives.

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

Hosted development requires a Git checkout, Node 24 and its own dependency install. From `hosted/`, run `npm ci`, `npm run typecheck` and `npm test`. Install the pinned Chromium with `PLAYWRIGHT_BROWSERS_PATH=.local/playwright npx playwright install chromium`, then run `PLAYWRIGHT_BROWSERS_PATH=.local/playwright npm run test:e2e`. `npm run uat` starts a disposable acceptance-test workspace with visible account controls, sample content and mocked providers. Follow [the UAT checklist](docs/UAT.md); `npm run test:uat` checks those controls automatically. `npm run test:product` covers the return flow and selected retrieval; `npm run test:billing-ui` covers checkout and cancellation with mocked payments. `npm run release:check` builds the closed application and verifies artifact boundaries without deploying. See the [hosted README](hosted/README.md) for capacity experiments and their limits. No cloud account or real provider key is needed for these checks.

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

For security-sensitive reports, follow [SECURITY.md](SECURITY.md) rather than posting details in a public bug report.

## Release gates

Automated tests and a successful demo are necessary but do not prove a third-party actor's live behavior. Before a release promises automated retrieval, run a small real batch, inspect text and media coverage, confirm unavailable outcomes and charges, and complete setup from a clean developer environment. Model classification needs its own live quality check.

Contributions are licensed under this repository's MIT license.
