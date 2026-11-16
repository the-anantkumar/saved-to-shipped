# Payment development

`payment` is the integration branch for the monetized product. It starts from the current OSS app so it keeps the latest reader, notes, retrieval and security fixes. Checkout, paid allowances and subscriptions are not enabled in this branch yet.

## Previous prototype

The earlier Razorpay implementation is preserved at [`checkpoint/paid-subscriptions-2026-11-15`](https://github.com/the-anantkumar/saved-to-shipped/tree/refs/tags/checkpoint/paid-subscriptions-2026-11-15), commit `da7652b`:

- [Billing setup and recovery](https://github.com/the-anantkumar/saved-to-shipped/blob/da7652bc0919b4d7cc1a04a2c627cb01bc6b926e/docs/BILLING_SETUP.md)
- [Original product and allowance plan](https://github.com/the-anantkumar/saved-to-shipped/blob/da7652bc0919b4d7cc1a04a2c627cb01bc6b926e/docs/MONETIZATION_PLAN.md)
- [Billing modules](https://github.com/the-anantkumar/saved-to-shipped/tree/da7652bc0919b4d7cc1a04a2c627cb01bc6b926e/hosted/src/billing)

Treat this as reference code, not a deployable version. Reverting the free-beta separation wholesale would conflict with newer UI changes and could lose the note-protection fixes.

## Resume work

1. Branch from `payment` and open the pull request back to `payment`.
2. Restore billing policy, merchant bindings, Razorpay transport and service tests as a focused change. Keep test-mode and live merchant configuration distinct.
3. Integrate the API, Firestore ledger, job allowances and reconciliation before reconnecting checkout UI. Test duplicate callbacks, uncertain submissions, cancellation, account deletion and cross-user access.
4. Add payment-specific build checks without weakening the OSS release checks. Keep the current browser interaction tests and shared assets.

Pricing, included usage and merchant activation still need a product decision. Provider usage remains on user-owned accounts until a separately reviewed model replaces it. Free hosting limits remain in force; a paid product does not authorize cloud overage billing.

## Keep the branches aligned

Shared fixes go to `main` first. Bring reviewed `main` commits into `payment` through a pull request, then resolve payment-specific conflicts here. Do not merge `payment` wholesale into `main`.

Use the same [contribution checks](../CONTRIBUTING.md#verify-a-change), [hosted contracts](../hosted/CONTRACTS.md) and [privacy rules](../SECURITY.md). Do not commit merchant credentials, customer records or real payment callbacks.
