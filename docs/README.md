# Documentation

Start with the [README](../README.md) to run the local app. The free [v0.4.0b1 beta](https://github.com/the-anantkumar/saved-to-shipped/releases/tag/v0.4.0b1) is available now. A [restricted hosted preview](evidence/HOSTED_PREVIEW.md) is deployed; public admission is still closed.

## Use the app

| Guide | Read it for |
| --- | --- |
| [Usage](USAGE.md) | Import, reading, projects, optional providers, configuration, exports and troubleshooting. |
| [Demo](DEMO.md) | Sample content without accounts or provider keys. |
| [Free beta](FREE_BETA.md) | Included features, provider costs and current limits. |
| [Acceptance testing](UAT.md) | A five-save first session, restart recovery and a next-day return. |
| [Source fidelity](LIVE_CHECK.md) | Checked retrieval behavior and incomplete coverage. |

## Develop

- [Contributing](../CONTRIBUTING.md): branches, test fixtures and verification commands.
- [Architecture](../ARCHITECTURE.md), [product specification](../PRODUCT_SPEC.md) and [roadmap](../ROADMAP.md).
- [Security](../SECURITY.md): private reporting and the local/hosted trust boundary.
- [Hosted guide](../hosted/README.md): Node tooling and mocked acceptance tests.
- [Agent workflow](AGENT_WORKFLOW.md): optional project automation.

`main` is the OSS branch. Future monetization work belongs on `payment`; the [branch guide](../CONTRIBUTING.md#branches-and-pull-requests) links the archived prototype.

## Release and deploy

- [Releasing](RELEASING.md): package builds, checks and publication.
- [Release checklist](RELEASE_CHECKLIST.md) and [published release record](evidence/RELEASE_0_4_0b1.md).
- [Launch handoff](LAUNCH_HANDOFF.md): remaining feedback and setup commands.
- [Hosted deployment record](evidence/HOSTED_PREVIEW.md): live restrictions, verified checks and rollback version.
- [Hosted rollout gates](SHIP_PLAN.md): what must pass before admission opens.
- [Firebase setup](FIREBASE_SETUP.md) and [hosted operations](HOSTED_OPERATIONS.md): account configuration, deployment and recovery.

## Design and verification records

The [production plan](PRODUCTION_PLAN.md) contains the implementation history and quota policy. Earlier SQLite experiments and later Firebase work have different storage limits; measurements in one do not establish capacity in the other.

[Free-beta checks](evidence/FREE_BETA.md), [Firebase checks](evidence/FIREBASE.md), [product audit](evidence/PRODUCT_AUDIT.md), [refinements](evidence/PRODUCT_REFINEMENTS.md) and [visual polish](evidence/PRODUCT_POLISH.md) record what was tested and what remained open at each stage.
