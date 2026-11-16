# Working on save2ship

## Project context

The shipped code is a local, single-user Python application with a plain JavaScript UI. Its runtime has no third-party dependencies. Hosted Apify retrieval is an external provider integration, not evidence that the application itself supports multiple users.

Read [ARCHITECTURE.md](ARCHITECTURE.md) for current behaviour. For hosted work, read the assigned phase in [docs/PRODUCTION_PLAN.md](docs/PRODUCTION_PLAN.md); it distinguishes targets from implemented and measured behaviour. [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md) describes the project agents and skills.

## Product constraints

- Hosting must use hard free limits with no overage billing. Do not enable a paid plan or substitute a billing alert for a spending cap.
- The hosted target is 500 members, 1,000 saves per member, 5,000,000 logical bytes and an 8,000,000-byte physical workspace budget. These are planning limits until the runtime and capacity gates pass. The production plan owns the detailed policy.
- Keep the local, account-free workflow usable. Put hosted dependencies and deployment assets outside the installable Python package.
- Keep Projects, Learning and Experiences distinct. Preserve dark mode, keyboard navigation, independent reading progress, and notes separate from source text.
- Retrieval and optional classification use user-owned provider accounts. Importing or saving credentials must not initiate a paid request. Never turn a hosting budget into a shared provider subsidy.

## Implementation invariants

- Scope every hosted read, write, job, group, export and credential to verified identity. A client-supplied owner or save ID is not authorization.
- Preserve annotations, source provenance and classification edits during repeated imports and enrichment. Version-1 local backups must remain loadable unless a tested migration explicitly changes that contract.
- An uncertain provider submission may already have incurred a charge. Retain the existing reconciliation behaviour; do not retry submission blindly.
- Make seat allocation, quota enforcement and job completion safe under concurrent requests and retries. Count indexed storage and background work, not just JSON payloads or UI requests.
- Do not expose the local server through a public proxy as the hosted implementation. It has one workspace and no user authentication.
- Use synthetic fixtures for automated checks. Do not put personal archives, workspace content, credentials, authenticated browser state or provider responses into source control, logs or public evidence.

## Working in phases

Use a task branch and inspect the current base before switching. Preserve unrelated user work. If the release foundation is not on main, make the dependency explicit rather than silently dropping it or merging it as part of another task.

Implement the requested phase and its acceptance criteria. Delegate independent tasks when useful, with explicit file ownership; the coordinating agent owns shared contracts, integration and commits. Reviewers report findings without editing the implementation they review. Avoid concurrent edits to the same file.

Commit completed phases separately with descriptive messages and no em dashes. Record relevant validation and remaining evidence. Do not mark a phase complete merely because its files exist. Do not deploy, publish a package, change repository visibility or start paid provider work based solely on a plan or skill; use the user's existing authorization and task scope. Do not ask again for actions already authorized.

## Verification

Use an interpreter that satisfies `pyproject.toml` (Python 3.10+); the system `python3` may be older. Match checks to the change:

- Python behaviour: `python -m unittest discover -s tests -v` in the selected environment.
- Browser behaviour: `node --test tests/*_behavior.mjs` and syntax checks for changed JavaScript modules.
- Packaging: the build and clean-install procedure in [docs/RELEASING.md](docs/RELEASING.md).
- Hosted behaviour: inspect the actual scripts and fixtures added by the relevant phase. Do not report planned commands as runnable checks.
- Documentation and agent configuration: validate links, skill metadata, TOML and whitespace. Application tests need not run for wording-only changes.

Use `$save2ship-verify` when selecting a verification scope, `$save2ship-hosted` for a hosted implementation phase, and `$save2ship-release` for release preparation or an authorized rollout. These workflows are scoped to this project and do not require all three skills for ordinary changes.
