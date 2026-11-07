# Hosted beta operations

This runbook describes the closed hosted implementation. No application deployment or admitted cohort is established by these instructions. The retired P1 probe is a separate resource, and its measurements do not certify the final schema. See the [shipping plan](SHIP_PLAN.md), [production plan](PRODUCTION_PLAN.md) and [P1 cloud evidence](evidence/P1-CLOUD.md).

## Deployment record and defaults

Before an authorized rollout, record the exact Git commit, CI run, lockfile hash, application bundle and asset hashes, Worker version ID, target account, Firebase project, origin, schema tag, cap, operator UIDs and rollback version. Keep credential values, user content and raw authenticated logs out of this record.

`hosted/wrangler.app.jsonc` is the production application template. It binds Firestore-backed `FirebaseWorkspace` and `FirebaseRegistry` classes under migration tag `app-firebase-v1`, retaining `app-v1` as migration history. SQLite is a disposable workspace projection. It is separate from `wrangler.jsonc` (P1 prototype) and `wrangler.probe.jsonc` (retired measurement probe). Do not deploy a `tests/*harness*` or `client/test-bootstrap.mjs` entrypoint. Follow the [Firebase setup](FIREBASE_SETUP.md) for database configuration and the revised capacity gates; previous SQLite measurements do not certify Firestore capacity.

| Configuration | Committed default | Operational meaning |
| --- | --- | --- |
| `HOSTED_ENABLED` | `false` | Public workspace APIs remain unavailable |
| `ADMISSION_OPEN` | `false` | No new memberships; existing active members can return when the API is enabled |
| `PROCESSING_OPEN` | `false` | Reject new ingestion/completion reservations, including imports and new provider jobs |
| `BETA_CAP` | `0` | Zero admitted members by default; any nonzero cohort needs measured approval |
| `ADMISSION_UIDS` | `[]` | No new UID is allowed; a closed preview explicitly names its test identities |
| `OPERATOR_UIDS` | `[]` | No operator API access until stable Firebase UIDs are configured |
| `workers_dev`, `preview_urls` | `false` | No public provider-subdomain route is enabled by the template |

Closing admission or processing does not cancel already accepted external work. Durable reconciliation can finish known jobs. Disabling HTTP APIs is also not an alarm cancellation mechanism. Handle known paid work before an incident response that would remove its credentials or runtime.

## Local release checks

Use Node 24 and the committed lockfile. These commands run synthetic providers and identities, build artifacts, and perform dry runs only:

```sh
cd hosted
npm ci
npm run typecheck
npm test
npm run capacity:workspace
npm run build:client
PLAYWRIGHT_BROWSERS_PATH=.local/playwright npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=.local/playwright node tests/e2e.mjs
npm run app:dryrun
node scripts/check-release.mjs
```

The release check rejects stale shared assets and browser bundles, checks production dependency provenance, rejects test entrypoints, verifies closed defaults and records SHA-256 hashes in ignored `.local/release-check/report.json`. It also rejects a dry-run source map that no longer matches the checkout. Repeat the build and dry run after changing source. This record proves a local artifact boundary, not live sign-in, deployment or capacity.

The browser fixture starts its own isolated loopback service, uses generated signed identities and mocks all providers. Its screenshots and report are synthetic. CI retains only the explicit report/screenshot allowlist for seven days; it uploads neither browser profiles nor provider responses. `npm run capacity:workspace` measures the final application schema; [its local evidence](evidence/P6-LOCAL-CAPACITY.md) includes quota rollback, churn and full backup recovery. `npm run capacity` and `npm run capacity:fts-commit` still describe the P1 measurement schema.

## Prepare a real preview

