# Roadmap

The goal is a useful first result with little setup, followed by a small piece of work actually shipped.

## Implemented

- [x] LinkedIn ZIP/CSV import, including a verified real export format
- [x] Deduplication and annotation/status preservation
- [x] Namespaced installable package, console commands, browser launch, and doctor command
- [x] MIT license and contributor documentation
- [x] Private local settings with optional environment overrides
- [x] Hosted Apify retrieval adapter with explicit run size and charge cap
- [x] Persisted run references, resume, stop, explicit retry, and uncertain-submission handling
- [x] Source matching, cached post text, author, links, document transcripts when supplied, and coverage status
- [x] Import/retrieve/classify guidance and paginated inbox rendering
- [x] Optional model key, generic goals, batch classification, local rules, and copy/paste route
- [x] Project review, backlog, weekly plan, and private exports
- [x] Synthetic provider/HTTP tests and installed-package smoke test
- [x] Separate project board, Learning and Experiences libraries, reading progress, and takeaways
- [x] Inline creation of projects, learning topics, and experience sections
- [x] Persistent light/dark/system appearance and board drag selection fixes
- [x] Wheel/source-archive content checks, modern license metadata, single-source version, and clean-install/restart checks
- [x] CI configuration for Linux, macOS, and Windows with pinned actions and reviewable build artifacts

The organizing experience is checkpointed at `checkpoint/organizing-ux-2026-11-07`. Release hardening continues on `feat/oss-release-readiness`; [RELEASING.md](docs/RELEASING.md) records the sequence and remaining evidence.

## Capped hosted beta

The [production execution plan](docs/PRODUCTION_PLAN.md) defines the next implementation phases. The hosted target is 500 members with 1,000 saves and 5 MB of user data each, on hard-free infrastructure. Hosting and these limits are not implemented yet; admission depends on real runtime and capacity evidence. Local use remains account-free.

- [ ] P1: Prove the Worker and per-user SQLite runtime and capacity model
- [ ] P2: Implement storage contracts, ownership boundaries and quotas
- [ ] P3: Add Google sessions, atomic membership and account deletion
- [ ] P4: Integrate hosted imports, organisation and reading
- [ ] P5: Add bounded durable retrieval and optional classification
- [ ] P6: Verify isolation, usage limits, restore and rollback
- [ ] P7: Publish reviewed artifacts and admit measured cohorts

## Before calling hosted retrieval release-ready

- [x] Check a ten-post live dataset from the default actor against real saved links
- [ ] Inspect recovered text and attachment coverage against the originals
- [ ] Confirm inaccessible results, account limits, and actual charges
- [x] Make live optional model requests and review small-batch groups and tasks
- [ ] Verify new-submission reliability and grouping across larger, varied batches
- [ ] Run a fresh-developer setup trial from the version intended for publication

## Next useful improvements

- [ ] Additional extractor adapters backed by tested schemas and real samples
- [ ] Better attachment and linked-article coverage with explicit limits
- [ ] Semantic clustering across saves before selecting project tasks
- [ ] Import/export of enrichment datasets for developers who already have extracted content
- [ ] Release tags and package publication after the live checks
- [ ] Native Reddit/Instagram archive adapters once a real fixture is available
