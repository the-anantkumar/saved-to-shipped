# Saved → Shipped

Turn LinkedIn saves into small projects and a backlog you can actually finish.

A personal, local-first workbench with a saved inbox, project groups, a Ready / In progress / Shipped board, a weekly time budget, and downloadable sprint and GitHub issue drafts. Python standard library, plain HTML/CSS/JavaScript, no install step, no database service, no account system.

## Run it

Requires Python 3.10+ and a modern browser. From this repository:

```bash
python3 server.py
```

Open **http://127.0.0.1:8010/** for your personal workspace, or **http://127.0.0.1:8010/?workspace=demo** for the isolated demo. Stop the server with `Ctrl+C`.

```bash
python3 server.py --port 8011
python3 server.py --state /path/to/private/items.json
```

The demo starts with 12 **synthetic** saves, three project groups, and example tasks at different stages. Its URLs are placeholders, not real posts. Demo changes go to `data/demo/items.json`; personal saves go to `data/items.json`. Both survive a restart and are ignored by Git.

## While your LinkedIn archive is pending

- Explore the demo, review a task, change its status, and download the sprint.
- Use **Add a save** to capture a real LinkedIn URL with pasted post text or your own note.
- Open **Import archive** and download the synthetic test ZIP to exercise the importer. Import it into the demo to keep your personal workspace clean.

Nothing needs a LinkedIn login, browser extension, API key, or paid service to try.

## With your real archive

1. Request **Saved Items** from LinkedIn desktop: **Settings & Privacy → Data Privacy → Download your data**. [Official LinkedIn instructions](https://www.linkedin.com/help/linkedin/answer/a1341346).
2. Choose **Import archive** and upload the ZIP or its `Saved_Items.csv`. Nested folders, UTF-8 BOMs, and common filename/header variations are supported. Only the Saved Items CSV is read; unrelated archive files are ignored.
3. Open a saved idea. Paste relevant post text or describe why you saved it in **Your note**. Save the changes.
4. Choose **Classify inbox**, then use local suggestions, optional OpenAI classification, or the ChatGPT copy/paste route.
5. Review each draft. Edit its project, destination, first action, done condition, and estimate. Change **Status** to **Ready** to put it on the backlog.
6. Move work to **In progress**, then **Shipped**. Attach the real commit, PR, or result URL when you have one.
7. Set your hours in **This week** and export the plan.

**The key limitation:** [LinkedIn documents Saved Items as saved dates and URLs](https://www.linkedin.com/help/linkedin/answer/a1341346), not the bodies of other people's posts. Importing a ZIP cannot supply that missing content. URL-only saves remain unclassified, regardless of their titles or URL slugs. This version reads exports and user-supplied context; it does not crawl LinkedIn or automatically retrieve saved post bodies.

Re-importing is safe: duplicate links are skipped, while notes, classifications, project assignments, and task statuses stay intact. Invalid archives or malformed CSV rows produce an error without partially importing the batch. Uploads are limited to 128 MiB; the uncompressed Saved Items CSV to 8 MiB. For larger archives, import that CSV directly.

## Three classification options

| Option | Setup | Behavior |
| --- | --- | --- |
| Local suggestions | None | Transparent keyword rules, three broad project themes, and generic starter actions. Runs offline. Every suggestion is labeled low confidence. |
| OpenAI | Your API key | Context-specific drafts and project grouping for up to 20 unclassified inbox saves per click. |
| ChatGPT copy/paste | Your existing ChatGPT access | Download the prompt, paste it into ChatGPT, then paste the returned JSON into the workbench. |

All web classifications remain in the inbox for review. Neither local rules nor an LLM automatically starts a task. Title-only and URL-only saves are excluded. To classify a previously reviewed item again, set its destination to **Not classified** and status to **Inbox / review** first.

Optional OpenAI setup:

```bash
export OPENAI_API_KEY='your-key'
export OPENAI_MODEL='gpt-4.1-mini'  # optional override
python3 server.py
```

The app does **not** load `.env` automatically. [.env.example](.env.example) documents the variables. Keep your real key out of Git.

The **Send batch to OpenAI** button explicitly sends the eligible batch's IDs, titles, supplied post text, notes, and existing project names to OpenAI. It never sends the ZIP, unrelated archive records, or browser credentials. API usage is billed to your key. The client uses the [Responses API with strict structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and `store: false`; provider policies still apply. There are no automatic calls, retries, or silent fallbacks. Provider errors, missing IDs, duplicate IDs, invalid fields, and unsupported classifications leave saved state unchanged.

## Exports and storage

**Export backlog** downloads one ZIP containing:

- `backlog.json`: full workspace data for backup.
- `backlog.csv`: portable task table with project names, estimates, source links, and result links.
- `weekly_sprint.md`: up to two reviewed build tasks fitting your time budget, plus optional learning and experience suggestions.
- `issues/*.md`: local GitHub issue drafts for ready or in-progress build tasks. Nothing is published to GitHub.

State is stored as atomically replaced JSON. Project assignments use stable project IDs. The existing CLI and the browser share the same personal state format. Stop the server before changing that file with the CLI or restoring `backlog.json` to `data/items.json`; separate processes do not share a write lock. Keep private backups outside the repository.

The HTTP server listens only on `127.0.0.1`, validates its Host header, and requires a per-run token for writes. This is a single-user development app, not a production server or a public deployment.

## CLI

The original CLI remains available:

```bash
python3 saved_to_shipped.py ingest /path/to/LinkedInDataExport.zip
python3 saved_to_shipped.py list
python3 saved_to_shipped.py attach ITEM_ID --title 'An idea' --content-file post.txt --note 'Why this helps'
python3 saved_to_shipped.py prompt
python3 saved_to_shipped.py apply triage.json
python3 saved_to_shipped.py plan --hours 6
python3 saved_to_shipped.py issues
python3 saved_to_shipped.py status ITEM_ID done
```

Use a real ID from `list`. Unlike the web review flow, explicitly applying CLI triage marks actionable inbox items Ready. `data/`, `output/`, ZIPs, and `.env` files are ignored by Git.

The inherited source adapters remain tested for future extension: `--adapter reddit` reads a user-provided saved-listing JSON, `--adapter instagram` reads a normalized manifest, and `--adapter manifest` reads platform-tagged CSV/JSON. The web workbench intentionally accepts only LinkedIn input. Native Reddit/Instagram capture is deferred.

## Development and verification

```bash
python3 -m unittest discover -s tests -v
node --check web/app.js  # optional local JS syntax check; Node is not needed to run the app
```

The suite covers archive parsing, dedupe, state preservation, context requirements, classification validation, task lifecycle, project grouping, exports, HTTP boundaries, and separate demo storage. OpenAI success/failure responses are mocked; tests never spend API credits or access LinkedIn. GitHub Actions runs Python 3.10 and 3.12 tests plus the JavaScript syntax check.

The app has been rendered and inspected in Safari. The real LinkedIn archive and a live OpenAI request still need a smoke test with your own data and key. See [docs/DEMO.md](docs/DEMO.md) for a short walkthrough and [ARCHITECTURE.md](ARCHITECTURE.md) for the implementation.

## Development checkpoints

Work lives on `feat/linkedin-workbench`, branched from `main`:

1. `6c013bd`: robust archive imports and synthetic fixtures.
2. `de76b57`: local web workbench, projects, and backlog.
3. `99c1988`: optional AI triage and full workflow validation.
4. Documentation and CI handoff: setup, demo, architecture, and current scope.

Use `git log --oneline` to inspect the checkpoints. Commit messages contain no em dashes.
