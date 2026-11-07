# Closed hosted workbench

This directory contains the separate Cloudflare Workers/SQLite implementation: Google sessions, private workspaces, browser-side archive import, encrypted BYOK credentials and durable provider jobs. The application is **not deployed or accepting members**. Production configuration defaults to disabled APIs, zero seats and empty admission/operator allowlists. Python local use stays dependency-free and account-free.

Try the complete synthetic flow with Node 24 and npm 10 or 11:

```sh
npm ci
npm run uat
```

Open the printed loopback URL. Alice has examples in all three spaces; Bob starts empty; Charlie demonstrates a full beta. The visible test controls remember the selected account and sign-out across reloads. Use only synthetic content and dummy keys. This disposable fixture uses signed test identities and mocked providers; it never needs cloud credentials or spends provider credit. Stop with Ctrl+C to remove its temporary workspace. Follow the [UAT checklist](../docs/UAT.md) for the acceptance pass. `preview:synthetic` remains the minimal automated-test fixture.

For validation:

```sh
npm run typecheck
npm test
PLAYWRIGHT_BROWSERS_PATH=.local/playwright npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=.local/playwright npm run test:e2e
PLAYWRIGHT_BROWSERS_PATH=.local/playwright npm run test:uat
npm run release:check
npm run capacity:workspace
```

The browser test covers import, explicit processing, all three spaces, notes/reading, keyboard and pointer movement, mobile/dark layout, another browser, conflicts, backup restore, account switching and deletion recovery. The artifact check rejects test entrypoints, stale assets and non-closed deployment defaults. `capacity:workspace` measures the final application schema; [local evidence](../docs/evidence/P6-LOCAL-CAPACITY.md) records count/byte limits, churn and complete backup recovery. Real Google login, provider fidelity/charges and cloud capacity remain unverified; see [backend evidence](../docs/evidence/P3-P5.md), [operations](../docs/HOSTED_OPERATIONS.md) and the [shipping plan](../docs/SHIP_PLAN.md).

`wrangler.app.jsonc` is the application template. `npm run app:dev` starts its disabled production configuration locally; use the synthetic preview above for an immediate working demo. Never deploy the synthetic test entrypoints.

## Preserved P1 runtime prototype

The original experiment remains separate in `src/index.ts`, `src/workspace.ts` and `wrangler.jsonc`. Its HTTP data API returns `503`, has no sign-in or membership allocation and never calls providers. The commands below measure that prototype, not the final application schema.

Use Node 24 and npm 10 or 11:

```sh
cd hosted
npm ci
npm run typecheck
npm test
npm run capacity
npm run capacity:fts-commit
npm run dryrun
```

`npm run dev` starts the closed prototype on loopback. The Wrangler configuration disables `workers.dev` and preview URLs. No deploy script is provided. Keep the Cloudflare account on Workers Free; a paid allowance or billing alert does not satisfy this project's policy.

The exact Wrangler dependency is also used as the explicit Miniflare version. Wrangler 4.158.0 currently uses the `5.20261104.0-beta` Miniflare package. All versions and transitive dependencies are pinned in `package-lock.json`; CI must install that lockfile. The compatibility date is explicit and shared by the local test harness.

## What the experiment measures

