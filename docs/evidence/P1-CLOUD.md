# P1: Bounded cloud probe

Status: independently reviewed candidate deployed, exercised and retired on Cloudflare Free on 2026-11-07. The small synthetic functional checks passed and reported row costs reconcile with instrumentation. P1 remains open: physical-storage accounting and production capacity budgets are not established. See [the local checkpoint](P1.md).

## Account and access

- Wrangler OAuth connection succeeded with `account:read`, `user:read`, `workers_scripts:write` and refresh access. Write access was added only after preparing, reviewing and committing the candidate. Credentials stay in the local Wrangler store and are not included in this repository.
- The signed-in Cloudflare dashboard explicitly showed **Free** with **Current plan** on Workers plans. No paid plan or billing product was enabled.
- Before deployment, API discovery returned no existing Workers or Durable Object namespaces. Deployment created one dedicated Worker/SQLite namespace and registered a workers.dev subdomain.
- SQLite storage, periodic DO usage, DO invocation and ordinary Worker invocation analytics are enabled for this account. The baseline query returned no samples. Missing samples do not prove zero usage or establish available quota.
- The account identifier and raw account discovery are retained only in ignored local operator files. No authenticated browser capture is part of committed evidence.

## Reviewed candidate

The separate `hosted/wrangler.probe.jsonc` deploys `save2ship-p1-probe`, using a dedicated `ProbeSession` SQLite namespace. It does not change the closed application entrypoint. The unauthenticated local harness is not deployed.

Every probe route requires the operator bearer secret, rejects request data and selectors, and checks a fixed expiry before accessing its one object. The committed default is expired and has no secret. Server-side limits allow 50 fixed synthetic saves, 128 admitted requests and 16 single-use synthetic RS256 verification claims. Invalid front-door traffic still consumes Worker requests; this is not a global network request cap.

The ordered experiment seeds two 25-record batches, reads a page, edits one record, rejects a deliberately oversized write and deletes one record. An optional server-configured final stage builds and queries FTS on the small fixture. That stage does not establish the safety of indexed edits or deletions near the 8 MB production target.

A durable attempt record is committed before mutation. Successful results and step progress commit together; unknown outcomes stay blocked rather than repeating work. Cleanup removes the fixed synthetic tables and leaves a small durable tombstone. It remains available after expiry/request exhaustion and prevents late requests from recreating the workspace. Neither cleanup nor the 1 MB used-page guard claims zero allocated or billable storage.

The operator runner generates a private local credential without contacting providers. Its origin is derived from this account's official subdomain API. It accepts only fixed operations, refuses redirects, serializes local runs, records uncertainty before HTTP and never automatically retries. Secrets are never supplied in URLs or command arguments. A JSON secrets file permits Wrangler to upload the secret with the reviewed code in one deployment.

## Validation performed

| Check | Result |
| --- | --- |
| TypeScript and integrated local tests | Passed, 16 tests |
| Independent probe tests | Four workerd tests passed, including concurrency, replay, restart, uncertain claims, caps and cleanup races |
| Independent operator tests | Six tests passed, including credential redaction, response/window bounds, private preparation, exclusive locking, destination validation and no retries |
| Probe deployment dry run | Passed: 60.74 KiB, 16.51 KiB gzip; no deployment |
| Final name-alignment check | Operator and Wrangler both target `save2ship-p1-probe` |
| Independent review | Approved the local candidate; no remaining implementation findings |
| GitHub Actions for `18a01d3` | Both hosted and cross-platform/package workflows passed, eight jobs total |

Review corrected an empty-POST stream assumption and a deployment/operator Worker-name mismatch before any cloud upload. Build and typecheck include the probe, and hosted CI also validates its separate deployment bundle without deploying it.

## Live execution

- Uploaded revision: `18a01d3afd77275419e154b22191b5a5d52c86fe`.
- Worker: `save2ship-p1-probe`; version: `2d97895b-8f33-4c24-9ef6-c417efce9171`; class: `ProbeSession`.
- Node 24.22.2, pinned Wrangler 4.158.0, explicit `wrangler.probe.jsonc`, isolated environment, private JSON secrets file and a fixed expiry of `2026-11-07T15:05:57.190Z`.
- The live bundle matched the reviewed dry run: 60.74 KiB, 16.51 KiB gzip. Workers Free was confirmed in the dashboard before deployment and again afterward.
- The new workers.dev address initially had TLS handshake failures. After propagation, certificate-validated HTTPS succeeded and an unauthenticated request returned `401`. No certificate checks were disabled.
- No personal archive, user workspace or provider credential entered the probe. No retrieval/classification request, paid plan, package publication or repository visibility change occurred.

