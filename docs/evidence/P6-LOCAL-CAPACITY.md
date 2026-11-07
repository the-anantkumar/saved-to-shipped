# P6: local capacity of the application schema

Status: bounded local measurement completed on 2026-11-07. This measures `hosted/src/storage/workspace.ts`, not the P1 prototype. It does **not** close the deployed physical-storage, account-metering or cohort gates. Owner: `beta_release`; coordinator and independent reviewer must review the release implication.

The run used working-tree changes on `a0df2ec7c946777167ffd51f8b1fc39dd51085e9`, Node 24.22.2 on macOS arm64, Miniflare `5.20261104.0-beta`, workerd `1.20261104.1` and esbuild `0.28.2`. The script builds the current workspace harness directly in memory, avoiding a stale shared build. Its compiled harness SHA-256 was `93da063bb31cf9197bfa8bd55cbbfb436a87753e7d467e49b8ba5c19fdc2f3d5`; the storage source SHA-256 was `6fe88e3cf575f61037063a5388d277a60a475865aa364e1864ece2d9a410ba8d`. The generated report includes hashes of every repository input. These identify the tested working tree; a later candidate needs its own artifact record.

## Reproduction and boundary

From `hosted/`, with the pinned dependencies installed:

```sh
node tests/capacity/workspace.mjs
```

The script creates isolated temporary SQLite workspaces, uses only synthetic saved posts, and removes its temporary persistence roots afterward. It has a three-minute work bound and a 64 MiB persistence bound per scenario. The successful run took about ten seconds. The report is written to ignored `.local/workspace-capacity-report.json`; `complete: true` marks a finished run. Failed quota attempts are recorded as results rather than hidden. The runner does not contact Google, Cloudflare or paid providers.

Libraries are seeded through the real version-1 restore boundary so they include source text, personal notes, sections and independent reading progress. They represent retained workspaces after organisation, not a bare URL archive. Requests contain at most 25 saves and 220,000 bytes of row JSON. The restore, edit, delete, export, job-reservation and close implementations are the production storage class. This fixture bypasses the public Worker and membership registry, so it does not measure authentication cost, global quotas or malicious front-door request load.

All sizes below are decimal bytes. Logical bytes include canonical item JSON and bounded operational records. Used pages come from `sql.databaseSize`. After workerd exits, Node's read-only SQLite API measures `page_count`, `freelist_count` and page size; the script separately records database, WAL and shared-memory file sizes. These are local files, not a Cloudflare storage bill. `page_count` can reflect pages still in the WAL, so do not add allocated-page bytes to WAL bytes and call that actual file usage. Actual file usage is the sum of the measured files.

## Initial libraries

Each item includes common classification fields and belongs to Projects, Learning or Experiences. Text contains varied deterministic words; Unicode profiles include CJK text and four-byte emoji. Text lengths count Unicode code points before trimming trailing whitespace.

| Profile | Requested saves | Accepted saves | Source / note code points per save | Logical bytes | SQLite used bytes | First limiting condition |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Typical | 500 | 500 | 1,700 / 300, ASCII | 1,347,794 | 2,949,120 | None at requested count |
| Typical | 1,000 | 1,000 | 1,700 / 300, ASCII | 2,695,351 | 5,820,416 | None at requested count |
| Unicode | 1,000 | 931 | 2,200 / 500, mixed Unicode | 4,621,559 | 6,991,872 | `STORAGE_PRESSURE` |
| Richer | 1,000 | 847 | 3,800 / 1,400, ASCII | 4,998,412 | 6,676,480 | `LOGICAL_LIMIT` |
| Long notes | 1,000 | 163 | 1,200 / 18,000, mixed Unicode | 4,986,452 | 5,468,160 | `LOGICAL_LIMIT` |

