# Roadmap: From bookmarks to a personal execution engine

The north star is **meaningful projects shipped per month**, not the size of the backlog.

## Milestone 1 — Reliable inbox (current)

- [x] Official LinkedIn Saved Items archive importer
- [x] Reddit user-supplied saved-listing JSON importer
- [x] Instagram/general normalized manifest importer
- [x] Per-platform stable identity, deduplication and state preservation
- [x] Source-aware ChatGPT triage and local issue drafts
- [x] Regression tests and GitHub CI
- [ ] Test with 20 real LinkedIn saves and 10 real Reddit/Instagram saves

## Milestone 2 — Low-friction capture

- [ ] Study the real native Instagram export and create a tested parser where permitted
- [ ] Add a user-controlled share-to-inbox action for iOS and Android
- [ ] Accept screenshot/PDF batches with OCR and provenance
- [ ] Import Reddit account archives if a stable saved-items file is included
- [ ] Show missing-content status and capture progress
- [ ] Detect identical ideas even when they come from different platforms

## Milestone 3 — An AI that actually prioritizes

- [ ] Optional direct model classification with structured outputs (user-configured key)
- [ ] Project / knowledge / experience taxonomy with evidence confidence
- [ ] Rank by personal goals, available time, novelty and tangible utility
- [ ] Cluster recurring themes; identify "you saved this idea six times"
- [ ] Time-sensitive opportunity checks for hackathons and events
- [ ] Human approval before moving anything into this week's sprint

## Milestone 4 — Shipped outcomes

- [ ] GitHub OAuth/connected integration with repository selection
- [ ] Create issue on explicit approval, with source and acceptance tests
- [ ] Optional draft PR / starter skeleton / test scaffolding
- [ ] Link real commit or PR URLs to source saves
- [ ] Weekly review of built/learned/done/parked items
- [ ] No vanity commits: measure working changes and demonstrated learning

## Milestone 5 — Productize if it proves useful

- [ ] Replace local JSON with SQLite, migrations and encrypted backup options
- [ ] Web UI: Inbox / Build / Learn / Experience / This Week / Shipped
- [ ] Sync and export across devices without leaking private saves
- [ ] Provider health monitoring, rate-limit and permissions diagnostics
- [ ] Optional recurring review reminders

## Suggested first issues

1. **Fixture-driven Instagram export research:** identify the actual user data files; avoid assumptions and ship parser tests.
2. **Capture context in batches:** ingest screenshots and attach provenance to source URLs.
3. **Cross-platform duplicate clustering:** several saved posts about the same tool become one project candidate.
4. **GitHub issue publishing:** select repo and confirm before each batch write.
5. **Command-line `review`:** record links to actual commits and what was learned.
