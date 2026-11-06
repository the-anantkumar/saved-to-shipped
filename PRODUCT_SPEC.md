# Saved to Shipped: open-source developer workbench

**Problem:** developers save useful LinkedIn content but face too much work to recover, organize, and act on it.

**Product promise:** run locally, provide a hosted extractor key, import an official saved archive, retrieve available content, and review a small set of useful projects and tasks.

**First useful result:** readable recovered content and an actionable draft without manually transcribing posts.

## Primary journey

1. Launch from a source checkout or installed command; the browser opens automatically.
2. Import a LinkedIn ZIP or Saved Items CSV.
3. Configure a hosted extractor key in Settings. AI key and goals are optional.
4. Start a small retrieval run with a spending cap, then process more saves when satisfied.
5. See recovered text, titles/excerpts, authors, source links, and coverage. Unavailable results stay visible.
6. Classify with offline rules, optional AI, or ChatGPT copy/paste. Group related ideas into projects.
7. Review first actions, done conditions, estimates, and project assignments before marking tasks Ready.
8. Track work, plan a realistic week, export, and attach actual shipped outcomes.

## Acceptance criteria

| Requirement | Evidence |
| --- | --- |
| No application account or runtime dependency installation | Source launcher uses Python standard library and opens the local browser |
| Installable distribution | Namespaced package, console commands, bundled assets, installed smoke test outside the checkout |
| Hosted setup | Local Settings UI, environment overrides, credential-free doctor output |
| Archive compatibility | Original and suffixed filenames, both known header formats, nested files, malformed/ambiguous cases |
| Useful content retrieval | Hosted actor integration matches output to requested sources and preserves edits |
| Resumability | Stored run/dataset IDs are checked after refresh/restart without a new submission |
| Controlled spending | User-selected run size and per-run provider charge cap; no paid work on import/settings save |
| Honest evidence | Gated/deleted/missing/error/partial statuses; no classification from URL/title alone |
| Complete review loop | Project groups, concrete tasks, ready/doing/done/parked, sprint and exports |
| Open-source maintenance | MIT license, contribution guide, synthetic fixtures, packaging and provider tests |

## Current verification

A real LinkedIn archive passed import, repeat import, annotation preservation, and export checks. Hosted setup through retrieval, local classification, review, and export passes HTTP tests with synthetic responses. Browser QA covers key setup and automatic result display. Installed-package startup and assets are tested outside the source checkout.

A ten-post live Apify dataset matched saved links and supplied readable text. Five results have partial media coverage. Live OpenAI classification produced ten review drafts with grouped topics and next actions. A timed-out later submission remained blocked until its outcome was checked. See the [live check and remaining limits](docs/LIVE_CHECK.md).

## Release gates still open

- Validate attachment fidelity and inaccessible posts against live originals, and check new-submission reliability.
- Check actual provider coverage and charges against requested limits.
- Review AI grouping and task quality across larger, varied batches.
- Have a new developer complete setup from the published source version.

Describe the ten-post result with its limits; do not claim general coverage until those checks pass.

## Scope

The default is hosted extraction with a developer-provided key. No LinkedIn session credential is requested. Local rules and ChatGPT copy/paste keep the model provider optional. Data stays local apart from explicitly initiated provider calls.

Public application hosting, collaboration, automatic GitHub publishing, recurring jobs, arbitrary linked-page crawling, and guaranteed image/video/OCR coverage are outside this release. Future source support remains behind importer/provider boundaries.
