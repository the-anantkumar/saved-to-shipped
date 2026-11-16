# Free beta release checklist

Release target: **Saved to Shipped v0.4.0b1**, the free local MIT application. The optional Firebase/Cloudflare service has separate gates below. This is the working checklist for the requested release; unchecked rows are not completed merely because their configuration files exist.

## Product foundation

- [x] Keep the local app account-free and without third-party runtime dependencies.
- [x] Separate subscription checkout, paid tiers and organization credits from the beta source and production build.
- [x] Preserve Projects, Learning and Experiences, source/notes separation, reading progress, search and export.
- [x] Fix queued-reader hydration, empty sections and saved weekly preferences.
- [x] Make Today useful for imported links and one or two available continuations.
- [x] Keep provider keys user-owned; importing or saving keys does not start a provider request.
- [x] Verify the local and hosted retrieval paths submit exactly the selected IDs with the approved charge cap; local API regression fixed in `136c14c`.
- [x] Polish first use, Today, reading, notes and setup surfaces; retain drafts until explicit discard and protect them from delayed polling.
- [x] Owner reviewed the synthetic preview and requested the free release.
- [ ] Complete the representative five-save and next-day owner trial in [UAT](UAT.md); the accepted sample preview is not that full trial.

The separated implementation at `7505833` passed CI and independent review. Its [evidence](evidence/FREE_BETA.md) does not replace checks on the final versioned release candidate.

## Repository cleanup and presentation

- [x] Give the README a short local-first path, feature overview, provider-cost boundary and useful links.
- [x] Preserve detailed configuration, troubleshooting and provider contracts in [Usage](USAGE.md).
- [x] Add a [documentation index](README.md) and inspect the initial synthetic desktop/mobile screenshots.
- [x] Refresh and inspect the final synthetic public screenshot set, including the README hero/mobile; the 37-view layout pass is recorded in [product polish evidence](evidence/PRODUCT_POLISH.md).
- [ ] Finish tracked-file and reachable-history privacy review, including example data and credentials.
- [ ] Verify ignore rules and package boundaries exclude archives, personal data, secrets, generated output and authenticated state.
- [ ] Check issue templates, contribution guidance and license metadata.
- [x] Correct the private-reporting sequence: review privacy before visibility, then enable and verify reporting before announcement.
- [ ] Validate all changed local links, asset paths, metadata and whitespace on the final candidate.

Screenshots are actual rendered synthetic fixtures, not personal workspaces or invented product mockups.

## Local open-source release

- [x] Set runtime version `0.4.0b1` and prepare its changelog/release-note source.
- [x] Run the scoped product regressions: 91 Python, 36 shared JavaScript, five local/shared interaction checks, and product/reader/E2E/auth/MFA/UAT browser groups. See [product polish evidence](evidence/PRODUCT_POLISH.md).
- [ ] Record final clean-candidate artifact hashes and CI after the last code/documentation/assets commit.
- [ ] Build a fresh source archive and wheel from the source archive.
- [ ] Pass strict package metadata/content checks and install each artifact in a clean environment.
- [ ] Confirm launch, synthetic/manual organization, reading, private export and restart recovery from installed artifacts.
- [x] Complete the scoped local OSS product review; selected-source retrieval and late-poll draft-loss findings are independently closed.
- [ ] Finish final artifact/publication review on the committed candidate.
- [ ] Merge the reviewed candidate to the intended main, retaining explicit treatment of inherited hosted/Firebase foundations.
- [ ] Record the exact commit, clean-tree status, CI URLs, artifact names and SHA-256 hashes.
- [ ] After the final privacy review, make the repository public.
- [ ] Enable private vulnerability reporting and verify the reporting route before announcement.
- [ ] Publish the GitHub beta release with reviewed artifacts and known limitations.
- [ ] Verify the public release page, download, installation instructions and asset links without relying on an authenticated session.

The [launch handoff](LAUNCH_HANDOFF.md) keeps the remaining commands and hosted configuration in one place. PyPI publication is a separate optional distribution step. It needs verified package ownership and an appropriate publishing identity; it must not be implied by a GitHub release or a local wheel build.

## Optional hosted beta deployment

- [x] Keep the committed application defaults closed, with zero admitted seats and no paid-plan configuration.
- [x] Keep Firebase identity/Firestore access, tenant isolation, encrypted provider credentials and deletion recovery in the hosted implementation.
- [ ] Verify current Cloudflare Free and Firebase Spark settings without enabling overage billing.
- [ ] Prepare exact origin/domain, scoped secrets, namespace bindings and Firestore-compatible rollback artifacts.
- [ ] Pass the final closed Worker/assets dry run and production dependency-boundary checks.
- [ ] Calibrate daily work reservations against actual platform use; the current fleet-wide limits can bind well before storage fills.
- [ ] Measure retained storage, indexes, cold cache reconstruction, reads/writes, egress and cleanup on the deployed backend.
- [ ] Add or verify usable capacity warnings and admission/ingestion pause behavior before exhaustion.
- [ ] Test real sign-in, mail delivery, cross-browser resume, export, deletion and rollback with designated accounts.
- [ ] Admit a measured small cohort, starting with the proposed 10-member canary only after its gates pass.
- [ ] Review measurements before increasing toward 25, 50 or 100 members. These are proposed stages, not certified capacity.

Hosted setup is not required to run the local release. [Shipping](SHIP_PLAN.md) and [operations](HOSTED_OPERATIONS.md) own the deployment procedure. Do not publish the synthetic UAT entrypoint or publicly proxy the single-user Python server.

## After the first beta

- [ ] Collect first-session and next-day friction reports with synthetic or privately handled examples.
- [ ] Improve Read next ordering/capping, skip/replace controls and the completed-session stopping point.
- [ ] Review source fidelity and attachment/unavailable outcomes through explicitly bounded provider checks.
- [ ] Keep subscription work deferred unless its scope is reopened.
