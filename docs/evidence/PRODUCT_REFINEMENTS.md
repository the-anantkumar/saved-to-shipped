# Product refinement evidence

The implementation follows the [product audit](PRODUCT_AUDIT.md) and [subscription plan](../MONETIZATION_PLAN.md). Hosted and subscription work depends on the unmerged Firebase foundation in MR 9. Only completed checks are recorded below.

Implementation checkpoints:

| Commit | Scope |
| --- | --- |
| `9de4bdd` | Product/monetization execution plan |
| `32604ec` | Reader hydration trust fix |
| `4d5cbec` | Hosted entitlements, payment verification and recovery |
| `fc7ce5d` | Product navigation, selection and billing interface |

These commits identify the implementation reviewed below. Documentation is being completed after them; a clean final release candidate has not yet been certified by this record.

## R1: Queue-before-open reader hydration

Date: 2026-11-15. Implemented in `32604ec`, based on `ba299a4` and the monetization-plan checkpoint `9de4bdd`.

The reading mutation returns a complete item and hydrates the transport cache. The browser now synchronizes that full item into its visible state before a later reader render. Older revisions, superseded responses and responses from another account remain excluded.

Validation: five synthetic browser regression checks passed, verifying all eight source paragraphs and the existing personal note after queuing an unopened save, plus stale-revision and account-switch guards. The same paragraph assertion fails against the baseline generated reading asset and passes with the fix. All 32 existing JavaScript behavior checks, syntax/build checks and whitespace validation passed. An independent reviewer reran the five browser checks and 32 behaviors and found no issues.

No real archives, provider calls or cloud changes were part of this phase. The weekly time-budget and empty-topic findings remain open at this checkpoint; subscription and return-flow work is separate.

## R2: Organization, deliberate retrieval and return flow

Date: 2026-11-15. Scope: the `4d5cbec` backend and `fc7ce5d` interface checkpoints on `feat/firebase-backend`, including their unmerged hosted/Firebase foundation. This section supersedes the remaining weekly-budget and empty-topic status at the R1 checkpoint; it does not claim a deployed release.

New empty sections retain their Projects/Learning/Experiences kind and remain visible after reload; legacy empty/mixed groups remain usable. Weekly suggestions persist each account's available-time preference from 0.25 to 168 hours. They are labeled suggestions rather than pretending to be committed weekly tasks.

An empty workspace opens import. A populated workspace offers Today with an unfinished/queued read and an active project step, explains the choices, and allows a 5/15/30-minute session without processing the rest of the archive. Global Find searches source/notes across all spaces; topic/project filtering remains available. No recommendation model or new provider request is involved.

Retrieval now previews original saved URLs and normalized saved dates, orders the choices by latest saved date and accepts an explicit selection of at most 25 hosted item IDs. The API checks ownership and eligibility of the selected sources. Saving keys and importing an archive do not submit work; the explicit provider charge cap remains part of confirmation. Classification sizes its request against the remaining organization-point allowance and fails before submission when none remains.

The seven product browser acceptance groups passed with synthetic data. They cover empty-state import without paid work, persisted/private time budgets, typed empty sections and reader content, Today and mobile/dark navigation, cross-space note search, exact retrieval selection/charge cap, and the real Free-entitlement sidebar callback. The browser suite does not measure real source-recovery quality or time-to-usefulness.

## R3: Hosted plans, checkout and recovery

The product layer starts Free at 100 saves, 3 sections and 20 points per UTC month; Pro at 1,000 saves, 25 sections and 200 points per verified paid period. Growth checks preserve existing over-limit data after downgrade. AI jobs reserve points before work and consume them only for successfully applied results; skipped results release reservations and uncertain submissions remain reserved. Manual organization, notes, reading, search and export use no points. Apify/OpenAI charges remain separate on member-owned accounts.

Razorpay checkout retains the intent before the external call and does not retry an uncertain create blindly. Browser navigation is limited to the supported Razorpay hosted URL shapes. The server verifies signed webhook bytes, then fetches merchant subscription/plan/invoice records before granting paid access. Replayed payment evidence cannot refill the period. A checkout return or query flag cannot grant Pro.

Cancellation uses fresh verified identity without requiring a workspace capability, so suspension and hosted maintenance do not trap an existing subscriber. The cancellation-only UI reveals no workspace or billing record. Google/password confirmation supports TOTP and ignores results after account changes, closed/replaced dialogs or cancelled challenges. Account deletion remains frozen while cancellation is unconfirmed; its billing recovery message does not suggest unrelated Apify key repair.

