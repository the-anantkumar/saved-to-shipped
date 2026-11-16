# Changelog

## Unreleased

Future changes will be recorded here after the first free beta.

## 0.4.0b1 · 2026-11-17

First free local beta. The Python runtime has no third-party dependencies, application account, card requirement, subscription or expiry countdown. Publication is tracked separately from these release notes.

### Organize and return

- Import LinkedIn Saved Items ZIP/CSV files with canonical deduplication and preserved annotations on repeat imports.
- Keep Projects, Learning and Experiences separate, with inline section creation and visible empty sections.
- Resume a read or project action through Today, with a clear starting action for unprocessed links and a global Find control.
- Use the project board, keyboard/touch move controls, persistent board ordering and weekly suggestions with a saved time budget.
- Read in a focused view with independent progress, Read next choices and personal notes separate from source text.
- Switch between system, light and dark appearance on desktop or narrow screens, with a calmer type scale, clearer section hierarchy and a consistent Saved to Shipped identity.

### Enrich deliberately

- Retrieve exactly the approved local or hosted post IDs through a user-owned Apify account; reject missing, duplicate or changed selections before submission, with explicit charge approval, source matching, cached results and persisted run recovery.
- Organize context using local rules, optional user-owned OpenAI access, or the copy/paste workflow.
- Keep inaccessible/partial content visible. Saving keys or importing an archive never initiates provider work.
- Export a private v1 workspace backup, CSV backlog, weekly suggestions and local issue drafts; preserve progress after restart.

### Reliability and release preparation

- Fix source text and notes disappearing after queuing an unopened read.
- Prevent page-text selection during tile dragging and preserve unsaved drafts on conflicts.
- Keep dirty notes/source edits until explicit discard; preserve fields after a failed save and restore keyboard focus after successful save.
- Keep delayed manual polling from replacing a newer notes dialog or losing its draft.
- Build and validate wheel/source artifacts, then check both in clean environments outside the checkout.
- Refresh first-use documentation, package metadata/favicon and synthetic desktop/mobile screenshots; record the focused [product polish checks](docs/evidence/PRODUCT_POLISH.md).

### Optional hosted source

- Include Google and verified Email/password plus TOTP authentication, authoritative Firestore storage, encrypted BYOK credentials and isolated user workspaces.
- Keep technical quotas, safe provider reconciliation, backup restore and deletion recovery while removing payment code and organization credits from the beta.
- Reject incompatible retained state and stop its background retries without purging another build's lifecycle records.
- Keep public hosted admission closed. Daily-work calibration, cloud storage/metering, deployed identity/recovery and a measured invite cohort remain separate rollout gates.

### Known limits

LinkedIn archives contain saved URLs/dates rather than other authors' post bodies. Retrieval and optional AI may incur provider fees and cannot guarantee access or complete attachments. Source fidelity, first-use acceptance and further UX refinements remain documented in the [usage guide](docs/USAGE.md) and [release notes](docs/releases/v0.4.0b1.md). Native Reddit/Instagram import, reminders and automatic whole-archive processing are outside this release.

The organizing checkpoint remains `checkpoint/organizing-ux-2026-11-07`, merged through [PR #5](https://github.com/the-anantkumar/saved-to-shipped/pull/5). Version `0.3.0` was an unpublished development version, not a previous public release.
