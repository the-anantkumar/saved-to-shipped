---
name: save2ship-release
description: Prepare or execute an authorized save2ship package release or hosted-beta rollout, including artifact evidence, hard-free checks and rollback readiness. Use for release work, not routine feature edits.
---

# Save2ship release and rollout

Read the applicable [repository instructions](../../../AGENTS.md), [release guide](../../../docs/RELEASING.md) and relevant release phase of the [production plan](../../../docs/PRODUCTION_PLAN.md). Treat the local package and hosted service as distinct release targets.

## Prepare a reviewable candidate

- Inspect repository state and existing authorization. Preserve the organizing checkpoint and use the current intended base; do not silently merge unfinished work into main.
- Verify publication and deployment status rather than assuming the package exists on PyPI or the service is live. Record the candidate commit, version and intended destination.
- Build fresh package artifacts using the release guide. Check contents, metadata, clean installation and restart persistence; keep private settings, archives and development-only agent configuration out of published runtime artifacts.
- Complete the evidence relevant to the promised features. Mocked provider tests do not establish retrieval fidelity, actual charges or live reliability. Use [LIVE_CHECK.md](../../../docs/LIVE_CHECK.md) only when live provider validation is in scope.
- Review tracked content and history before public visibility changes. A filename-only scan is not a complete secret review. Verify the private vulnerability-reporting route and publish only synthetic examples.
- Prepare release notes, reproducible launch instructions, artifact identifiers and rollback steps. Use existing authorization for commits and publication; avoid em dashes in commit messages.

## Prepare a hard-free hosted rollout

- Verify the deployment account remains on the intended free plans. Do not enable billing, paid add-ons or shared project-funded provider usage to bypass a failed check.
- Keep the plan's target capacity separate from the currently admitted cohort. Require actual runtime storage, request, write and duration evidence before increasing admission.
- Confirm identity and ownership checks, transactional membership, logical and physical quotas, credential isolation, and bounded job processing.
- Exercise export, deletion, quota exhaustion and recovery. Verify migration compatibility and a usable restore path before a schema change; rolling back code alone does not undo data migrations.
- Use short-lived CI publishing/deployment credentials where supported, with reviewed targets and scoped permissions. Keep secrets out of logs and artifacts.
- Recheck the plan's deployment prerequisites and record unresolved items honestly. Free quota exhaustion may reduce availability; communicate that behaviour accurately in the beta UI.

## Match execution to the request

Finish all authorized preparation before an external action. A request to prepare a release does not itself publish packages, change repository visibility or deploy a service. A request that already authorizes those actions does not need another confirmation from this skill. If authorization or an account credential is genuinely missing, identify the concrete remaining action and continue independent preparation.

Report what was built, validated, published or deployed, including exact versions and URLs only when verified. Keep planned rollouts and unrun checks clearly separate from completed work.