Unknown checkout recovery is limited to an allowlisted, recently authenticated operator and exact retained intent/merchant proof. The endpoint cannot create an intent, substitute sale terms or rebind another member's subscription. Terminal and frozen-account recovery keeps the known binding available for cancellation. See [billing setup](../BILLING_SETUP.md) for the operator contract and external acceptance steps.

A minimal closed subscription mapping survives outside a deleted workspace to reject late events: verified UID/generation, subscription/plan IDs, amount/currency and closed state. It contains no card data or raw provider payloads. No billing/payment projection is exported. The cumulative storage cost and retention policy for these mappings remain release gates.

## Checks recorded for this integration

Node 24 and the repository's pinned dependencies were used. Counts below record completed scoped checks, including coordinator/delegated results, rather than a final release aggregate. All payment/provider behavior in these checks is synthetic.

| Check | Executable scope | Recorded result |
| --- | --- | --- |
| Reader content regression | `hosted/tests/reading-regression.mjs` | 5 acceptance groups passed; rendered source paragraphs and notes asserted |
| Shared UI/theme behavior | `node --test tests/*_behavior.mjs` from the repository root | 32 checks passed |
| Product return/import/selection flow | `hosted/tests/product-flow.mjs` | 7 acceptance groups passed |
| Billing UI | `hosted/tests/billing-ui.mjs` | 12 acceptance groups passed |
| Billing and product API | `hosted/tests/billing-app.test.mjs`, `hosted/tests/product-api.test.mjs` | 6 tests passed: 4 billing and 2 product, reported by the coordinator |
| Auth and MFA browser regressions | `hosted/tests/auth-ui.mjs`, `hosted/tests/mfa-ui.mjs` | 5 auth and 11 MFA acceptance groups passed |
| Transport regression | `hosted/tests/import-client.test.mjs` | 19 tests passed |
| UI build boundary | Typecheck, changed-module syntax and whitespace | Passed for the reviewed UI working tree |

Billing browser checks cover unavailable/test-mode display, held/reset points and BYOK costs; explicit navigation and untrusted return flags; unsafe URLs; stable intent across pending/reopened checkout; fresh-token password/TOTP cancellation; stale token/auth/MFA/account/modal responses; billing-specific deletion recovery; and cancellation without a workspace session or private read while paused/suspended. Desktop/light and mobile/dark views were inspected. Screenshots remain under ignored `hosted/.local/billing-ui/`; no card details, personal content or authentication state are included.

The coordinator also reports 201 discovered hosted tests: 187 passed and 14 emulator-only checks skipped in that run; the separate emulator run passed all 14. Python passed 84 checks, shared browser behavior passed 32, existing browser E2E passed 9 acceptance groups and UAT controls passed 10. The product/reader/billing/auth/MFA browser counts are listed separately above; do not add them to the hosted unit-test count as though they were one runner.

## Independent review and Firestore persistence

The independent read-only integration reviewer returned **PASS**, with no unresolved material findings in the reviewed payment, ownership, retry and cancellation boundaries. The reviewer reran 55 billing tests, the 12 billing browser checks, and a fresh suspended-member cancellation reproduction. This closes the scoped implementation review; it does not close the external launch gates below.

A separate billing scenario against the Firestore emulator passed both the implementation agent's and coordinator's runs. Pro and the remaining 199 points survived replacement with an empty Durable Object cache; the authoritative immutable subscription mapping survived; cancellation followed by account deletion purged the workspace and cache; and the retained closed mapping ignored a late signed paid invoice. The existing 14 Firestore emulator checks also passed separately. The coordinator's final combined API/Firestore run passed all 7 tests, and the emulator stopped cleanly afterward. These are emulator persistence results using synthetic payment evidence, not cloud-capacity or real merchant results.

Strict wheel/source-distribution artifact validation and clean-install/restart smoke checks passed for both distribution formats. The closed deployment dry run and nine-artifact boundary check also passed. That artifact record included dirty documentation and will be repeated after the final documentation commit. It is not evidence of a clean final candidate, public deployment or publication.

These passes do not establish a real merchant connection, public webhook delivery, refund/dispute handling, cloud capacity or owner acceptance.

## Remaining product and live evidence

The original audit's real-archive owner UAT and timed usefulness targets remain unmeasured. Today improves the return path, but a capped/explicitly ordered Read next shortlist, skip/replace behavior, reminders and a completed-session summary have not been implemented. Large-archive processing remains deliberate and bounded; there is no automatic whole-archive processing plan.

No Razorpay merchant account or test keys have been connected, the commercial price is undecided, and no real test-mode or live payment was executed. Public webhook renewal/cancellation, external merchant recovery and customer policy acceptance remain shipping gates. Infrastructure remains subject to hard-free storage/work budgets regardless of subscription revenue.
