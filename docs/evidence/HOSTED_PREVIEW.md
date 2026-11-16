# Restricted hosted preview

Date: 2026-11-17 (Asia/Kolkata). Source: `192680de33e8ac299155ba3d1394027f0286e650` on `main`.

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

Workspace opening is currently blocked by “Storage is temporarily unavailable” after Google sign-in. Manual capture, reading, notes and export therefore remain unverified on this deployment. Closing processing does not cancel retained jobs. Preparation confirmed no retained jobs or wake intents before enabling this preview. No paid provider requests were made.

The production Worker uses the Firebase workspace and registry namespaces, preserving both migration tags. This deployment changed no Firestore schema or workspace content. The three required server secrets were installed in the platform store, retaining the existing signing key and credential keyring. Only the exact Worker hostname was added to Firebase authorized domains; provider and MFA settings were preserved.

## Completed checks

- `npm run release:check` passed from the clean source commit above. The production entrypoint and nine public frontend assets passed the release boundary checks.
- All nine deployed assets matched the reviewed build by SHA-256. The initial disabled API returned `503` for private access.
- Independent anonymous checks on the enabled preview passed: public configuration exposes only the expected fields; protected APIs return `401`; foreign origins and cross-site requests return `403`; client-supplied ownership selectors return `400`; private configuration and fixture paths return `404`.
- The page, stylesheet and favicon load successfully. Security headers were checked on the live responses.
- The restricted configuration and admission behavior passed independent review and focused synthetic authentication/admission checks.
- The welcome screen was reviewed in the browser. Google sign-in completed, but authenticated `/api/state` returned `503` and the workspace displayed “Storage is temporarily unavailable.”

Private configuration, credentials, authenticated state and raw cloud reports remain outside source control. These checks establish deployment and the anonymous boundary. Authenticated workspace opening is blocked; writes, reload persistence, a second browser and measured cohort capacity remain unverified on this deployment.

## Versions and rollback

| Version | Purpose |
| --- | --- |
| `792db0ba-2d99-41bf-bf99-a7231faefed5` | Initial disabled deployment |
| `94a20f56-d1d8-4b76-bfca-aa14ed4f2a37` | Disabled configuration with all three secrets installed; compatible rollback target |
| `62f48942-1263-4b6a-b2bc-bb072d78af4f` | Current restricted preview with APIs enabled |

The current version receives 100% of traffic, verified against deployment `2eef980b-50fc-4508-8e01-48654643e1d1`, created at `2026-11-16T21:11:49.705165Z`.

Use the [rollback procedure](../HOSTED_OPERATIONS.md#rollback) with the disabled version above if the preview must be withdrawn. It preserves the Firebase implementation and keys while disabling access, admission and processing. A live rollback and restore exercise is still pending; code rollback does not restore deleted data or reverse provider work.

## Still pending

- Resolve the storage error and verify authenticated workspace opening.
- Saving, reading, notes, export and reload persistence on this origin.
- Real Email/password plus TOTP, mail delivery, session lifecycle and unlisted-account checks on the deployed app.
- Actual free-tier storage/operation metering, daily-work calibration, cloud recovery and deletion/reclamation measurements.
- Live provider coverage and charges, under a separate explicit test allowance.
- The five-save and next-day product trial.

Keep admission and processing closed while these checks are completed. The [shipping plan](../SHIP_PLAN.md) owns the gates for a larger cohort; the earlier 500-member target is not a measured capacity claim.
