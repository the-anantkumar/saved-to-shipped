# Saved → Shipped

**Turn saved LinkedIn ideas into small projects you can finish.**

[![Tests](https://github.com/the-anantkumar/saved-to-shipped/actions/workflows/tests.yml/badge.svg)](https://github.com/the-anantkumar/saved-to-shipped/actions/workflows/tests.yml)
![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)
![Runtime dependencies: standard library](https://img.shields.io/badge/runtime-standard_library-7160df)

Saved → Shipped is a personal workbench for the ideas that usually disappear into a bookmark collection. Bring in your LinkedIn saves, add the context worth keeping, group related ideas into projects, and turn them into a realistic backlog with a clear next action.

It runs on your computer with Python and a browser. The demo and local classification work without an API key. Optional AI classification adds more specific task suggestions when you want it.

> **Before importing:** LinkedIn's Saved Items export contains saved dates and URLs, not other people's post text. Classification needs pasted text or your own note. The archive must contain **Saved Items**, which is different from **Saved Jobs**. See [LinkedIn's export documentation](https://www.linkedin.com/help/linkedin/answer/a1341346).

## Quick start

Requires **Python 3.10+** and a modern browser. There are no packages to install and no frontend build step.

```bash
git clone https://github.com/the-anantkumar/saved-to-shipped.git
cd saved-to-shipped
python3 server.py
```

| Workspace | Address |
| --- | --- |
| Your saves | [http://127.0.0.1:8010/](http://127.0.0.1:8010/) |
| Sample workspace | [http://127.0.0.1:8010/?workspace=demo](http://127.0.0.1:8010/?workspace=demo) |

Stop the server with `Ctrl+C`. To choose a different port or storage location:

```bash
python3 server.py --port 8011
python3 server.py --state /path/to/private/items.json
```

### Try it before importing anything

Open the sample workspace. It starts with 12 synthetic saves, three project groups, and tasks at different stages. These are illustrative examples with placeholder URLs, not scraped posts or claims of completed work.

1. Open a saved idea and inspect its context, first action, estimate, and done condition.
2. Edit the next step and change its status to **Ready** or **In progress**.
3. Open **Backlog** to see it in the corresponding column.
4. Open **This week**, set your available hours, and download the sprint and issue drafts.

For a classification demo, add a note to an item marked **Needs context**, save it, then choose **Classify inbox → Suggest directions locally**. Review the draft before changing its status to Ready.

Demo data lives in a separate store, so experimenting there does not alter your personal saves. [Full demo walkthrough →](docs/DEMO.md)

## What you can do

| View | Purpose |
| --- | --- |
| **Saved inbox** | Import saves, capture a LinkedIn link manually, add context, search, and review classifications. |
| **Projects** | Group related saves around something you want to build or explore. |
| **Backlog** | Track reviewed tasks through Ready, In progress, and Shipped, with a separate Parked section. |
| **This week** | Fit up to two build tasks into your available hours. |
| **Shipped** | Keep completed ideas and attach a result, commit, or PR link. |

Each idea can become a **Build**, **Learn**, **Experience**, **Reference**, or **Skip** item. A project group can contain several related saves; each save keeps its own task details and progress.

## Import your LinkedIn saves

### 1. Get the right export

On LinkedIn desktop, go to **Settings & Privacy → Data Privacy → Download your data** and request an export containing **Saved Items**. [Official instructions →](https://www.linkedin.com/help/linkedin/answer/a1341346)

The importer accepts a ZIP containing one Saved Items CSV, including inside nested folders, or the CSV directly. Common names such as `Saved_Items.csv` and `Saved Items.csv` are recognized.

A minimal example looks like this:

```csv
Date Saved,URL
2026-11-01,https://www.linkedin.com/feed/update/urn:li:activity:1234567890
```

The URL above is illustrative. Only the Saved Items CSV is read from an archive; unrelated account records are not imported.

### 2. Bring it into the inbox

Choose **Import archive** and select the ZIP or CSV. Re-importing the same links skips duplicates and preserves your notes, classifications, project assignments, and task statuses.

You can also use **Add a save** to capture a LinkedIn post or article URL with its text or a personal note. This works while you wait for an export.

### 3. Give the save enough context

Open an idea and paste relevant post text or explain why you saved it. A URL or title by itself does not qualify for classification, even if the URL slug sounds descriptive.

### 4. Review the suggested task

Choose a classification method below, then edit the destination, project assignment, first action, done condition, and estimate. A task needs context, a title, a classification, an action, a finish condition, and a **0.25 to 2 hour** first-action estimate before it can become Ready.

Web classifications stay in the inbox until you review them. Once ready, move the task through the backlog and attach its real outcome when finished.

## Choose how to classify

| Method | Setup | What it produces |
| --- | --- | --- |
| **Local suggestions** | None | Offline keyword rules suggest broad project groups and generic starter actions. Suggestions are labeled low confidence. |
| **OpenAI** | Your API key | Context-specific task drafts and project groups for up to 20 unclassified inbox items per click. |
| **ChatGPT copy/paste** | Your existing ChatGPT access | Download a triage prompt, use it in ChatGPT, then paste the returned JSON into the workbench. |

All three methods rely on the context you supply. Local rules provide a starting point; they do not semantically understand the post. To classify an item again, set its destination to **Not classified** and its status to **Inbox / review** first.

### Optional OpenAI setup

Export your key before starting the server:

```bash
export OPENAI_API_KEY='your-api-key'
export OPENAI_MODEL='gpt-4.1-mini'  # optional; this is the application default
python3 server.py
```

The application does **not** automatically load `.env` files. [.env.example](.env.example) documents the available settings.

The **Send batch to OpenAI** button sends the eligible batch's IDs, titles, supplied post text, notes, and existing project names to OpenAI. The raw ZIP, other archive records, and browser credentials are excluded. API usage is billed to your key. No API request runs automatically.

The client uses the [Responses API with strict structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and `store: false`; provider data policies still apply. Returned IDs and fields are validated before saving. Failed or incomplete batches leave stored data unchanged.

## Export work you can act on

**Export backlog** downloads a ZIP containing:

| File | Contents |
| --- | --- |
| `backlog.json` | Full workspace data for backup. |
| `backlog.csv` | Task table with project names, estimates, source URLs, and outcome links. |
| `weekly_sprint.md` | Up to two reviewed build tasks within your selected time budget, plus optional learning and experience suggestions. |
| `issues/*.md` | GitHub issue drafts for Ready or In progress build tasks, with their source links and acceptance criteria. |

The time budget applies to selected build tasks. Optional learning and experience suggestions are listed separately. Issue drafts remain local files; the application does not publish them to GitHub.

## Storage and privacy

Personal state defaults to `data/items.json`; demo state defaults to `data/demo/items.json`. Both persist across restarts and are ignored by Git, along with `output/`, ZIP archives, and `.env` files. Exported backups contain your notes and supplied text, so store them privately.

The server listens only on `127.0.0.1`. It validates the Host header and requires a per-run token for writes. This is a single-user local application. Public hosting and collaboration are outside the current scope.

Writes replace the state file atomically. The web server serializes its own requests, but the CLI is a separate process. **Stop the server before editing the same state through the CLI or restoring a backup.** To restore, extract `backlog.json` from your export and copy it to your chosen state path while the server is stopped.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| **No Saved_Items.csv found** | Inspect the ZIP for Saved Items. Saved Jobs and Saved Job Alerts are different categories. Check LinkedIn for an export that includes saved posts and articles. |
| **Multiple Saved Items CSVs found** | Select the intended CSV directly instead of uploading the combined ZIP. |
| **Archive is too large** | Uploads are capped at 128 MiB. Import the Saved Items CSV directly; its uncompressed limit is 8 MiB. |
| **Nothing can be classified** | Add post text or a nonblank personal note to an unclassified inbox item. A title alone is insufficient. |
| **Task cannot become Ready** | Fill in its context, title, classification, first action, done condition, and estimate. |
| **OpenAI option is unavailable** | Export `OPENAI_API_KEY`, then restart the server. `.env` is not loaded automatically. |
| **OpenAI request fails** | Check connectivity, key validity, model access, and usage limits. Existing data is preserved. |
| **Port 8010 is in use** | Start with `python3 server.py --port 8011` and use the printed URL. |

You can download a synthetic test ZIP from **Import archive** to check the import flow without using personal data.

## Command-line workflow

The original CLI shares the same state format:

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

Replace `ITEM_ID` with an ID from `list`. The prompt, sprint, and issue drafts are written under `output/` by default. Use `python3 saved_to_shipped.py --help` for commands and `--state` for a separate store.

Explicitly applying CLI triage marks actionable inbox items Ready. The web flow keeps classifications as drafts for review.

## Development

```bash
python3 -m unittest discover -s tests -v
node --check web/app.js
```

Node is only needed for the optional local JavaScript syntax check, not to run the application. GitHub Actions runs the Python suite on 3.10 and 3.12 and checks JavaScript syntax with Node 22.

Tests cover archive parsing, deduplication, annotation preservation, context requirements, classification validation, task transitions, project grouping, exports, HTTP boundaries, and separate demo storage. Provider responses are mocked; the suite does not call LinkedIn or spend API credits.

### Project structure

```text
server.py                Local HTTP server and upload/download endpoints
workbench.py             Capture, projects, review rules, local suggestions, exports
saved_to_shipped.py      CLI, persistence, deduplication, triage validation, sprint planning
classifier.py            Optional OpenAI client
sources/                 Import adapters and normalized record contract
web/                     Browser interface, styles, and interactions
demo_data.py             Synthetic examples for the isolated demo
tests/                   Import, domain, HTTP, and provider-response tests
docs/DEMO.md             Walkthrough and real-data smoke-test checklist
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for data flow and design choices, [PRODUCT_SPEC.md](PRODUCT_SPEC.md) for acceptance criteria, and [ROADMAP.md](ROADMAP.md) for the next steps.

## Current status and scope

The synthetic import-to-backlog flow is tested, and the interface has been exercised in Safari. The first real archive inspected passed ZIP integrity checks but contained no Saved Items file. Missing-file imports were verified to leave both empty and existing workspaces unchanged. **A successful saved-post import from a real archive and a live OpenAI request remain unverified.**

The current web application focuses on LinkedIn exports and manual LinkedIn capture. It does not log in to LinkedIn, crawl the saved feed, or retrieve post bodies automatically.

Existing CLI adapters can read user-provided Reddit saved-listing JSON and normalized Instagram/generic manifests. Native Reddit and Instagram archive support is future work. The source-adapter boundary keeps that extension separate from project review and backlog management.

This is a personal project built around one useful loop: save something worth keeping, decide what to do with it, and finish the next step.
