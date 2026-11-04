# Saved → Shipped: V0 Product Spec

**Problem.** Anant bookmarks content across LinkedIn, Reddit, Instagram and eventually other sources, but those collections have low retrieval value and do not reliably translate into shipped work.

**North star.** Number of saved ideas converted into meaningful, verifiable outcomes (a working feature or PR, a short learning experiment, or an attended/applied-for experience) per month.

## Users and jobs

- **Collector:** Import historical saves, re-import without duplication, see source links.
- **Builder:** Pick a high-value first action and get a small, testable commit.
- **Learner:** Turn an article into a practical explanation or experiment, not just another reading queue.
- **Explorer:** Surface time-sensitive opportunities and experiences before they expire.

## P0 requirements

| Requirement | Acceptance test |
| --- | --- |
| Import each source format | LinkedIn CSV/ZIP, Reddit saved-listing JSON, generic CSV/JSON manifests import without credentials |
| Keep sources separate | Every save records its platform, canonical URL and optional provider metadata |
| Deduplicate | Second import adds zero duplicates and retains notes |
| No source hallucinations | A URL-only item remains `untriaged` until context is supplied |
| Human-readable triage | ChatGPT prompt contains content-backed items and separate `needs-context` list |
| Actionable output | Each classified project has ≤2h next action and testable done condition |
| GitHub handoff | Draft issue Markdown references inspiration link; no external write |
| Review loop | Ready / doing / done / parked statuses survive re-import |

## Data shape

Each item has: stable platform-and-URL-derived ID (with legacy LinkedIn ID compatibility), platform, original external ID, canonical URL, saved date, optional supplied title/text/note, author, provider metadata, kind, status, impact/relevance/novelty scores, first-action effort, next action, done condition, suggested repo/commit, confidence, and tags.

## Pipeline

`Source-specific import → normalized save → deduplicated store → context-backed ChatGPT classification → scored queue → first-action sprint → reviewed GitHub issues → verified completed work`

The first release intentionally has a human-in-the-loop step. LinkedIn's official archive describes **Saved Items** as saved dates and URLs, and automated scraping/browser extensions are prohibited by its help and terms. Reddit requires careful treatment of saved-item authorization and API limits; Instagram native export parsing is unverified. A full unattended crawler is not a reasonable MVP dependency.

## Ranking

Candidates are sorted by:

`2 × relevance + 1.5 × impact + novelty − 0.35 × first-action hours − uncertainty penalty`

The ranking only considers items with contextual support. Projects are selected to fit the user's weekly hours; the default is six hours. The final decision stays with Anant.

## Out of scope for V0

- Automatically logging in to social platforms, scraping saved feeds, or bypassing access controls.
- Fetching arbitrary private post bodies from URLs.
- Automatically committing to GitHub or creating issues without a chosen repository and explicit approval.
- AI judging content it cannot observe.
- Creating reminders or automations before the desired schedule is established.

## Iteration criteria

Try a batch of 20 real saves. If ≥10 can be provided with usable context and ChatGPT can produce ≥3 credible ideas, pick one and ship the first commit. Measure time from import to first action. Optimize only the bottleneck observed in that test.
