# Free beta

[Saved to Shipped v0.4.0b1](https://github.com/the-anantkumar/saved-to-shipped/releases/tag/v0.4.0b1) is the published local MIT app. `main` contains the OSS version. Future monetization work is separate on `payment`; see the [branch guide](../CONTRIBUTING.md#branches-and-pull-requests).

## What is included

The app runs with Python 3.10+ and no third-party runtime dependencies. It has no account requirement, subscription, card requirement, organization credits or expiry date.

- Import an official LinkedIn Saved Items ZIP or CSV.
- Choose a few saved URLs for approved retrieval, or paste source text yourself.
- Organize Projects, Learning and Experiences, including empty named sections.
- Return through Today to continue a read or project step. Use global Find when you forget where an idea belongs.
- Keep reading progress and personal notes separate from source text. Export and resume after restart.
- Use light/dark/system appearance, narrow layouts and keyboard controls.

Apify retrieval and optional OpenAI classification use your own provider accounts and may incur their fees. Importing, saving a key, reading and taking notes never starts those requests. Manual text, local rules and the sample workspace need no provider keys.

## Try it

From a checkout:

```sh
python3 server.py
```

Open the [sample workspace](http://127.0.0.1:8010/?workspace=demo), or choose five saves from your own archive and follow the [acceptance checklist](UAT.md). Keep personal content and feedback examples private.

The release passed package, browser and clean-install checks, recorded in the [release evidence](evidence/RELEASE_0_4_0b1.md). The personal five-save and next-day usefulness trial is still open. A smaller Read next shortlist, skip/replace controls and a session summary are future work; the beta does not promise reminders or whole-archive automatic processing.

## Optional hosted version

The hosted implementation adds Google and verified email/password sign-in, authenticator verification for password accounts, and private Firestore storage. **Public admission is closed.** Local use does not depend on hosted availability.

To try hosted screens with synthetic accounts and mocked providers, use Node 24 and run `npm ci`, then `npm run uat` from `hosted/`. For real account configuration, follow [Firebase setup](FIREBASE_SETUP.md). The test entrypoint is not a deployment target.

Implemented technical ceilings include 1,000 saves and 5,000,000 logical bytes per workspace, 25 links per retrieval run and 20 saves per AI batch. Long content can exhaust storage before the save count. These limits do not certify a user cohort or include free provider usage. Opening admission still requires the [hosted rollout checks](SHIP_PLAN.md); free-tier exhaustion may interrupt availability.

## Earlier payment workspaces

The OSS app cannot finish the archived prototype's financial lifecycle. Do not point it at a payment-bearing workspace. Use a compatible version to finish recovery and export a version-1 backup before moving user content into a clean free-beta workspace. Incompatible background alarms stop locally, and bounded repair quarantines the workspace without changing remote records. The [archived prototype](https://github.com/the-anantkumar/saved-to-shipped/tree/da7652bc0919b4d7cc1a04a2c627cb01bc6b926e) is retained for recovery and future payment development.
