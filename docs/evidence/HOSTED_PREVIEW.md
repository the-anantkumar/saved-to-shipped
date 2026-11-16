# Restricted hosted preview

Date: 2026-11-17 (Asia/Kolkata). Current source: `0297693a791f1a92670e14fd63728249d2e88361`. Initial deployment: `192680de33e8ac299155ba3d1394027f0286e650`.

The production app is deployed at [save2ship-beta.save2ship-hosted.workers.dev](https://save2ship-beta.save2ship-hosted.workers.dev) for the existing test member. This is an owner acceptance preview, not an open beta. The public local release remains [v0.4.0b1](RELEASE_0_4_0b1.md); its tag and downloads were not changed.

## Live configuration

| Control | Deployed setting |
| --- | --- |
| API | Enabled after the initial disabled deployment |
| Admission | Closed, `BETA_CAP=0`, with the designated test identity configured; the existing active member can return |
| Processing | Closed; archive imports and new provider jobs are paused |
| Operator access | Empty allowlist |
| Hosting | Cloudflare Workers Free, confirmed in the dashboard as the current $0 plan |
| Database | Firebase Spark, billing disabled with no linked billing account; existing Enterprise Native database in Mumbai (`asia-south1`) |

The initial deployment failed to open the workspace after Google sign-in. The loading fix below is deployed, and the existing member confirmed that the workspace is visible after a fresh reload. Manual capture, reading, notes and export remain unverified on this deployment. Closing processing does not cancel retained jobs. Preparation confirmed no retained jobs or wake intents before enabling this preview. No paid provider requests were made.

The production Worker uses the Firebase workspace and registry namespaces, preserving both migration tags. This deployment changed no Firestore schema or workspace content. The three required server secrets were installed in the platform store, retaining the existing signing key and credential keyring. Only the exact Worker hostname was added to Firebase authorized domains; provider and MFA settings were preserved.

## Completed checks

- `npm run release:check` passed from both clean source commits above. The production entrypoint and nine public frontend assets passed the release boundary checks.
- All nine assets in the initial deployment matched the reviewed build by SHA-256. The initial disabled API returned `503` for private access.
- Independent anonymous checks on the enabled preview passed: public configuration exposes only the expected fields; protected APIs return `401`; foreign origins and cross-site requests return `403`; client-supplied ownership selectors return `400`; private configuration and fixture paths return `404`.
- The page, stylesheet and favicon load successfully. Security headers were checked on the live responses.
- The restricted configuration and admission behavior passed independent review and focused synthetic authentication/admission checks.
- The welcome screen was reviewed in the browser. On the initial version, Google sign-in completed, but authenticated `/api/state` returned `503` and the workspace displayed “Storage is temporarily unavailable.”
- After the fix, all nine public assets matched the clean build by SHA-256. The enabled configuration, private API `401`, foreign-origin `403` and private-path `404` checks passed again.
- The existing member confirmed that a fresh reload of the fixed version opened the workspace, including Today, Projects and Learning.

Private configuration, credentials, authenticated state and raw cloud reports remain outside source control. These checks establish deployment, the anonymous boundary and user-confirmed authenticated workspace loading. Writes and their persistence, a second browser and measured cohort capacity remain unverified on this deployment.

## Workspace loading fix

Cold workspace loading fetched Firestore records ten at a time. A large workspace could therefore exceed the Workers Free limit of [50 external calls per request](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/) before its local cache was ready.

Commit `0297693` fetches 100 records per page and limits hydration to 32 pages total across two checkpoint attempts. The 16 MiB response bound, atomic cache installation and identity checks are unchanged. If checkpoint changes exhaust the shared budget, the request fails with a retryable error rather than installing partial data. No plan upgrade, schema change or authoritative workspace-content change was needed.

Verification passed:

- Type checking, eight client checks and fourteen emulator workspace checks.
- A 2,400-record regression and 801 synthetic saves, preserving notes and reading progress; the old bundle fails the same subrequest-limit regression with `SYNTHETIC_SUBREQUEST_LIMIT`.
- The checkpoint-race case fails safely without a partial cache installation.
- The full hosted suite: 127 passed, 17 skipped, zero failed. Skipped checks are not counted as evidence.
- Independent review and a fresh release check from clean commit `0297693`.

The fixed Worker is deployed. The existing member confirmed authenticated workspace loading after a fresh reload; this does not establish new-write persistence or two-browser recovery.

## Versions and rollback

| Version | Purpose |
| --- | --- |
| `792db0ba-2d99-41bf-bf99-a7231faefed5` | Initial disabled deployment |
| `94a20f56-d1d8-4b76-bfca-aa14ed4f2a37` | Disabled configuration with all three secrets installed; compatible rollback target |
| `62f48942-1263-4b6a-b2bc-bb072d78af4f` | Initial enabled preview; workspace loading failed |
| `4b0b17ab-1f7a-4e51-bbc5-1595cecd09dc` | Current restricted preview with the workspace-loading fix |

The current version receives 100% of traffic, verified against deployment `cd9ee70e-f9b0-4ca0-98c4-b9736337d70c`, created at `2026-11-16T21:28:49.278794Z`.

Use the [rollback procedure](../HOSTED_OPERATIONS.md#rollback) with the disabled version above if the preview must be withdrawn. It preserves the Firebase implementation and keys while disabling access, admission and processing. A live rollback and restore exercise is still pending; code rollback does not restore deleted data or reverse provider work.

## Still pending

- Saving, reading, notes, export and reload persistence on this origin.
- Real Email/password plus TOTP, mail delivery, session lifecycle and unlisted-account checks on the deployed app.
- Actual free-tier storage/operation metering, daily-work calibration, cloud recovery and deletion/reclamation measurements.
- Live provider coverage and charges, under a separate explicit test allowance.
- The five-save and next-day product trial.

Keep admission and processing closed while these checks are completed. The [shipping plan](../SHIP_PLAN.md) owns the gates for a larger cohort; the earlier 500-member target is not a measured capacity claim.
