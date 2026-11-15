# Hosted subscriptions and focused use

Decision date: 2026-11-15. This phase builds on `ba299a4` on `feat/firebase-backend`, including the unmerged hosted/Firebase foundation in MR 9. The user requested checkout in this phase, an India-based merchant setup, and continued user-owned Apify/OpenAI accounts during beta. The price remains undecided. These are execution decisions, not evidence of an activated payment service.

## Product contract

| Allowance | Free starting policy | Pro starting policy |
| --- | ---: | ---: |
| Retained saves | 100 | 1,000 |
| Sections across Projects, Learning and Experiences | 3 | 25 |
| Organization points per allowance period | 20 per UTC calendar month | 200 per verified paid monthly period |

These starting values are configurable product policy, not measured infrastructure capacity. Existing hard item/byte/platform limits still apply. Notes, manual organization, reading progress, search, export and deletion consume no points. One successfully AI-organized save consumes one point. Retrieval and AI provider charges remain on the user's own accounts and must be stated separately before checkout and processing.

No point rollover or cash conversion is offered. A job reserves points before provider work; successfully applied results consume points, skipped results release them, and uncertain submissions keep the reservation until reconciliation. Replaying a request or result never charges twice. A prior-period job does not debit or refill the current allowance. Future increases can change the next allowance policy without changing completed accounting.

Cancellation/downgrade preserves all retained data, notes and progress. Existing over-limit data stays readable, editable and exportable. New saves and sections are blocked by their respective growth caps; AI organization of existing saves can continue within the available points and normal storage/growth limits. A plan change never automatically deletes content. The local MIT application remains account-free and has no subscription requirement.

## Payment boundary

Use Razorpay hosted subscription checkout with test mode as the initial integration. A merchant account, test keys, a monthly INR plan, explicit billing-cycle count and webhook secret are required for a real sandbox round trip. Production checkout stays disabled until price/account/configuration and release evidence are reviewed. No real charge is authorized by this document.

The API creates checkout only for verified admitted identities. Plan, price, limits and subscription ownership come from server configuration and retained state. A checkout return, customer-supplied flag or unsigned webhook never grants Pro. Verified payment evidence must match the server-owned subscription, configured monthly plan, currency and paid invoice period. Duplicate and reordered events cannot refill credits or revive a deleted generation.

Persist checkout intent before external creation. A timeout may have created a subscription, so retain uncertainty and reconcile rather than blindly creating another. Reuse a known checkout. Account deletion must stop future subscription charging before purging its private workspace billing ledger. Store only the minimal billing identifiers and period/allowance state; card details stay with the payment provider.

After workspace deletion, retain a minimal closed mapping of verified UID/generation, subscription/plan IDs and original amount/currency outside that workspace to reject late events and prevent cross-generation reuse. Private billing records and public payment projections are absent from backups. The retention policy and cumulative mapping storage cost remain release/capacity gates.

Infrastructure remains on hard-free plans without overage billing. Paid membership does not override admission, storage limits, processing circuit breakers or remaining recovery headroom.

## Implementation status

The following is implemented on `feat/firebase-backend`: reader checkpoint `32604ec`, backend checkpoint `4d5cbec` and interface checkpoint `fc7ce5d`, following plan `9de4bdd`. It is exercised with synthetic identities/provider responses and has passed scoped independent integration review. It is not an activated merchant service, a certified clean final candidate or a public release.

| Area | Current result |
| --- | --- |
| Reader trust | Queuing an unopened read retains rendered source text and notes; stale account/revision responses are ignored. |
| Organization and return visits | Empty typed sections remain visible, Weekly suggestions persist the time budget, Today offers a read/build continuation, and Find searches across spaces. |
| Deliberate processing | Retrieval previews latest saved dates and original URLs, lets the user choose exact IDs, and limits hosted requests to 25 with an explicit provider charge cap. |
| Plans and points | Transactional Free/Pro growth checks and period-bound point reservations/settlement preserve data through downgrade and prevent duplicate debits/refills. |
| Checkout and payment proof | Server-owned Razorpay sale terms, retained checkout intent, allowlisted hosted URLs, signed webhook validation and authoritative paid-invoice checks are present. No frontend return grants Pro. |
| Recovery | Explicit status sync, identity-only cancellation during suspension/maintenance, deletion frozen until cancellation, and narrow operator reconciliation of a retained unknown checkout are implemented. |
| Interface | Plan/usage/held-point/reset display, separate BYOK fees, test-mode labeling, pending/retry handling and Google/password/TOTP cancellation are implemented. |

[Product refinement evidence](evidence/PRODUCT_REFINEMENTS.md) records completed checks, independent review, Firestore emulator persistence/deletion and provisional distribution/artifact verification. The final artifact check must be repeated on the clean documentation checkpoint. Merchant-account creation, an agreed price, test keys/plan, a real test-mode payment/renewal/cancellation run, deployed public webhook delivery and live activation remain outstanding. Refund/dispute handling, taxes/invoicing and customer support/cancellation terms must be decided and verified before live payments. The code does not implement refund or dispute entitlement handling.

[Billing setup](BILLING_SETUP.md) documents the ignored local test configuration and `firebase:local --billing-test` launcher. Loopback uses explicit status sync; production renewals require a deployed public webhook. Neither this plan nor the launcher authorizes public deployment or a real charge.

## Delivery phases

1. Fix the confirmed reader hydration defect and retain separate spaces, empty sections and a persisted time preference.
2. Implement identity-scoped plan limits and bounded transactional point accounting, with downgrade/replay/concurrency tests.
3. Add hosted checkout, signed webhook verification, server-confirmed paid-period activation and cancellation/deletion behavior using synthetic provider fixtures.
4. Surface Free/Pro usage, points and the explicit BYOK cost boundary. Add a coherent next useful action and deliberate retrieval selection rather than encouraging whole-archive processing.
5. Independently review quota/payment bypass, duplicate charges, ordering, deletion and UI regressions. Commit each completed phase with its actual validation. Merchant activation and real provider tests remain distinct from mocked passes.

The original [product audit](evidence/PRODUCT_AUDIT.md), [Firebase setup](FIREBASE_SETUP.md), and [shipping gates](SHIP_PLAN.md) remain applicable. The delivery order above describes the implementation phases; final review, phase commits, owner UAT and external payment evidence are distinct completion criteria.
