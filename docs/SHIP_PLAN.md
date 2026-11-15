# Shipping save2ship

The Firebase backend branch supersedes the SQL-only hosting target below. Read [Firebase setup](FIREBASE_SETUP.md) and its [evidence](evidence/FIREBASE.md) before rollout. Both sign-in providers, Firestore rules/IAM, cloud recovery, Enterprise usage units and the reduced 1 GiB storage envelope must pass the revised gates. Use only Firestore-compatible rollback artifacts and the separate Firebase Durable Object namespaces; the earlier 500-seat progression is not approved for this backend.

The intended next release has two destinations: the account-free local open-source package and a restricted hosted beta. They have separate release gates. Finishing local development and passing mocked end-to-end tests does not establish live Google/provider behavior or a 500-member capacity guarantee.

This plan starts from `feat/hosted-workbench`, based on the P1 runtime checkpoint `34e2395`. Phase checkpoints are P2 storage `983d798`, provider adapters/encryption `5424f55`, authenticated backend/jobs `09589f9` and browser integration `3acc003`. The runtime dependency is ahead of main and must be reviewed and integrated explicitly. The final release record must replace these development references with the actual candidate commit, CI run and artifact hashes.

## 1. Freeze a reviewed candidate

Finish independent reviews of authentication, membership, jobs, import/restore and browser behavior. Resolve all tenant-isolation, data-loss, duplicate-charge and quota-bypass findings. Commit phases separately, without em dashes in commit messages. Review the final diff and build from a clean checkout of the chosen commit.

Run the Python/UI/package checks in [RELEASING.md](RELEASING.md), plus hosted types, tests, browser E2E, application dry run and `node scripts/check-release.mjs` as described in [HOSTED_OPERATIONS.md](HOSTED_OPERATIONS.md). CI uses generated identities, synthetic saved posts and mocked providers. Record failed, passed and unrun checks distinctly.

The hosted report in `.local/release-check/report.json` records the exact commit, dirty-tree status, lockfile/configuration hashes, schema and bundle/asset hashes. A report with `dirty: true` is development evidence; rebuild the final candidate from a clean checkout. The synthetic browser screenshots/report and CI artifacts remain private development evidence until explicitly reviewed for publication.

## 2. Release the local project

The local package can ship independently of hosted capacity once its own gates pass:

- A fresh developer completes installation, sample import, organisation across all three spaces, reading/notes, export and restart recovery without an account or provider key.
- Wheel and source archive pass clean installation on the supported CI matrix. Choose the release version, rebuild fresh artifacts and record their SHA-256 hashes.
- Review tracked content and Git history for secrets and personal data, then verify the private vulnerability-reporting route. An archive filename check is insufficient.
- Review the README, changelog, privacy wording and source/provider limitations. Confirm package-index ownership and the intended repository destination.

Repository visibility, creating a public release and publishing the package are separate external actions. The current CI does none of them. Prepare those concrete results first; perform each only within the user's release authorization. Do not make the local install depend on Firebase, Cloudflare or hosted availability.

## 3. Validate a restricted hosted preview

The committed manifest remains disabled with a zero-member cap. Before a real preview, complete these gates:

| Gate | Required evidence |
| --- | --- |
| Free accounts | Current Cloudflare Workers Free and Firebase Spark settings, with no billing upgrade or linked Cloud Billing account |
| Identity configuration | Google and Email/password enabled, mandatory TOTP for password sessions, Identity Platform on Spark with billing and SMS disabled, exact authorized origin, public app configuration and verified operator UIDs |
| Restricted preview | `ADMISSION_UIDS` names only designated test identities; allowed/unlisted identity checks pass before opening a small cap |
| Secrets and artifacts | Platform-only signing/encryption secrets, recovery custody, reviewed deployment configuration and exact artifact hashes |
| Live authentication | Real Google login, refresh, sign-out, account switch, two-browser resume, expiry/revocation and immediate app suspension |
| Storage and recovery | Final-schema allocated-storage/cloud-meter evidence, cumulative deleted-workspace/reclamation policy, rejected-write behavior, export/restore, frozen-deletion recovery and compatible deployed rollback |
| External providers | Separately authorized small live retrieval/classification checks, source fidelity and unavailable outcomes, actual charges and uncertain-submission reconciliation |
| Product acceptance | Resolve the three trust issues in the [product audit](evidence/PRODUCT_AUDIT.md), then demonstrate a first useful read/action and next-day continuation with a small chosen portion of the owner's archive |

The P1 probe verified a small synthetic cloud path and was retired. Its physical-storage accounting and some metering results remain unresolved. The [final-schema local experiment](evidence/P6-LOCAL-CAPACITY.md) accepted 1,000 typical saves but hit limits at 931 Unicode, 847 richer and 163 long-note saves. Every complete backup restored to a fresh workspace; Unicode churn exposed reduced reinsertion headroom in the original. A typical 1,000-save source retained about 10.7 MB across local database/WAL/shared-memory files, and the pre-UAT close implementation retained allocation. The [UAT fix](evidence/UAT.md) now purges deleted workspaces to an unchanged empty local baseline; cloud-meter evidence remains open. The 7 MB used-page guard does not prove an 8 MB physical bound. Require actual cloud metering/reclamation and a cumulative deleted-workspace policy before admitting members or growing seats; revise the storage design, allocation or cap if the evidence requires it.

Follow [HOSTED_OPERATIONS.md](HOSTED_OPERATIONS.md) for the exact preparation, secret, deployment and rollback procedure. Do not run the Python single-user server behind a public proxy. Do not deploy the test authentication harness.

## 4. Admit only the measured cohort

After the restricted preview and all gates pass, the first proposed real cohort is **10 members**. This is a proposal, not current admission or a capacity claim. Subsequent ceilings are 50, 100, 250 and 500, each requiring a separate evidence review.

Observe at least a complete UTC quota window and a representative import/retrieval cycle before increasing admission. Measure total retained workspaces, including closed objects, separately from concurrent usage. Include authentication failures, retries, rejected writes, ordinary reading, exports, deletion, provider completion and other account workloads. The application's 10,000-unit cleanup pool is reserved, not spare unallocated capacity; measure its sufficiency and the full 100,000-unit model against actual platform work. Preserve completion and recovery capacity. Reduce or hold admission if measurements do not support the next cohort; never upgrade billing to meet the target.

At each stage, record the admitted cap, active users, retained items/bytes, platform requests/read/write/duration/CPU metrics, failures, provider behavior, artifact/version IDs and rollback outcome. The 500-member, 1,000-save and 5 MB logical/8 MB physical policy remains a planning target until the evidence supports it. Advertise only the verified cohort and limits.

## Release decision record

The coordinator completes this record after the relevant checks; blank fields are gates, not implied success:

```text
Candidate commit and clean working tree:
Independent review findings resolved:
CI runs and test results:
Local package version, wheel/sdist hashes and fresh-developer trial:
Repository/package destination and publication authorization:
Hosted bundle/assets/configuration/lockfile hashes:
Cloudflare account/Free verification and Firebase project/Spark verification:
Origin, Worker version, namespace/schema and admitted cap:
Live identity and bounded provider evidence:
Final-schema storage/CPU/request/read/write/duration measurements:
Export, deletion, recovery point and compatible rollback evidence:
Remaining limitations and decision:
```

No publication, application deployment or nonzero cohort is authorized merely by completing this document.
