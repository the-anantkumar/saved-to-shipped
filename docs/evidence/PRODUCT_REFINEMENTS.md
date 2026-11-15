# Product refinement evidence

The implementation follows the [product audit](PRODUCT_AUDIT.md) and [subscription plan](../MONETIZATION_PLAN.md). Hosted and subscription work depends on the unmerged Firebase foundation in MR 9. Only completed checks are recorded below.

## R1: Queue-before-open reader hydration

Date: 2026-11-15. Based on `ba299a4` and the monetization-plan checkpoint `9de4bdd`.

The reading mutation returns a complete item and hydrates the transport cache. The browser now synchronizes that full item into its visible state before a later reader render. Older revisions, superseded responses and responses from another account remain excluded.

Validation: five synthetic browser regression checks passed, verifying all eight source paragraphs and the existing personal note after queuing an unopened save, plus stale-revision and account-switch guards. The same paragraph assertion fails against the baseline generated reading asset and passes with the fix. All 32 existing JavaScript behavior checks, syntax/build checks and whitespace validation passed. An independent reviewer reran the five browser checks and 32 behaviors and found no issues.

No real archives, provider calls or cloud changes were part of this phase. The weekly time-budget and empty-topic findings remain open at this checkpoint; subscription and return-flow work is separate.
