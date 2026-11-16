# Development completion and local UAT

Date: 2026-11-07. Scope: the local synthetic hosted application on the former `feat/hosted-workbench` branch, continuing from `61e716b`. The runtime foundation was subsequently integrated into `main` through MR 10. This is agent-run acceptance evidence; the product owner's [UAT checklist](../UAT.md) remains separate.

Phase checkpoints:

- `9b6ad85`: workspace purge, Registry recovery, private search and library/cache revisions.
- `89b6b45`: coherent search, cross-session cache updates, reading recovery and race regressions.
- The UAT fixture, checklist and CI checks are committed separately with this record.

## Findings resolved

| Finding | Result |
| --- | --- |
| Closing a workspace retained its SQL tombstone and allocation | Purge uses `deleteAll()`; Registry retains generation/deletion history. Absent reads and alarms create no schema. |
| Purge succeeded but Registry finalization or a replacement-key retry failed | A matching deleting/deleted generation can finish on retry; an active missing workspace fails closed. Legacy closed tombstones can be reclaimed. |
| Metadata remained stale after another browser changed the library | Item-library revision drives atomic metadata refresh. Job bookkeeping does not invalidate pages. Partial failed reads leave the previous cache intact. |
| Notes search depended on whether a detail had been opened | Tenant-scoped search examines bounded full source/notes and returns IDs only. Reload and browser Back preserve the correct result set. |
| Slow detail or mutation replies overwrote newer data or revived removed cache entries | Replies are checked against intervening snapshots/edits. Superseded successful writes trigger a read refresh, without resubmitting the write. |
| Replaying an earlier deletion could hide a reimported save | Current returned saves are retained; item cache revisions distinguish incarnations. |
| A remotely removed open reader blocked rendering, or late failure closed a different reader | Refresh returns to the library only for the affected reader and preserves subsequent navigation. |
| Hosted reading writes lacked page-close delivery support | Small reading writes use `keepalive`; a real tab-close test retained progress before the normal debounce elapsed. |
| Synthetic preview always signed back into Alice on reload | Human UAT has visible account selection, remembered sign-out/identity, token renewal and seeded examples. No tokens are persisted by its adapter. |

Independent backend review exercised controlled interleavings: provisioning paused during authorization while deletion queued, stale provisioning delivered after purge, and an alarm returning after purge. All preserved deletion without recreating SQL, KV or alarms. Independent client reproductions passed for delayed detail/mutation replies, deletion replay, reincarnation, superseded reading progress and late reader failure after navigation. No confirmed P1/P2 findings remained in those reviewed boundaries.

## Executed checks

Node 24.22.2, the pinned dependency lockfile and generated fixtures were used. No personal archive, real Google identity or paid provider was used.

| Check | Result |
| --- | --- |
| Hosted typecheck/build | Passed |
| Hosted unit/API/storage/provider/client suite | 90 tests passed |
| Shared local UI/theme behavior | 32 tests passed |
| Application browser E2E | 9 acceptance groups passed, zero runtime errors |
| Human UAT controls | 10 acceptance groups passed, zero runtime errors |
| Closed production bundle/artifact boundary | Passed; test/UAT authentication excluded, disabled APIs and zero admission preserved |
| Final-schema capacity experiment | Five profiles completed; every accepted backup restored; details below |
| Documentation links and whitespace | Passed |

The independent UI reviewer also exercised manual capture, local rules, ChatGPT prompt/download/paste, invalid inputs, offline draft recovery, all three spaces, inline organization, reading filters, dark/mobile layout and sign-out isolation. A 64-save CSV loaded through two metadata pages, then displayed all saves through Show more. A real tab close 60 ms after scrolling, before the 900 ms debounce, retained 36% progress and restored approximately the same position.

Native browser tab clicks verified additions and deletions on return, and preservation/conflict handling of an open note draft. Playwright's focus emulation did not generate real focus events, even with `bringToFront`; maintained headless tests explicitly dispatch the return event. This harness limitation is separate from the native checks. Test runners also need loopback binding; a sandbox-denied launch was rerun with that permission.

Reports are ignored local evidence: `hosted/.local/e2e/report.json`, `.local/uat-controls/report.json`, `.local/uat-review/`, `.local/workspace-capacity-report.json` and `.local/release-check/report.json`. Artifact and capacity reports record their commit, dirty-tree status and source hashes. CI runs the maintained checks on the pushed commit. A report marked dirty describes development work, not a frozen release artifact.

## Storage update

The no-FTS application accepted 500/1,000 typical saves, 931 Unicode saves, 847 richer saves and 163 long-note saves under the configured count/logical/used-page guards. All accepted source text, annotations, groups and goals restored into a fresh workspace. These are local fixture results, not per-user guarantees.

After full purge, both source and recovery objects had no application tables, KV entries or alarm. Each empty local SQLite object returned to its 4,096-byte baseline. Restart, repeated stale reads/provision attempts and late alarms did not change that baseline. The runner includes non-workspace databases and WAL/shared-memory files; the two-object scenarios retained 266,632 total local bytes including empty files, synthetic authority and runtime plumbing, unchanged after stale requests. It does not equate absent application rows with zero physical files.

Cloudflare documents [`deleteAll()` as the complete storage removal operation](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/#remove-a-durable-objects-storage). The local results establish its application behavior here, not deployed billing or metering. They supersede only the old close/tombstone behavior in [P6 capacity evidence](P6-LOCAL-CAPACITY.md). The active 1,000-save workspace still exceeded the planned 8 MB when database/WAL/shared-memory files were counted. That gate remains open.

## Before shipping

Human product acceptance remains pending. Live Google sessions, provider source fidelity/actual charges, deployed export/deletion/rollback, cloud physical storage, search CPU/read cost and cohort budgets remain unverified. The 500-member target is still a planning ceiling. The production manifest remains closed and no application deployment, public package release or repository visibility change was performed by this UAT work.
