# Roadmap

Saved to Shipped should help you use something you saved, then give you a reason to return. The next work is about making that loop easier.

## Available now

The [v0.4.0b1 local beta](https://github.com/the-anantkumar/saved-to-shipped/releases/tag/v0.4.0b1) is published under MIT. It includes LinkedIn ZIP/CSV import, Projects, Learning and Experiences, reading progress, notes, Today, dark mode and private exports. Optional retrieval and AI organization use your own provider accounts. The app runs without an account or runtime dependencies.

The separate hosted implementation includes Google and verified email/password sign-in, required authenticator verification for password accounts, private Firestore storage and technical usage limits. Public admission is still closed. See the [remaining deployment checks](docs/SHIP_PLAN.md).

## Next

- Collect feedback from a five-save first session and a next-day return. Can someone find and finish one useful thing without instructions?
- Make Read next a manageable shortlist, with clearer ordering and skip/replace controls.
- Give completed reading sessions a useful stopping point.
- Check retrieved text, attachments and unavailable posts against a wider set of originals. Keep source coverage and provider costs visible.
- Measure the hosted service's actual free-tier storage, operations and recovery costs before admitting a small cohort.

The [release checklist](docs/RELEASE_CHECKLIST.md) tracks these open checks. Deployment capacity is not established by the local tests or the original 500-member planning target.

## Later

Additional source adapters, better attachment/linked-article coverage and semantic grouping need evidence that they improve the core workflow. LinkedIn remains the supported web import source; Reddit and Instagram are not part of this beta.

Monetization work belongs on `payment`. It will share product fixes from `main`, while the OSS app remains free and usable without a subscription. The [branch guide](CONTRIBUTING.md#branches-and-pull-requests) explains the split and where to find the archived billing prototype.

For completed changes, use the [changelog](CHANGELOG.md). For architecture and earlier capacity experiments, use the [documentation index](docs/README.md).
