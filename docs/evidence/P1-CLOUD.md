# P1: Bounded cloud probe preparation

Status: candidate prepared and independently reviewed on 2026-11-07. Cloud deployment and measurements have not yet run. P1 remains open, including the physical-storage definition described in [the local checkpoint](P1.md).

## Account and access

- Wrangler OAuth connection succeeded with `account:read`, `user:read` and refresh access. Credentials stay in the local Wrangler store and are not included in this repository.
- The signed-in Cloudflare dashboard explicitly showed **Free** with **Current plan** on Workers plans. No paid plan or billing product was enabled.
- Read-only API discovery returned no existing Workers. Namespace/subdomain discovery requires additional access; permission errors were retained as unavailable results.
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

Review corrected an empty-POST stream assumption and a deployment/operator Worker-name mismatch before any cloud upload. Build and typecheck include the probe, and hosted CI also validates its separate deployment bundle without deploying it.

## Metrics and execution handoff

Operator commands live in the Git checkout's `hosted/scripts/`; they are excluded from the Python distribution:

```sh
node scripts/cloud-readonly.mjs ACCOUNT_ID
node scripts/cloud-metrics.mjs schema ACCOUNT_ID
node scripts/cloud-metrics.mjs capture ACCOUNT_ID baseline
node scripts/probe-operator.mjs prepare ACCOUNT_ID --fts
npm run probe:dryrun
```

Preparation is one-time and does not overwrite an existing run. The private plan records the account, four-hour expiry and limits. After the matching deployment is verified, `probe-operator.mjs bind` derives the account's origin; `report`, each fixed step name, `verify`, and `cleanup` execute explicit operations. The local request record contains synthetic outcomes only. A stale operator lock requires inspecting the prior attempt before removing it; it is not permission to retry an uncertain operation.

Deployment requires adding only `workers_scripts:write` to the current OAuth scopes. This covers the dedicated script, ordinary Worker secret, SQLite namespace migration and a workers.dev subdomain if needed. No billing, zone, D1, KV, Pages or AI permissions are required for this experiment. The candidate is ready for that narrowly scoped connection step; no write-capable login or resource creation is claimed by this preparation record.

Live introspection establishes these units: `rowsRead`/`rowsWritten` are SQLite rows, `cpuTime`/`activeTime` are microseconds, and `duration` is already GB-seconds. The SQL storage dataset is `durableObjectsSqlStorageGroups`; its `max.storedBytes` is a namespace/time-window maximum. Do not sum repeated storage maxima or interpret them as instantaneous file allocation. Use the dedicated namespace and measurement timestamps to separate test stages. [Metrics API](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/), [SQLite namespace storage chart](https://developers.cloudflare.com/changelog/post/2026-07-20-durable-objects-total-storage-metrics/)

The next execution record must identify the uploaded revision/version, free-plan evidence, actual operations, reported resource measurements and cleanup result. Aggregation delays or missing samples may leave a metric inconclusive. A successful small probe cannot by itself validate 500 members, arbitrary production content, live Firebase authentication, or the 8 MB physical allocation requirement.
