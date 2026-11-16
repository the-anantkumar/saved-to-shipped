# P1 cloud measurements: 2026-11-07

Status: synthetic execution, cleanup, final metric capture and deployment retirement recorded. This bounded synthetic probe does not close P1 or certify the 500-member target.

## Deployment and boundary

- Deployed revision: `18a01d3afd77275419e154b22191b5a5d52c86fe`.
- Deployed version: `2d97895b-8f33-4c24-9ef6-c417efce9171`.
- Input: 50 fixed synthetic saves in two 25-save batches. No personal archive or paid provider request.
- Identity benchmark: fixed synthetic RS256 public key/token and a fixed validation clock. It is not real Firebase authentication.
- Account identifiers, origin, activation IDs, credentials and personal information are excluded from this record.
- Source observations: the private operator request log and cloud metric captures; only selected synthetic measurements are reproduced here.

## Request observations

The request log contains 29 operations: 28 returned HTTP 200, and the final post-cleanup report correctly returned HTTP 410. Client timestamps below bracket elapsed request time; they are not Worker CPU or billable object duration.

| Operation | Started (UTC) | Finished (UTC) | HTTP |
| --- | --- | --- | ---: |
| report | 2026-11-07T11:57:21.130Z | 2026-11-07T11:57:21.985Z | 200 |
| seed-1 | 2026-11-07T11:57:41.475Z | 2026-11-07T11:57:42.067Z | 200 |
| seed-2 | 2026-11-07T11:57:42.127Z | 2026-11-07T11:57:42.629Z | 200 |
| read | 2026-11-07T11:57:42.692Z | 2026-11-07T11:57:43.214Z | 200 |
| edit | 2026-11-07T11:57:43.276Z | 2026-11-07T11:57:43.758Z | 200 |
| reject | 2026-11-07T11:57:43.820Z | 2026-11-07T11:57:44.313Z | 200 |
| delete | 2026-11-07T11:57:44.373Z | 2026-11-07T11:57:44.870Z | 200 |
| fts | 2026-11-07T12:00:58.849Z | 2026-11-07T12:00:59.456Z | 200 |
| fts-read | 2026-11-07T12:00:59.515Z | 2026-11-07T12:01:00.148Z | 200 |
| final report | 2026-11-07T12:05:25.778Z | 2026-11-07T12:05:26.341Z | 200 |
| cleanup | 2026-11-07T12:05:35.224Z | 2026-11-07T12:05:35.744Z | 200 |
| cleanup replay | 2026-11-07T12:05:35.808Z | 2026-11-07T12:05:36.291Z | 200 |
| post-cleanup report | 2026-11-07T12:05:36.353Z | 2026-11-07T12:05:36.860Z | 410 |

Synthetic verification samples 1 through 16 all returned `granted: true` and `verified: true`, each with HTTP 200. First sample started **2026-11-07T12:01:00.211Z**; last sample finished **2026-11-07T12:01:03.610Z**. No sample was replayed.

## Storage and cursor observations

Bytes are decimal. `used` means `sql.databaseSize`, excluding allocated free pages and WAL. The measurement includes existing probe/control storage; `after ledger` also includes the current result/progression writes. These values are not an enforceable physical-storage or billing bound.

| Step | Saves before → after | Logical bytes before → after | Used bytes before → after | Used bytes after ledger | Workspace rows read | Workspace rows written |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| seed-1 | 0 → 25 | 0 → 75,037 | 77,824 → 200,704 | 200,704 | 186 | 175 |
| seed-2 | 25 → 50 | 75,037 → 151,895 | 200,704 → 327,680 | 327,680 | 186 | 175 |
| read | 50 → 50 | 151,895 → 151,895 | 327,680 → 327,680 | 327,680 | 36 | 0 |
| edit | 50 → 50 | 151,895 → 151,895 | 327,680 → 327,680 | 327,680 | 43 | 6 |
| reject | 50 → 50 | 151,895 → 151,895 | 327,680 → 327,680 | 327,680 | 261 | 6 |
| delete | 50 → 49 | 151,895 → 148,821 | 327,680 → 323,584 | 323,584 | 43 | 3 |
| fts | 49 → 49 | 148,821 → 148,821 | 323,584 → 339,968 | 339,968 | 71 | 6 |
| fts-read | 49 → 49 | 148,821 → 148,821 | 434,176 → 434,176 | 442,368 | 54 | 0 |

