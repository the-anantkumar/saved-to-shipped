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

Cancellation/downgrade preserves all retained data, notes and progress. Existing over-limit data stays readable, editable and exportable; only additional saves/sections/automated work are blocked. A plan change never automatically deletes content. The local MIT application remains account-free and has no subscription requirement.

## Payment boundary

Use Razorpay hosted subscription checkout with test mode as the initial integration. A merchant account, test keys, a monthly INR plan, explicit billing-cycle count and webhook secret are required for a real sandbox round trip. Production checkout stays disabled until price/account/configuration and release evidence are reviewed. No real charge is authorized by this document.

The API creates checkout only for verified admitted identities. Plan, price, limits and subscription ownership come from server configuration and retained state. A checkout return, customer-supplied flag or unsigned webhook never grants Pro. Verified payment evidence must match the server-owned subscription, configured monthly plan, currency and paid invoice period. Duplicate and reordered events cannot refill credits or revive a deleted generation.

Persist checkout intent before external creation. A timeout may have created a subscription, so retain uncertainty and reconcile rather than blindly creating another. Reuse a known checkout. Account deletion must stop future subscription charging before discarding its binding. Store only the minimal billing identifiers and period/allowance state; card details stay with the payment provider.

Infrastructure remains on hard-free plans without overage billing. Paid membership does not override admission, storage limits, processing circuit breakers or remaining recovery headroom.

## Delivery phases

1. Fix the confirmed reader hydration defect and retain separate spaces, empty sections and a persisted time preference.
2. Implement identity-scoped plan limits and bounded transactional point accounting, with downgrade/replay/concurrency tests.
3. Add hosted checkout, signed webhook verification, server-confirmed paid-period activation and cancellation/deletion behavior using synthetic provider fixtures.
4. Surface Free/Pro usage, points and the explicit BYOK cost boundary. Add a coherent next useful action and deliberate retrieval selection rather than encouraging whole-archive processing.
5. Independently review quota/payment bypass, duplicate charges, ordering, deletion and UI regressions. Commit each completed phase with its actual validation. Merchant activation and real provider tests remain distinct from mocked passes.

The detailed [product audit](evidence/PRODUCT_AUDIT.md), [Firebase setup](FIREBASE_SETUP.md), and [shipping gates](SHIP_PLAN.md) remain applicable.
