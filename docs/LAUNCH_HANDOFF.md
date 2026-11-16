# Remaining launch handoff

**[Saved to Shipped v0.4.0b1](https://github.com/the-anantkumar/saved-to-shipped/releases/tag/v0.4.0b1) is published.** The local wheel/source downloads, clean installs and restart checks passed. Main contains the reviewed source. [Release evidence](evidence/RELEASE_0_4_0b1.md) records commits, CI and hashes; [Releasing](RELEASING.md) keeps the reusable publication procedure.

## Owner feedback

Google sign-in reached authenticated workspace initialization on the [restricted hosted preview](https://save2ship-beta.save2ship-hosted.workers.dev), but opening the workspace failed with “Storage is temporarily unavailable.” Resolve that blocker and repeat the opening check before testing whether a manual save and note survive reload, and whether export and sign-out work. Archive imports and provider processing are paused. The [deployment record](evidence/HOSTED_PREVIEW.md) lists the live settings and completed checks.

Use the published local app for the full [five-save and next-day trial](UAT.md), including archive import. Record confusing steps and whether one saved idea becomes useful without clearing the archive. This usefulness feedback remains open and needs no subscription.

## Before wider hosted access

1. Finish real session checks on the deployed origin: verified Email/password with TOTP, refresh, sign-out, account switching and two-browser resume. Check an unlisted identity as well as the existing member.
2. Measure Firestore storage and operations, Cloudflare requests/CPU/duration, and the daily-work reservations against the actual free allowances.
3. Exercise cloud recovery, export/restore, deletion/reclamation and compatible rollback with synthetic workspaces. Retain protected recovery copies of the server keys.
4. Validate provider retrieval/classification only with a separately approved account, selected inputs and charge cap before enabling processing.
5. Review the evidence and [rollout gates](SHIP_PLAN.md) before opening a small cohort. The proposed 10-member canary is not yet authorized by capacity measurements.

Cloudflare Workers Free, Firebase Spark without linked billing, platform secrets and the authorized Firebase domain are configured. [Hosted operations](HOSTED_OPERATIONS.md) contains the reusable deployment and rollback commands; [Firebase setup](FIREBASE_SETUP.md) covers backend configuration. Recheck the free plans before future rollouts. Keep public admission closed until the remaining gates pass.

## Optional distribution and future product work

PyPI is not published. Package ownership, publishing identity and a verified upload are separate optional work; the public GitHub release already provides the installation route.

Read next ordering/capping, skip/replace controls, a completed-session summary and broader source fidelity remain follow-ups in the [checklist](RELEASE_CHECKLIST.md). Subscription work stays deferred.