Workspace row deltas include the adapter’s observation queries. They exclude separately instrumented guard SQL. Guard counters below are cumulative within an object activation and may reset on activation; they must not be summed as a durable billing ledger. Hidden engine work and account metering require independent reconciliation.

| Observation | Guard rows read | Guard rows written |
| --- | ---: | ---: |
| report | 6 | 7 |
| seed-1 | 6 | 5 |
| seed-2 | 11 | 10 |
| read | 16 | 15 |
| edit | 21 | 20 |
| reject | 26 | 25 |
| delete | 31 | 30 |
| fts | 6 | 5 |
| fts-read | 11 | 10 |
| verify-1 | 14 | 12 |
| verify-16 | 74 | 42 |
| final report | 11 | 1 |
| cleanup | 295 | 20 |

## Outcomes and timing caveat

- The two seed steps inserted 50 distinct saves. The deletion left 49 saves.
- The deliberate growth attempt returned `PHYSICAL_LIMIT` with `exportUnchanged: true`. Its used-page size peaked at **393,216 bytes** before rollback; it still reported **6 attempted row writes**.
- The FTS-build response reported **339,968 used bytes**. The following FTS-read request began at **434,176 used bytes**, then reported **442,368 bytes after its ledger write**. The build response was not a settled storage plateau. This probe does not isolate commit/background timing, so the later measurement must be retained.
- FTS was built after the ordinary edit/deletion steps. This run measures index build/query costs; it does not reproduce or resolve the earlier 1,000-item indexed-edit/allocation gap.
- Worker signature verification succeeded 16 times, but request timing does not establish its CPU cost or production Firebase key-fetch behavior.

## Cloud metrics and cleanup

The final report confirmed all storage steps complete, no in-flight attempt, **26 admitted requests**, **16 verification claims**, and **442,368 used bytes**. Its guard counters had reset with a new object activation; they must not be combined as one cumulative series with earlier values.

Cleanup returned HTTP 200 with `closed: true`, `replay: false` and **20,480 used bytes** retained for the ledger/tombstone. The immediate retry returned HTTP 200 with `replay: true` and the same used-byte count. A subsequent report returned HTTP 410 with `PROBE_CLOSED`, confirming the object would not resume measurement work. The operator command's nonzero exit for that 410 was expected.

This is cleanup of the synthetic workspace data, not proof of zero allocated or billed storage. Subsequent Worker/namespace retirement is recorded below. Empty or delayed metric responses must not be reported as zero resource usage. No quota, CPU, duration or billed-storage gate is closed by this record.

## Cloud metric capture history

These are successive API observations, not final reconciled usage. An empty dataset means no samples were returned in that capture; it does not establish zero usage. `query budget` means the analytics query was rejected, not that the application’s free hosting quota was exhausted.

| Capture | Captured (UTC) | Query window (UTC) | SQL storage | Object periodic | Object invocations | Worker invocations |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | 2026-11-07T11:05:28.010Z | 2026-11-07T00:00:00.000Z to 2026-11-07T11:05:27.566Z | 0 returned rows | 0 returned rows | 0 returned rows | 0 returned rows |
| after-base | 2026-11-07T11:58:07.893Z | 2026-11-07T00:00:00.000Z to 2026-11-07T11:58:07.397Z | 0 returned rows | 0 returned rows | 0 returned rows | 1 returned row |
| after-search | 2026-11-07T12:01:15.548Z | 2026-11-07T00:00:00.000Z to 2026-11-07T12:01:15.068Z | query budget | query budget | query budget | query budget |
| settled | 2026-11-07T12:07:22.135Z | 2026-11-07T11:50:00Z to 2026-11-07T12:07:00Z | 0 returned rows | query budget | query budget | 4 returned rows |
| final | 2026-11-07T12:13:26.347Z | 2026-11-07T11:50:00Z to 2026-11-07T12:07:00Z | 0 returned rows | 3 returned rows | 4 returned rows | 4 returned rows |

The settled capture returned the following Worker aggregates. CPU values are **microseconds**, directly preserving the API’s units. These buckets combine storage, report, cleanup and synthetic-verification requests; they do not isolate the cost of a JWT check. Adaptive/delayed aggregates are not an accounting proof.

