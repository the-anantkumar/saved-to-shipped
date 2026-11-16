# Remaining launch handoff

**[Saved to Shipped v0.4.0b1](https://github.com/the-anantkumar/saved-to-shipped/releases/tag/v0.4.0b1) is published.** The local wheel/source downloads, clean installs and restart checks passed. Main contains the reviewed source. [Release evidence](evidence/RELEASE_0_4_0b1.md) records commits, CI and hashes; [Releasing](RELEASING.md) keeps the reusable publication procedure.

## Owner feedback

Use the published local app for the [five-save and next-day trial](UAT.md). Record confusing steps and whether one saved idea becomes useful without clearing the archive. The sample preview was accepted; this personal usefulness feedback remains open and does not require cloud setup or a subscription.

## Optional hosted beta

Public hosted admission remains closed. The existing Firebase development path is in [Firebase setup](FIREBASE_SETUP.md). From `hosted/`, use Node 24 and the pinned dependencies:

```sh
npm ci
npm run typecheck
npm run release:check
```

The last command validates a closed production bundle and does not deploy. Prepare the ignored `hosted/.local/deploy.jsonc` as described in [Hosted operations](HOSTED_OPERATIONS.md#prepare-a-real-preview):

| Setting | Required configuration |
| --- | --- |
| Entry/assets | `main: ../src/app.ts`; assets directory `./client-assets`; preserve Firebase namespace bindings and both migration tags. |
| API/admission | Keep `HOSTED_ENABLED=false`, `ADMISSION_OPEN=false`, `PROCESSING_OPEN=false`, `BETA_CAP=0` for the first closed deployment. |
| Identity/origin | Exact HTTPS `APP_ORIGIN`; matching `FIREBASE_PROJECT_ID`/public configuration; authorized Firebase domain; explicit operator/test UIDs. |
| Storage/accounts | Existing Enterprise Native database `save2ship`; scoped service account; Cloudflare Free and Firebase Spark without overage billing. |
| Server secrets | `SESSION_SIGNING_KEY`, `CREDENTIAL_KEYS`, `FIRESTORE_SERVICE_ACCOUNT`, supplied through the platform prompt/store; no values in source, shell arguments or chat. |

After reviewing the exact account, origin and configuration, the closed-config dry run is:

```sh
npx wrangler deploy --config .local/deploy.jsonc --dry-run --outdir .local/reviewed-deploy
```

Before deployment/admission, finish the existing [shipping checks](SHIP_PLAN.md): current free-plan verification, daily-work reservation calibration, measured storage/operations/egress, cold recovery, real-account acceptance and compatible rollback. [Hosted operations](HOSTED_OPERATIONS.md) contains the deployment and secret commands. Start the proposed 10-member canary only after those checks pass, then review actual usage before increasing the cohort.

Do not deploy the synthetic UAT entrypoint or publicly proxy the single-user Python server. The local OSS release remains usable independently.

## Optional distribution and future product work

PyPI is not published. Package ownership, publishing identity and a verified upload are separate optional work; the public GitHub release already provides the installation route.

Read next ordering/capping, skip/replace controls, a completed-session summary and broader source fidelity remain follow-ups in the [checklist](RELEASE_CHECKLIST.md). Subscription work stays deferred.
