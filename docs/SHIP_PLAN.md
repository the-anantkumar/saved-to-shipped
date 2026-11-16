# Hosted rollout gates

The local [v0.4.0b1 beta is published](evidence/RELEASE_0_4_0b1.md). This page covers the remaining hosted rollout. Package publication follows [Releasing](RELEASING.md); configuration and deployment commands are in [Hosted operations](HOSTED_OPERATIONS.md).

`main` contains the free app and its optional hosted implementation. A [restricted preview is deployed](evidence/HOSTED_PREVIEW.md) for the existing test member. Public admission remains disabled with `BETA_CAP=0`; that setting blocks new seats without evicting existing members. Archive imports and provider processing are paused. The `payment` branch is separate development work and is not needed for this rollout.

## Prepare the current backend

Use the Firebase/Firestore implementation, its separate Durable Object namespaces and Firestore-compatible rollback artifacts. The earlier SQL-only experiments are historical. Read [Firebase setup](FIREBASE_SETUP.md) and its [verification record](evidence/FIREBASE.md) before choosing a deployment configuration. The reduced 1 GiB storage envelope and Enterprise usage units need actual measurement; the earlier 500-member plan is not an approved capacity claim.

Build from a clean commit after relevant tests and independent review pass. Run the Python/UI/package checks in [Releasing](RELEASING.md), plus hosted types, tests, browser E2E and `npm run release:check`. Keep the report from `.local/release-check/report.json`: it identifies the commit, tree status, configuration/lockfile hashes, schema and bundle/assets. A dirty-tree report is development evidence, not a release artifact record.

## Before opening admission

The initial deployment, platform secret installation, exact Firebase domain and current free-plan checks are complete. Real-account acceptance, capacity and recovery gates remain open. The [deployment record](evidence/HOSTED_PREVIEW.md) separates those outcomes from the full cohort requirements below.

| Gate | Required check |
| --- | --- |
| Free accounts | Confirm Cloudflare Workers Free and Firebase Spark, without a billing upgrade or linked Cloud Billing account. |
| Identity | Configure Google and Email/password, required TOTP for password sessions, Identity Platform on Spark with billing/SMS disabled, the exact authorized origin and verified operator UIDs. |
| Restricted access | Set `ADMISSION_UIDS` to designated test identities. Check allowed and unlisted accounts before opening a cap. |
| Secrets and artifacts | Store signing/encryption secrets on the platform, establish recovery custody and record reviewed configuration/artifact hashes. |
| Real sessions | Check Google login, email/TOTP, refresh, sign-out, account switching, two-browser resume, expiry/revocation and immediate app suspension. |
| Storage and recovery | Measure retained storage and operations on the final schema. Check rejected writes, export/restore, frozen-deletion recovery, cleanup/reclamation and compatible rollback. |
| Providers | With a separately approved budget, check a small live retrieval/classification batch, source coverage, unavailable results, charges and uncertain-submission reconciliation. |
| Product | Complete the [five-save and next-day trial](UAT.md), including reading, notes, empty sections and persisted weekly preferences. No payment setup is needed. |

Do not deploy the synthetic authentication harness or expose the single-user Python server through a public proxy. Keep screenshots and reports free of personal content and credentials.

## Capacity evidence still needed

The retired P1 probe and [local final-schema experiment](evidence/P6-LOCAL-CAPACITY.md) do not establish Firestore capacity. The local experiment reached 1,000 typical saves but lower counts for richer text and long notes. Its physical allocation exceeded the proposed 8 MB workspace budget in some cases. The [deletion fix](evidence/UAT.md) returned local workspaces to an empty baseline, but cloud reclamation and cumulative deleted-workspace costs still need measurement.

Measure ordinary reading, imports, failed authentication, retries, rejected writes, exports, deletion and provider completion. Preserve completion and recovery capacity: the 10,000-unit cleanup pool is reserved, and the full 100,000-unit daily model must be calibrated against actual platform work. Hold or reduce admission if the measurements do not fit the free tier.

## Open a small cohort

After the checks above pass, start with the proposed **10-member canary**. Observe a complete UTC quota window and a representative import/retrieval cycle before considering more members. The original targets of 500 members, 1,000 saves per member, 5 MB logical data and an 8 MB physical workspace remain planning limits until supported by the deployed backend.

For each increase, record the admitted cap, active users, retained items/bytes, platform requests, reads/writes, duration/CPU, failures, provider behavior, deployed version and rollback outcome. Review the evidence before changing admission. Never enable overage billing to meet a target.
