---
name: save2ship-hosted
description: Implement a scoped save2ship hosted-beta phase involving user storage, Google sessions, admission, quotas, imports, or provider jobs. Use for hosted implementation, not ordinary local UI edits.
---

# Save2ship hosted implementation

Read the applicable [repository instructions](../../../AGENTS.md) and the requested phase in the [production plan](../../../docs/PRODUCTION_PLAN.md). The plan owns the capacity numbers and dependency order. Inspect the code before describing a planned capability as implemented.

## Establish the change

- Map the request to a phase and its acceptance checks. Complete the requested scope; do not implement every later phase merely because this skill lists them.
- Keep the dependency-free Python local application working. The hosted adapter has a separate dependency and deployment boundary.
- Confirm the parent agent's file ownership before parallel edits. Shared contracts and integration changes need one owner.
- Discover the existing hosted runtime and scripts. If they do not exist, create only what the current phase requires and label runtime measurements still outstanding.

## Preserve hosted invariants

- Keep the agreed infrastructure on hard-free plans. A free allowance on a billing-enabled plan does not satisfy that constraint; a quota failure is not permission to upgrade.
- Authenticate before allocating a workspace. Derive its owner from verified identity, never request parameters. Verify token issuer, audience, signature and expiry; use maintained identity libraries.
- Reserve membership transactionally and make provisioning idempotent. Existing members must still enter a full beta. Failed provisioning must reconcile its reservation; deletion releases a seat only after workspace and credential cleanup.
- Use per-user workspace storage and a small membership registry. Validate referenced groups, items, jobs and exports within the same owner boundary.
- Enforce logical bytes and actual SQLite size, including indexes and operational records. Exercise rollback after a quota failure. Test accounting and headroom on the real runtime before advertising the full capacity target.
- Preserve notes, source text, assignments and progress when imports or job completion repeat. Keep reading progress separate from project stages.
- Persist provider job identity before completion work. An uncertain submission must not cause a blind paid retry. Completion handlers must tolerate duplicate delivery and merge into current edits.
- Keep user credentials encrypted and server-only, outside exports and logs. User-supplied provider keys do not make provider usage free.
- Use short requests and bounded processing so workspace objects can sleep. Count index writes, alarms, reads, requests and active duration when setting shared budgets.

## Finish the phase

Run checks appropriate to the changed behaviour using [CONTRIBUTING.md](../../../CONTRIBUTING.md) and the phase acceptance criteria. Hosted tests should demonstrate ownership, boundary and retry behaviour with synthetic data and mocked paid providers.

Record the commit, checks actually run, relevant measurements and unresolved prerequisites in the phase evidence. Keep proposed checks distinguishable from passed checks. Use reviewable commits without em dashes, following the parent agent's commit ownership.

Configuration and implementation do not imply that a service is deployed. Carry out deployment only when it is within the user's current or existing authorization; reuse that authorization instead of asking again for routine work.