All eight ordered measurement steps returned HTTP `200`. The `reject` operation intentionally returned a nested `PHYSICAL_LIMIT` result and proved that the exported fixture stayed unchanged. UTC times and synthetic counters are retained in the [sanitized measurement record](P1-CLOUD-MEASUREMENTS.md).

| Operation | Observed result |
| --- | --- |
| Two 25-save batches, 11:57 UTC | 50 saves, 151,895 logical bytes, 327,680 used SQLite bytes |
| Metadata read | 17 learning records; covering-index plan; query cursor read 18 rows |
| Single edit | Succeeded; six workspace cursor writes; 327,680 used bytes |
| Deliberately oversized edit | Rejected; temporary used size 393,216 bytes, restored to 327,680; export unchanged; six attempted cursor writes still counted |
| Single deletion | 49 saves, 148,821 logical bytes, 323,584 used bytes |
| FTS build, 12:00 UTC | Succeeded; six reported workspace cursor writes; in-transaction size after probe ledger 339,968 bytes |
| Next request, FTS query | Began at 434,176 used bytes; one match and three query cursor reads; ended at 442,368 bytes including ledger |
| Synthetic RS256 verification, 12:01 UTC | All 16 single-use claims returned `verified: true` |

Cursor costs in this table exclude some probe bookkeeping and are not platform billing counters. The token check uses a fixed public synthetic key/token and validation clock. It does not establish live Firebase authentication, key fetching, revocation or production authentication CPU headroom.

### New storage finding

The FTS build's in-transaction result reported 339,968 used bytes. The next request began at 434,176, a 94,208-byte increase without intervening operator work and within the same object activation. An independent local reproduction confirmed that the current guard accepts a write whose committed used-page size exceeds its cap. This is separate from the already known freelist/WAL gap.

Run `npm run capacity:fts-commit` from the Git checkout's `hosted/` directory on Node 24. The standalone `tests/capacity/fts-commit.mjs` experiment builds the current code in memory twice, changing only its synthetic cap from 1,000,000 to 360,000 bytes. Both FTS requests succeeded at 335,872 bytes inside the transaction and measured 430,080 on the next request. The tighter case therefore exceeded its cap by 70,080 bytes after success. Earlier no-FTS steps had identical before-return and next-request measurements. The script reproduces a known defect; its successful exit does not approve the production quota design. Hosted tooling is excluded from the Python distribution.

The observed fixture stayed below the experiment's 1 MB threshold. This result does not establish a universal bound for arbitrary content, an indexed production schema or the proposed 8 MB physical allocation. Keep full-text indexing out of the provisional production baseline until these gates are resolved.

### Platform measurements

The 11:58:07 UTC capture returned valid arrays, but no samples for any of the three DO datasets. Ordinary Worker analytics reported five requests with 5,978 microseconds total CPU and 2,009 microseconds maximum in the 11:57 bucket. Its script name was `__unknown__`, so attribution to the probe remains unresolved. These incomplete samples cannot establish token-verification CPU or total test consumption.

