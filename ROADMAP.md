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

## Before calling hosted retrieval release-ready

- [ ] Run the default actor on 10 representative real saved links
- [ ] Inspect recovered text and attachment coverage against the originals
- [ ] Confirm inaccessible results, account limits, and actual charges
- [ ] Make a live optional model request and judge whether its project groups are useful
- [ ] Run a fresh-developer setup trial from the version intended for publication

## Next useful improvements

- [ ] Additional extractor adapters backed by tested schemas and real samples
- [ ] Better attachment and linked-article coverage with explicit limits
- [ ] Semantic clustering across saves before selecting project tasks
- [ ] Import/export of enrichment datasets for developers who already have extracted content
- [ ] Release tags and package publication after the live checks
- [ ] Native Reddit/Instagram archive adapters once a real fixture is available