- `src/workspace.ts` contains a measurement schema with separate indexed metadata, source text, notes, groups, bounded synthetic operational rows and usage. Its methods are trusted internal RPC experiments, not the versioned P2 API.
- Full-detail FTS5 uses an external content table, avoiding a duplicate copy of source text. Atomic triggers update search when source text or notes change. Phrase search is retained.
- Every SQL cursor is consumed before counters are read. Counters include index/trigger work as reported by the runtime and completed SQL later rolled back by a quota check. SQL errors that interrupt cursor consumption are not fully metered here. FTS rebuild counters do not expose the work implied by index growth; verify their relationship to account metering remotely before using them as a daily budget. These counters reset when an object restarts and are not a persistent platform billing ledger.
- Logical bytes are UTF-8 bytes of each fixture's JSON plus organisation data. `sqliteUsedBytes` comes from `sql.databaseSize`, which excludes freelist pages and WAL. The test-only `physicalBytes` limit checks that metric, **not the complete 8 MB physical allocation target**. `tests/capacity/allocation.mjs` separately inspects isolated SQLite files after workerd closes, using Node's built-in SQLite support. The application contract is in `src/storage/` and [P2 evidence](../docs/evidence/P2.md); final physical accounting remains open.
- The write experiment checks count/logical limits before each row mutation, and SQLite used bytes inside `transactionSync`. It applies the same check to deletions because FTS tombstones can grow storage. Quota failure rolls back data; rejected attempts can still consume rows and CPU, and rollback does not imply zero allocation or WAL growth. An arbitrary high-entropy input cannot be guaranteed to fit just because its JSON fits.
- Capacity fixtures cover 500 and 1,000 saves, multibyte content, longer notes, varied search terms, repeated edits, deletion/reinsertion and an additive index migration. They read no personal files and make no provider requests.
- The `jose` verification primitive checks a synthetic RS256 identity's issuer, audience, expiration, issue/authentication time and Google provider. The application adds production key retrieval/cache rotation, sessions, account checks and membership separately under `src/auth/`, `src/membership/` and `src/app.ts`. The P1 entrypoint remains closed.

The pinned workerd runtime returns an internal error when rolling back FTS installation on populated storage. The regression check records that error, restarts the runtime and verifies that exported data, logical usage and the previous schema survived. Ordinary index migration and data-write rollback return controlled quota errors. FTS stays an experiment; the proposed P2 baseline should use bounded metadata search until index storage and billing are resolved.

The runtime rejects direct and table-valued `page_count` and `freelist_count` PRAGMAs. The allocation experiment reproduces a database with fewer than 8 MB of used pages but more than 8 MB of allocated pages after FTS deletion. A no-FTS churn control is measured separately. Neither result proves a general allocation bound or Cloudflare's billed-storage behavior. Those remain P1 gates, alongside remote CPU and active-duration measurement.

The used-page interpretation matches the [pinned workerd implementation](https://github.com/cloudflare/workerd/blob/v1.20261104.1/src/workerd/api/sql.c%2B%2B); the public [SQLite API reference](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) describes the API but does not promise a bound on freelist pages or WAL files.

`tests/harness-worker.ts` is a separate local test entrypoint. It must never be deployed or referenced by a production Wrangler configuration. It accepts test commands without authentication so tests can exercise the actual SQLite runtime before P3 exists. The shipping `src/index.ts` has no path to those commands and never obtains a Durable Object stub.

`npm run capacity` writes a reproducible synthetic report to ignored `.local/capacity-report.json` and prints it. The report records local package versions, database sizes, SQL counters and elapsed request times. Elapsed times include local HTTP overhead; they are **not** deployed Worker CPU, active object duration, cold-start guarantees or confirmation that 500 members can be served. P1's remaining remote measurements and admission model are tracked in [the production plan](../docs/PRODUCTION_PLAN.md) and its evidence.

No personal archives, workspace content, authentication state, API keys or provider responses belong in this directory or in committed evidence. The only test identities and content are generated synthetically.

## Bounded cloud experiment

The separate `wrangler.probe.jsonc` and `probe/` entrypoint provide a secret-protected, fixed 50-save experiment. The application entrypoint remains closed. `npm run probe:dryrun` validates that bundle without deployment; its committed expiry is in the past and no secret is included. See [probe design](probe/README.md) and [cloud execution evidence](../docs/evidence/P1-CLOUD.md) before using the operator scripts. Creating local probe credentials does not deploy resources or start any provider request. The live FTS experiment observed additional size growth after its in-transaction measurement, so that check does not yet establish a hard post-commit used-page cap.
