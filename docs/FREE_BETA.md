# Free beta scope

The current work is `feat/free-beta-oss`, based on the reviewed product/Firebase checkpoint `da7652b`. Paid implementation stays on `feat/firebase-backend` and `checkpoint/paid-subscriptions-2026-11-15`. This split preserves the unmerged hosted/Firebase foundation; it does not silently merge MRs 7, 8 or 9 into main.

## What users get

The beta is free to try, with no application subscription, card requirement, expiry countdown or organization-point system. The local MIT application remains account-free and runs with Python 3.10+ without third-party runtime dependencies. Hosted sign-in/storage is optional and has its own infrastructure and admission gates.

- Import an official LinkedIn Saved Items archive once and leave most saves dormant.
- Choose a few original saved URLs for explicitly approved retrieval, or supply source text manually.
- Keep Projects, Learning and Experiences separate, including empty named sections.
- Return through Today to continue a read or active build step; when imported links have no continuation yet, Choose from Saves gives one clear starting action. Use global Find when the idea's category is forgotten.
- Keep reading progress and personal notes separate from source text, then export and resume after restart.
- Use dark mode, narrow screens and keyboard controls throughout the flow.

Apify extraction and optional OpenAI classification use each user's own provider accounts and may incur their fees. Importing an archive, saving a key, reading or taking notes never initiates those requests. The synthetic demo and manual/local-rules workflow need no provider keys.

The optional hosted beta keeps its hard storage, item, section, batch and daily-work limits. Current technical ceilings include 1,000 saves and 5,000,000 logical bytes per workspace; longer content can exhaust bytes or internal storage first. Retrieval is bounded to 25 links per hosted run and AI classification to 20 saves per batch. These are implementation ceilings, not a certified user cohort or a promise of free third-party usage. Free-platform exhaustion can interrupt availability. It is not resolved by paying for an upgrade.

## Try the experience first

From a checkout, run:

```sh
python3 server.py
```

Open the separate [synthetic local demo](http://127.0.0.1:8010/?workspace=demo). No Firebase project, provider key or merchant account is required. For a personal trial, use the normal local workspace, choose five saves from your archive, and follow [owner UAT](UAT.md). Keep real content and acceptance notes private.

To inspect authenticated flows with synthetic accounts and mocked providers, run `npm ci` once and `npm run uat` from `hosted/` using Node 24. For optional real Firebase sign-in and cross-device storage, follow [Firebase setup](FIREBASE_SETUP.md) after the local UX is useful. Do not use synthetic identities as a deployment entrypoint.

## What this release does not depend on

Merchant onboarding, pricing, subscriptions, invoices, payment webhooks and refund policy are deferred with the paid branch. Historical payment evidence is not free-beta validation. A retained payment-bearing workspace cannot be silently moved to a build that cannot finish its financial lifecycle. Incompatible background alarms stop locally and bounded repair reports quarantine without changing remote records; use the supported branch to finish recovery and export a v1 backup before moving user content to a clean beta workspace.

The separated runtime and package checks have passed; the release still needs owner acceptance, final candidate CI and privacy/security preparation. Public hosting additionally needs actual identity/provider checks, measured Firestore/platform budgets, a restricted cohort and rollback evidence. Follow [shipping gates](SHIP_PLAN.md); preparing this candidate does not publish a package, change repository visibility or deploy a service.

## UX acceptance focus

Start with five handpicked saves and finish one useful read or project action. Return the next day without instructions and see whether continuing feels easier than reopening LinkedIn Saved Items. Record friction rather than trying to clear the archive.

A capped/ordered Read next shortlist, skip/replace controls and a completed-session summary remain follow-up work until implemented and accepted. The beta should not claim reminders, semantic recommendations or whole-archive automatic processing. [Free-beta evidence](evidence/FREE_BETA.md) records the actual candidate checks separately from [historical product refinements](evidence/PRODUCT_REFINEMENTS.md).