At 12:01:15 UTC, all four analytics queries returned GraphQL `budget` errors with HTTP `200`. That is an analytics query-limit failure, not evidence of exhausted application quotas or a monetary charge. Cloudflare documents a default 300-query/five-minute limit and recommends waiting five minutes after budget depletion. Subsequent reads use a narrow event window. [Query limits](https://developers.cloudflare.com/analytics/graphql-api/limits/), [error handling](https://developers.cloudflare.com/analytics/graphql-api/errors/)

Cloudflare notes that DO analytics may lag Worker analytics by several minutes. Empty samples therefore remain inconclusive; missing data is never recorded as zero. [Analytics timing](https://developers.cloudflare.com/changelog/post/2026-08-20-durable-objects-deployments-tab/)

After a six-minute pause, the 12:07:22 UTC capture used the explicit 11:50–12:07 UTC event window. SQL storage still returned no samples; DO periodic and invocation queries still returned `budget`. Worker analytics returned four buckets totaling 29 reported requests, 45,902 microseconds CPU and a maximum of 3,916 microseconds. All script labels remained `__unknown__`. Overlapping captures are not summed, bucket percentiles are not averaged, and runtime `success` is not an HTTP status guarantee.

The operator query page was reduced from 2,000 to 100 groups for the final bounded read. Reports retain the page size and treat a full page as potentially truncated, causing a nonzero command exit. This reduces requested output without claiming to resolve the provider's undisclosed budget cause. The changed collector passed all six operator tests, including the truncation check.

At 12:13:26 UTC, the same event window with 100-group pages returned valid, untruncated arrays for all four datasets. All DO samples matched the dedicated namespace recorded through the account API. The reported totals were **1,456 rows read, 493 rows written, 41,141 microseconds DO CPU, 1,213,769 microseconds active time and 0.155362432 GB-seconds duration**. DO invocation samples reported 29 requests and zero runtime errors. These are observed small-fixture measurements, not a production capacity estimate.

Reported row totals reconcile exactly with instrumentation, including the rejected write and probe control work. Base operations used 425 writes (388 workspace, 30 guard, seven initial-report writes); the FTS/verification activation used 48 (six workspace and 42 guard); closure used 20. The corresponding reads were 913, 246 and 297. Periodic buckets can cover an activation spanning later request minutes: the 12:00 bucket includes the 12:01 verification work. Do not assign its entire cost to the FTS request or infer individual-operation CPU from it.

SQL storage still returned an empty array. Worker samples were unchanged and still labeled `__unknown__`, leaving JWT CPU attribution unresolved. The two successes after reducing query size do not establish whether the previous errors came from page complexity or another provider budget. Collection stopped after this bounded final read. The [measurement record](P1-CLOUD-MEASUREMENTS.md) retains the capture history and per-bucket observations.

### Cleanup

At 12:05:26 UTC, the final report showed all eight steps complete, no uncertain operation, 26 admitted requests and 16 verification claims. After approximately four minutes without probe requests, the object activation had changed. That is evidence of reactivation, not a quantitative idle-duration or billing measurement.

Cleanup at 12:05:35 UTC removed the synthetic workspace schema and returned `closed: true`, retaining 20,480 used bytes for the control ledger/tombstone. A repeat cleanup returned the same value with `replay: true`; subsequent report access returned `410 PROBE_CLOSED`. Its operator command exited nonzero because the generic runner expects HTTP 200, which is expected for this deliberate closure check. This proves the closed object would not resume work; it does not prove zero allocated or billed storage.

After recording the final metrics, pinned Wrangler deleted only `save2ship-p1-probe`, using an interactive exact-name confirmation without force. It then exited nonzero because its unrelated legacy Sites KV cleanup lacked permission, and also warned that container inspection was unavailable. No broader permissions were requested. The probe defined neither Containers nor Sites assets. A separate official API read at **12:14:46 UTC** confirmed empty Worker and Durable Object namespace listings and the unchanged account subdomain. This verifies retirement despite the CLI's later error; it does not erase historical usage or certify a storage metric of zero. No probe service remains deployed.

## Reproduction and measurement boundaries

Operator commands live in the Git checkout's `hosted/scripts/`; they are excluded from the Python distribution:

```sh
node scripts/cloud-readonly.mjs ACCOUNT_ID
node scripts/cloud-metrics.mjs schema ACCOUNT_ID
node scripts/cloud-metrics.mjs capture ACCOUNT_ID baseline
node scripts/probe-operator.mjs prepare ACCOUNT_ID --fts
npm run probe:dryrun
```

Preparation is one-time and does not overwrite an existing run. The private plan records the account, four-hour expiry and limits. After the matching deployment is verified, `probe-operator.mjs bind` derives the account's origin; `report`, each fixed step name, `verify`, and `cleanup` execute explicit operations. The local request record contains synthetic outcomes only. A stale operator lock requires inspecting the prior attempt before removing it; it is not permission to retry an uncertain operation.

Deployment added only `workers_scripts:write` to the read-only OAuth scopes. This covered the dedicated script, ordinary Worker secret, SQLite namespace migration and workers.dev subdomain. No billing, zone, D1, KV, Pages or AI permissions were requested for this experiment.

Live introspection establishes these units: `rowsRead`/`rowsWritten` are SQLite rows, `cpuTime`/`activeTime` are microseconds, and `duration` is already GB-seconds. The SQL storage dataset is `durableObjectsSqlStorageGroups`; its `max.storedBytes` is a namespace/time-window maximum. Do not sum repeated storage maxima or interpret them as instantaneous file allocation. Use the dedicated namespace and measurement timestamps to separate test stages. [Metrics API](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/), [SQLite namespace storage chart](https://developers.cloudflare.com/changelog/post/2026-07-20-durable-objects-total-storage-metrics/)

A successful small probe cannot by itself validate 500 members, arbitrary production content, live Firebase authentication, or the 8 MB physical allocation requirement. Production-schema row metering, ordinary Worker CPU attribution, realistic browsing/idle behavior and physical allocation accounting remain required before admission budgets can be accepted. The independently reviewed follow-up commit `3338a24` preserves the FTS defect reproduction in CI and the smaller metrics collector. No runtime fix or P1 completion is claimed.