When a batch hit capacity, the runner retried smaller individual rows with a new request ID to determine the exact accepted count. Each rejected chunk left item count, logical usage and workspace revision unchanged. A 1,000-save policy is therefore a maximum count, not a promise that every 1,000-save library fits its byte budgets.

## Churn, rollback and recovery

For each library, the runner attempted three note-replacement passes on 100 items: 2,400, then 100, then 900 code points. The first pass grows typical notes but shrinks the long-note profile. It then deleted 100 items and attempted to restore those exact items into the original workspace. Every complete pre-deletion backup was also restored into a fresh workspace, comparing all source text, annotations, reading state, groups and goals.

- Both typical profiles completed all 300 edits, 100 deletions and 100 reinsertions. Their 500- and 1,000-item backups restored completely.
- The Unicode library was already close to the used-page guard. One 2,400-point edit succeeded; subsequent growth failed. Twelve shrinking edits succeeded before another used-page rejection. After 100 deletions, only 78 of those items could be reinserted into the churned original. The full **931-item pre-deletion backup restored successfully into a fresh workspace**. The runner retains the partial-reinsertion result and does not silently discard its 22 unaccepted rows.
- The richer library rejected additional growth at the logical limit, then completed shrinking/regrowing, deletion and reinsertion. Its 847-item backup restored completely.
- The long-note library completed the three replacement passes, deletion and reinsertion. Its 163-item backup restored completely.
- An oversized completion reservation failed with `LOGICAL_LIMIT` in all five libraries and preserved the complete export, revision and usage. No provider was called.
- A separate 100,000-byte used-page control rejected a 57,000-byte Unicode note with `STORAGE_PRESSURE`. The original export and logical usage survived both the rejection and a runtime restart.

The successful checks show preservation and recoverability in these workloads. They also show that shrinking one field is not guaranteed to make every near-limit mutation fit: metadata, receipts, indexes and page layout still need headroom. Do not advertise the remaining logical-byte figure as guaranteed writable room when the storage-pressure guard is active.

## Physical allocation remains a release gate

Used-page measurements matched quiescent SQLite used pages at every recorded snapshot. Allocated pages and retained WAL files were larger, and closure did not immediately reclaim the allocated local file:

| Source workspace | Maximum allocated page bytes observed | Allocated bytes after workspace close | Used-page bytes after close | Retained WAL bytes after close |
| --- | ---: | ---: | ---: | ---: |
| 500 typical | 3,379,200 | 3,379,200 | 8,192 | 4,268,352 |
| 1,000 typical | 6,250,496 | 6,250,496 | 8,192 | 4,387,832 |
| 931 Unicode | 7,000,064 | 7,000,064 | 8,192 | 4,194,192 |
| 847 richer | 6,926,336 | 6,926,336 | 8,192 | 4,301,312 |
| 163 long notes | 5,472,256 | 5,472,256 | 8,192 | 4,190,072 |

For the 1,000-item typical source after churn, the actual database file was 6,250,496 bytes, WAL was 4,387,832 and shared memory was 32,768: **10,671,096 bytes across those files**, despite used-page size below 7 MB. Transient WAL peaks were not sampled. Closing the source removed items and credentials and left only its tombstone, but free pages and WAL remained in local persistence. The experiment does not establish when or whether Cloudflare bills or reclaims those bytes.

Consequently, no 8 MB physical guarantee, fleet reclamation guarantee or 500-member allowance follows from these results. Before admitting a real cohort, resolve final-schema cloud allocation and metering, include retained tombstones and restore/churn headroom, and revise the physical budget, storage design or admitted cap if necessary. A hard-free provider plan remains required regardless of the eventual measured capacity.

## Remaining evidence

The generated report records local elapsed round trips only; it is not Worker CPU or billable active duration. Global registry work, HTTP/authentication rejections, platform requests/rows, concurrent active users, completion traffic, full UTC quota windows, actual platform backup/restore and deployed code rollback remain separate P6/P7 checks. No cloud resources were deployed or modified for this measurement.
