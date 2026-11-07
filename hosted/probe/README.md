# Bounded P1 cloud measurement probe

This is a separate deployment candidate for one operator-controlled experiment. It is not a hosted save2ship API. Its default expiry is in the past and no operator secret is committed, so the checked-in configuration cannot perform measurement work as-is. The coordinator verifies the Free plan and reviews the candidate before supplying a secret, expiry and deployment permissions.

The only identity accepted by this probe is its high-entropy operator bearer secret. The synthetic RS256 identity below is a benchmark input, never an authorization credential. No real Firebase identity, personal save, provider key or archive is accepted.

## Fixed contract

All requests require `Authorization: Bearer <PROBE_SECRET>`, no query string or `Origin` header, and an empty body. Empty POST streams are checked with at most one chunk and a one-second timeout; declared payloads are rejected before parsing. A missing/short secret, malformed or expired UTC `PROBE_EXPIRES_AT`, or an expiry more than 24 hours away prevents measurement work before any Durable Object lookup.

| Route | Effect |
| --- | --- |
| `GET /probe/report` | Bounded results, progression, counters and current used SQLite bytes |
| `POST /probe/step/seed-1` | Insert fixed synthetic saves 0 through 24 |
| `POST /probe/step/seed-2` | Insert fixed synthetic saves 25 through 49 |
| `POST /probe/step/read` | Read a fixed indexed metadata page |
| `POST /probe/step/edit` | Apply one fixed edit to save 0 |
| `POST /probe/step/reject` | Reject one bounded growth attempt and verify the previous export is unchanged |
| `POST /probe/step/delete` | Delete save 49 |
| `POST /probe/step/fts` | Build FTS only when `PROBE_INCLUDE_FTS=true` at deployment |
| `POST /probe/step/fts-read` | Run one fixed FTS query when enabled |
| `POST /probe/verify/1` through `/16` | Claim one of 16 single-use synthetic RS256 verification samples in order |
| `POST /probe/cleanup` | Drop the known synthetic workspace tables and retain a durable closed marker |

Measurement steps must follow the listed order. The single fixed object name is `save2ship-p1-single-run-v1`; no request chooses an owner, run ID, object name, content, public key or SQL statement. At most 50 distinct saves can be created. A normal run has six storage steps, plus two optional FTS steps. It has no background tasks or alarms.

The plan and expiry are pinned in the durable ledger at first use. Reconfiguring them cannot resume or reset the run. Each step persists an attempt before starting work, waits for storage synchronization, then commits its mutation, result and progression together. A completed retry returns the stored result. An unknown attempt stays in-flight and cannot execute again; cleanup remains available. Cleanup wins over work waiting for its claim to flush. The closed marker survives restarts and prevents workspace schema/data from being recreated by later calls.

The ledger admits at most 128 requests for reports, steps, replays and verification claims. Each verification sample is durably claimed before the Worker performs the fixed signature check, so a lost response cannot trigger another check for that sample. Expiry and the request cap do not prevent authenticated cleanup. Repeated cleanup is a bounded read of the marker, not another table deletion.

These are admitted-work limits, not a way to eliminate request charges: rejected HTTP traffic still consumes Worker requests/CPU, and authenticated requests rejected inside the object can still consume object requests and ledger reads. Keep the secret private and remove the disposable deployment after collecting evidence.

## Measurement boundaries

`before`, `after` and `workspaceCursorDelta` describe the existing measurement adapter. `sqliteUsedBytesAfterLedger` also checks the final result/progression writes. The 1,000,000-byte probe threshold is **used SQLite pages**, not allocated pages or billable storage. The ledger and results also occupy database space. The separate `guardCursorRows` include control SQL for the current `activationId`; they reset on object activation and are not a durable billing ledger. Durable request and verification counts do survive restarts.

The optional FTS stage measures building and querying an index after the ordinary edit/deletion steps. It does not reproduce the earlier 1,000-item indexed-edit/allocation problem or resolve the 8 MB physical-budget gate. Compare measured account counters with this experiment's actual sequence; do not extrapolate a 500-member capacity guarantee from 50 synthetic saves.

Signature verification uses the committed public synthetic RSA key and signed fixture with a fixed validation clock. Its private signing key was discarded. The code path runs in the ordinary Worker after a bounded durable grant. It does not fetch production signing keys or measure Firebase login, token renewal or revocation. Read actual Worker CPU metrics separately from client elapsed times and DO duration.

Cleanup leaves a small ledger/tombstone and may leave allocated free pages, WAL or provider recovery history. It does not claim zero physical or billed storage. Complete namespace/deployment retirement is an operator action outside this HTTP contract.

The local tests use Miniflare's test-only storage inspection to simulate a crash after an attempt claim and inspect cleanup. That inspection API is not part of the deployable entrypoint. No unauthenticated test harness is deployed.