Keep the account on **Cloudflare Workers Free** and Firebase on **Spark without a linked billing account**. Verify both actual account settings before each rollout. Free-plan exhaustion can make operations fail; do not upgrade plans or replace the spending constraint with alerts. Current provider policies are documented by [Cloudflare](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [Firebase](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans).

Configure Google and Email/password authentication and the exact authorized origin in Firebase. Only public web fields `apiKey`, `authDomain`, `projectId` and `appId` enter `FIREBASE_PUBLIC_CONFIG`; `FIREBASE_PROJECT_ID` must match. No Gmail access is needed. Firestore server access requires a dedicated database-scoped service account secret. Set `APP_ORIGIN` to the exact HTTPS origin, and configure operators by verified Firebase UID, never email or a client-supplied role.

A finite cap is not an invitation restriction. Before a preview uses real Google identities, set `ADMISSION_UIDS` to the JSON array of designated test UIDs and test both an allowed and an unlisted identity. The committed empty array denies all new UIDs. Existing members can still return. Removing this variable later is a deliberate change to public admission, requiring the applicable cohort gates; do not briefly remove it to bootstrap an operator.

Prepare an ignored `.local/deploy.jsonc` from the committed application template. Because this file lives one directory deeper, use `../src/app.ts` for `main`, `./client-assets` for the asset directory, and `../node_modules/wrangler/config-schema.json` for `$schema`. Review the exact account, Worker name, origin, routing, public Firebase configuration and operator UIDs. Preserve both migration tags and the distinct Firebase bindings. Never point a prototype or probe deployment at this application namespace, or roll a Firebase namespace back to SQL mode.

Three platform secrets are required:

| Secret | Shape | Purpose |
| --- | --- | --- |
| `SESSION_SIGNING_KEY` | One cryptographically random 32-byte key encoded as unpadded base64url | Signs 15-minute workspace capabilities |
| `CREDENTIAL_KEYS` | JSON with `active` and `keys`, mapping version names to independent 32-byte base64url keys | Encrypts members' Apify/OpenAI credentials with AES-GCM |
| `FIRESTORE_SERVICE_ACCOUNT` | Dedicated service-account JSON with database-scoped IAM | Authenticates server-side Firestore requests |

Generate values in an approved local secret manager and keep a separate protected recovery copy. Use the platform secret prompt or dashboard; never put values in shell arguments, Git, build artifacts or chat. The shape of the second secret is `{"active":"v1","keys":{"v1":"<32-byte-base64url-key>"}}`.

After the deployment and secret changes are authorized and reviewed, the operator commands are:

```sh
npx wrangler deploy --config .local/deploy.jsonc --dry-run --outdir .local/reviewed-deploy
npx wrangler deploy --config .local/deploy.jsonc
npx wrangler secret put SESSION_SIGNING_KEY --config .local/deploy.jsonc
npx wrangler secret put CREDENTIAL_KEYS --config .local/deploy.jsonc
npx wrangler secret put FIRESTORE_SERVICE_ACCOUNT --config .local/deploy.jsonc
npx wrangler deployments list --config .local/deploy.jsonc
```

The first deployment must remain disabled. Secret updates can create and deploy another version, so record the final version after all changes, not just the first upload. [Cloudflare secret management](https://developers.cloudflare.com/workers/configuration/secrets/)

Only after the restricted preview is ready should its reviewed configuration enable the APIs for synthetic test identities. Confirm real Google login, renewal, two-browser persistence, account switching, isolation, export/restore and deletion. No import or credential save may initiate a paid call. A live provider test requires its separately agreed account, selected synthetic inputs and charge cap.

## Routine controls and failure handling

Every operator route verifies a Google ID token and a server-controlled UID allowlist. Use an authenticated operator tool with the token kept out of URLs and logs. The current routes are:

| Route | Purpose |
| --- | --- |
| `GET /api/admin/stats` | Membership counts, current application budget reservations and registry used-page bytes |
| `POST /api/admin/reconcile` | Idempotently provision/activate up to 50 reserved members |
| `POST /api/admin/suspend` with `target` | Block a known UID at workspace and registry boundaries |
| `POST /api/admin/resume` with `target` | Resume that suspended UID |

Budget reservations are a conservative application model, not a copy of Cloudflare billing meters. The current daily unit pools are 40,000 ingestion, 30,000 interactive, 20,000 completion and 10,000 cleanup. The cleanup pool is reserved for deletion work; it is not unallocated headroom. The total model assigns 100,000 units, and its relationship to actual platform rows/overhead remains a measurement gate. Track platform requests, rows read/written, CPU, object duration and stored bytes separately, including retries, rejected requests and other applications in the same account.

At quota pressure, close admission and processing first, preserve existing members and finish accepted work within retained headroom. A `429 DAILY_BUDGET` is not permission to retry a paid submission. Daily application counters roll over at UTC midnight; platform availability must also recover. `409` storage errors preserve previous data and require reducing the input or freeing space. Used-page size alone does not prove total allocated storage.

For an uncertain submission, retain the durable `UNCERTAIN` record and ask the member to inspect their own provider account. Never create a replacement run automatically. Known retrieval runs may be polled or stopped; `QUOTA_BLOCKED` jobs require an explicit resume after capacity is available. Resume reconciles retained work rather than repeating submission.

App suspension/deletion invalidates access at the workspace boundary immediately. Firebase deletion, disablement or token revocation is checked during workspace-session renewal and fresh checks protect privileged actions; an already issued capability can remain usable for ordinary requests for up to 15 minutes while its Firebase ID token is still valid. Use app suspension for immediate incident containment rather than relying only on Firebase revocation.

## Keys, deletion and recovery

To rotate the session-signing key, replace it with a fresh independent key. Existing capabilities fail and clients establish a new session; data ownership does not change. Exercise this in the synthetic preview before a real rotation.

To rotate credential encryption, add a new version to `CREDENTIAL_KEYS`, make it active, and retain all versions still referenced by stored records. New or re-saved credentials use the active version. The crypto module has a tested rotation primitive, but there is no fleet-wide migration/retirement tool at this checkpoint. Do not remove an old version merely because a new one is active. First prove that every retained credential has been re-encrypted or removed, including inactive/suspended members, and retain compatible recovery material. At most four versions are accepted. If a key is lost, ask affected members to replace their provider credentials; exports cannot recover them.

Account deletion requires recent Google authentication. An uncertain submission must be resolved first. Once deletion starts, the workspace freeze is atomic with edits and new job submission. The server stops known provider work, removes workspace content and credentials, and only then releases the membership seat. The browser also requests deletion of its Firebase identity. A bounded Registry membership/generation tombstone prevents stale capabilities and late work from recreating the old workspace. Workspace deletion uses `deleteAll()`; constructors and missing-workspace reads do not create SQL or alarms. Provisioning requires a fresh matching reserved membership. Authenticated deletion retries can finish Registry finalization after a successful purge, and reclaim legacy closed-workspace tombstones. Do not describe deletion as erasing the member's external provider account or its provider-side history.

If stopping a known retrieval run fails, membership and data stay frozen. The returning member sees a deletion-recovery screen and can retry, optionally supplying a working Apify token for the same provider account after confirming Google identity again. `POST /api/account/delete` accepts that replacement only while deletion is already paused; it cannot open the workspace or create a new provider run. The replacement is encrypted and removed when cleanup succeeds. If the cleanup allowance is exhausted, retain the freeze, known run and credential until a later permitted retry. Never release a seat by editing the registry alone.

The pre-UAT final-schema experiment retained allocated pages and WAL after closing workspaces. The UAT fix now purges workspace storage to the same empty local baseline, with no tables, KV or alarm after restart and stale requests. Local persistence still includes empty runtime files and test infrastructure; this is not a measured cloud-billing result. Active storage remains unresolved: one 1,000-save source occupied about 10.7 MB across its database/WAL/shared-memory files after churn. Before admitting members or increasing seats, establish actual cloud metering/reclamation and a cumulative deleted-workspace policy. A freed membership seat alone does not establish reclaimed account storage. See [capacity evidence](evidence/P6-LOCAL-CAPACITY.md) and the [UAT update](evidence/UAT.md).

User exports are version-1 portable backups of their saved content and annotations. They deliberately omit credentials, membership state and internal job control records. A user backup is not a complete service disaster-recovery snapshot. Whole-service recovery must preserve Registry generations and deletion tombstones, retained jobs and matching encryption keys. No tested platform snapshot/restore procedure is claimed yet; demonstrate one on the actual Free plan before admitting a cohort that depends on it.

## Rollback

Record a compatible Worker version before each rollout. Close admission and new processing, inspect active/uncertain jobs, and retain the current encryption keyring. A code rollback does not undo a SQL migration, restore deleted data, or reverse a provider charge.

For a reviewed compatible version, the pinned CLI supports:

```sh
npx wrangler deployments list --config .local/deploy.jsonc
npx wrangler rollback <reviewed-version-id> --config .local/deploy.jsonc --message "Restore reviewed compatible build"
```

A rollback restores configuration as well as code; confirm the resulting admission and processing settings remain closed, deploying the compatible build with closed settings if necessary. Do not roll back across incompatible Durable Object class changes. [Cloudflare rollback limitations](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

Before reopening, repeat synthetic login, existing-member access, export, deletion and known-job reconciliation on the deployed version. Data restoration is a separate operation requiring a specific recovery point and verified key/membership consistency. There is no deployed rollback version for the current undeployed application yet.
