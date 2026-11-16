# Documentation

The free local [v0.4.0b1 beta is published](https://github.com/the-anantkumar/saved-to-shipped/releases/tag/v0.4.0b1). Start with [the project README](../README.md) for the one-command local app. The local MIT workflow and the optional hosted deployment have separate setup and release boundaries.

## Use the app

| Guide | Read it for |
| --- | --- |
| [Usage](USAGE.md) | Import, reading, projects, optional providers, configuration, exports and troubleshooting. |
| [Demo](DEMO.md) | Synthetic sample content without accounts or provider keys. |
| [Free beta](FREE_BETA.md) | What is included, provider costs and current limits. |
| [Acceptance testing](UAT.md) | A five-save first session, restart recovery and a next-day return. |
| [Source fidelity](LIVE_CHECK.md) | What retrieval has been checked against and where coverage remains incomplete. |

## Build and contribute

- [Contributing](../CONTRIBUTING.md): tooling, synthetic fixtures and test commands.
- [Architecture](../ARCHITECTURE.md): local package and hosted boundaries.
- [Product specification](../PRODUCT_SPEC.md) and [roadmap](../ROADMAP.md).
- [Security](../SECURITY.md): private reporting and the local/hosted trust boundary.
- [Agent workflow](AGENT_WORKFLOW.md): project automation roles and scoped skills.

## Prepare a release or hosted deployment

- [Release checklist](RELEASE_CHECKLIST.md): completed publication and remaining follow-ups.
- [Release evidence](evidence/RELEASE_0_4_0b1.md): reviewed source, CI, artifact hashes and public download/install checks.
- [Launch handoff](LAUNCH_HANDOFF.md): only the remaining owner-feedback and hosted setup steps.
- [Releasing](RELEASING.md): build, metadata/content checks and clean installs.
- [Shipping plan](SHIP_PLAN.md): local OSS publication and optional hosted rollout.
- [Firebase setup](FIREBASE_SETUP.md): real Google/email/TOTP identity and Firestore configuration.
- [Hosted operations](HOSTED_OPERATIONS.md) and [account setup](HOSTED_SETUP.md).
- [Hosted implementation guide](../hosted/README.md): Node tooling, mocked UAT and closed deployment assets.

The hosted manifest defaults closed. A prepared configuration or successful local test does not establish a public service or measured user capacity.

## Evidence and historical design

[Free-beta evidence](evidence/FREE_BETA.md) records the separated runtime checks. [Firebase evidence](evidence/FIREBASE.md) records identity/storage work. The [product audit](evidence/PRODUCT_AUDIT.md) and [refinement record](evidence/PRODUCT_REFINEMENTS.md) distinguish original findings from later fixes.

The [production plan](PRODUCTION_PLAN.md) includes earlier SQL-only measurements and later Firebase updates. Capacity figures are planning or measurement results with explicit limits, not admission promises. Paid implementation is deferred; [the monetization pointer](MONETIZATION_PLAN.md) identifies its preserved checkpoint and is not part of free-beta setup.