| Minute (UTC) | Reported requests | Reported runtime errors | CPU sum (µs) | CPU max (µs) | CPU P50 (µs) | CPU P95 (µs) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-11-07T11:57:00Z | 10 | 0 | 17,067 | 3,384 | 1,410 | 3,384 |
| 2026-11-07T12:00:00Z | 2 | 0 | 2,708 | 1,607 | 1,101 | 1,607 |
| 2026-11-07T12:01:00Z | 13 | 0 | 19,768 | 3,916 | 1,362 | 3,916 |
| 2026-11-07T12:05:00Z | 4 | 0 | 6,359 | 2,147 | 1,241 | 2,147 |

The earlier after-base Worker capture returned one partial bucket for `2026-11-07T11:57:00Z`: 5 requests, 0 runtime errors, 5,978 µs CPU sum, 2,009 µs maximum/P95 and 980 µs P50. The later capture contains 10 requests for that minute, demonstrating that the earlier response was incomplete.

The final capture below supersedes the missing periodic/invocation observations above. SQL stored-byte attribution is still unavailable.

## Final cloud capture

Captured at **2026-11-07T12:13:26.347Z**, querying **2026-11-07T11:50:00Z to 2026-11-07T12:07:00Z** with a page size of 100. All four queries succeeded and none was marked possibly truncated. No further analytics capture is planned for this run.

The periodic and Durable Object invocation rows matched the dedicated probe namespace, verified against the operator’s resource inventory. Namespace identifiers are intentionally omitted here. The Worker aggregates had `__unknown__` script attribution; their correspondence with this isolated run is not a certified per-script billing reconciliation.

| Periodic minute (UTC) | Rows read | Rows written | Object CPU (µs) | Active time (µs) | Duration (GB-s) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-11-07T11:57:00Z | 913 | 425 | 19,252 | 402,775 | 0.051555200 |
| 2026-11-07T12:00:00Z | 246 | 48 | 18,593 | 661,632 | 0.084688896 |
| 2026-11-07T12:05:00Z | 297 | 20 | 3,296 | 149,362 | 0.019118336 |
| **Total** | **1,456** | **493** | **41,141** | **1,213,769** | **0.155362432** |

Periodic timestamps are reporting bucket labels, not precise per-request attribution: the `12:00` bucket also includes requests made during `12:01`. Independent review reconciled this run’s stage counters: reads `913 + 246 + 297 = 1,456` and writes `425 + 48 + 20 = 493`, including guard SQL and closure checks. That bounded reconciliation does not establish general billing semantics or storage accounting.

| Object invocation minute (UTC) | Reported requests | Runtime errors | CPU P50 (µs) | CPU P95 (µs) |
| --- | ---: | ---: | ---: | ---: |
| 2026-11-07T11:57:00Z | 7 | 0 | 1,530 | 6,046 |
| 2026-11-07T12:00:00Z | 1 | 0 | 7,749 | 7,749 |
| 2026-11-07T12:01:00Z | 17 | 0 | 584 | 1,535 |
| 2026-11-07T12:05:00Z | 4 | 0 | 320 | 2,077 |

- Object invocation aggregates total **29 requests and 0 runtime errors**. These are separate from client HTTP statuses; an intentional HTTP 410 is not necessarily a runtime error.
- Final Worker aggregates match the four settled-capture rows above: **29 reported requests, 0 runtime errors, 45,902 µs CPU sum and 3,916 µs maximum**. These account aggregates do not isolate the 16 JWT verifications or prove behavior at the proposed cohort size.
- `durableObjectsSqlStorageGroups` still returned no stored-byte samples. Used-page responses, allocated physical storage and billed storage are therefore **not reconciled**.
- The observed rows and duration cover one bounded run and one query window. They are useful runtime evidence, not a completed daily-budget, physical-cap or 500-member capacity proof.

## Deployment retirement

The disposable Worker and its Durable Object namespace were removed after the final capture. A separate read-only REST inventory at **2026-11-07T12:14:46.014Z** returned empty Worker and namespace lists; the account’s existing subdomain was unchanged. Account, subdomain and namespace identifiers are omitted from this evidence.

Wrangler completed the relevant deletion but later exited with status 1 when unrelated legacy KV cleanup encountered an authorization error. A separate container check also warned about missing scope. No broader permission was requested. The successful post-action resource inventory, rather than the CLI exit alone, verifies retirement.

This confirms that the temporary deployed resources are no longer listed. It does not claim zero historical billing, immediate erasure of provider recovery history, or that the earlier 8 MB physical-storage requirement has been resolved.
