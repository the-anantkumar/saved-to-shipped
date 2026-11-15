# Hosted billing setup

Status on 2026-11-15: the hosted subscription implementation has synthetic API and browser coverage. No Razorpay merchant account has been connected, no real Razorpay test-mode round trip has been completed, and no live payment has been taken. The monthly price is undecided. Checkout remains disabled in the committed deployment template. The local MIT application remains account-free and requires no subscription.

## Plans and separate provider fees

| Allowance | Free | Pro |
| --- | ---: | ---: |
| Retained saves | 100 | 1,000 |
| Sections across all three spaces | 3 | 25 |
| Organization points | 20 per UTC calendar month | 200 per verified paid monthly period |

One successfully AI-organized save uses one point. A job reserves points before submission, consumes them as results are applied, and releases unused reservations for skipped results. Uncertain submissions retain their reservation until reconciled. Retries and duplicate payment events do not charge points twice or refill a period. Unused points do not roll over. Notes, manual organization, reading progress, search, export and deletion cost zero points.

Apify retrieval and OpenAI usage stay on each member's own provider accounts. A save2ship payment does not cover their fees. Saving keys, importing an archive or opening the plan dialog does not submit provider work. Infrastructure admission, daily budgets and storage limits still apply to Pro; a paid subscription does not bypass hard-free hosting limits.

Cancelling renewal keeps the verified paid period and all saved work. After downgrade, existing over-limit saves and sections remain readable, editable and exportable. Their growth limits prevent additions; AI organization of existing saves can still use the current point allowance, subject to normal storage limits. No plan change deletes data.

## Prepare a Razorpay test account

Complete the [Firebase local setup](FIREBASE_SETUP.md) first. The launcher uses the production Worker entrypoint on loopback with real Firebase identity/storage, an explicit list of at most two test-member UIDs, and separate ignored secrets. Use synthetic saves for payment acceptance checks.

1. Create the India merchant account and keep the Razorpay dashboard in **Test mode**. Generate its test API key pair under Account & Settings → API Keys. Test and live keys are separate; keep the secret in your local configuration rather than chat or Git. [Razorpay API keys](https://razorpay.com/docs/payments/dashboard/account-settings/api-keys)
2. Create a test subscription plan under Subscriptions → Plans. Choose **INR**, monthly frequency with interval **1**, and a deliberate test amount. This amount is test configuration, not an agreed product price. The server checks the fetched plan against the retained amount and currency. Razorpay plans cannot be edited after creation, so a later price decision needs the appropriate plan/configuration. [Razorpay plans](https://razorpay.com/docs/payments/subscriptions/create-plans)
3. Choose a finite number of monthly payments (`totalCount`, 1–1,200). The checkout displays this count and the configured monthly amount. Do not treat a fixture's amount or cycle count as the commercial offer.
4. Generate a separate random webhook secret of at least 32 printable characters. The same value will later be configured on the deployed webhook and in Razorpay. API key secrets and webhook secrets serve different purposes.

Create `hosted/.local/firebase-project/billing-test.json` with these fields. The shape below is deliberately not runnable until the placeholders are replaced; `amountPaise` and `totalCount` must become JSON integers.

```json
{
  "keyId": "rzp_test_REPLACE_WITH_TEST_KEY_ID",
  "keySecret": "REPLACE_WITH_TEST_KEY_SECRET",
  "webhookSecret": "REPLACE_WITH_RANDOM_WEBHOOK_SECRET",
  "planId": "plan_REPLACE_WITH_TEST_PLAN_ID",
  "amountPaise": "REPLACE_WITH_INTEGER_PAISE",
  "totalCount": "REPLACE_WITH_INTEGER_CYCLE_COUNT"
}
```

`amountPaise` is the exact configured monthly amount in paise, not rupees. Keep this file owner-readable only. The repository ignores `.local/`; the launcher generates its protected `.dev.vars` and local Wrangler configuration there. It accepts only a `rzp_test_` key and always sets test mode for this path.

From `hosted/`, run:

```sh
chmod 600 .local/firebase-project/billing-test.json
npm run firebase:local -- --billing-test
```

Open `http://localhost:8012/`, sign in as an allowlisted test member, and choose **Plan and points** or the plan button in the sidebar. **Open Pro checkout** creates or resumes the member's retained checkout and opens the validated Razorpay hosted URL. There are no card fields in save2ship.

`--prepare-only` writes local configuration without starting the server. `--port` changes the loopback port. `--processing` separately enables ingestion and explicitly requested Apify/OpenAI work; it is unnecessary for checkout and can incur charges on user-owned provider accounts if those actions are started. Neither the billing flag nor saving merchant configuration automatically submits a subscription or provider job.

## Verify a test payment on loopback

Use Razorpay's current subscription test instructions and test payment details on the hosted payment page. Its dashboard can simulate a subsequent test charge using **Charge this now**; an authentication transaction alone is not proof of the paid allowance period expected by this application. [Razorpay subscription testing](https://razorpay.com/docs/payments/subscriptions/test)

Return to save2ship and select **Check payment status**. This explicitly calls `POST /api/billing/sync` with an empty body. The server fetches the subscription, plan and invoices using its merchant credentials. Pro is granted only for a matching paid invoice with the expected subscription, monthly plan, INR amount, zero amount due, payment ID and valid paid period. A redirect, query parameter, frontend success message or submitted provider ID cannot grant Pro.

For a test acceptance record, confirm Free remains before payment; a verified paid period supplies Pro and its points; repeated status checks do not refill points; a second identity sees only its own plan; cancellation keeps the paid period; and account deletion stops future subscription charging before purging billing state. Record the commit, mode and outcomes without tokens, raw provider responses or card data. These real test-mode checks remain outstanding.

Loopback cannot receive provider webhooks. Manual status sync supports this local test; it does not establish production renewal delivery. Do not expose the personal Python server or its workspace through a public proxy.

## Public webhook and deployed configuration

An authorized hosted rollout needs a deployed HTTPS Worker and `APP_ORIGIN` matching that origin. Configure the Razorpay webhook URL as `https://<hosted-origin>/api/billing/webhook`, with the matching secret and the `invoice.paid` and `subscription.charged` events. The endpoint validates `X-Razorpay-Signature` against the raw request bytes before parsing; it then fetches authoritative invoice/subscription/plan records rather than trusting event fields. Duplicate and reordered events cannot refill an already recorded paid period. [Razorpay webhook verification](https://razorpay.com/docs/webhooks/validate-test)

| Server configuration | Purpose |
| --- | --- |
| `ENTITLEMENTS_ENABLED` | Enables Free/Pro limits and point accounting; committed default is `true` |
| `BILLING_ENABLED` | Allows new checkouts only when the sale is fully configured; committed default is `false` |
| `RAZORPAY_MODE` | `test` by default; live mode is a separate release decision |
| `RAZORPAY_PLAN_ID`, `RAZORPAY_AMOUNT_PAISE`, `RAZORPAY_TOTAL_COUNT` | Trusted monthly INR sale terms and finite cycle count |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Server-only merchant credentials and webhook verification secret |

Put merchant secrets in the hosted platform's secret store, never in public Firebase config or browser assets. Do not rotate away the credentials needed to reconcile or cancel existing subscriptions without an operational recovery plan. Production renewals require verified public webhook delivery and replay/recovery evidence; manual browser visits are not a renewal mechanism. Follow the [shipping gates](SHIP_PLAN.md) and [hosted operations runbook](HOSTED_OPERATIONS.md) before any deployment or activation.

## Uncertain checkout and operator recovery

The server persists a checkout intent before contacting Razorpay. A timeout may have created a subscription. The UI keeps the same intent for explicit retries, and the server retains its uncertainty barrier across reloads and restarts. Do not clear the retained intent or blindly create another subscription. A known checkout can be resumed; an unknown subscription ID requires operator reconciliation.

An allowlisted operator can call `POST /api/admin/billing/reconcile` with only:

```json
{"target":"<member Firebase UID>","subscription_id":"sub_<merchant reference>"}
```

This is an authenticated operator API, not a public customer control. It requires a valid Firebase identity, current account-status check, `OPERATOR_UIDS` membership and authentication within five minutes. The server obtains the member's current generation from the Registry and spends a bounded cleanup reservation. It remains usable for recovery during hosted maintenance with checkout/entitlement flags off, provided the required Firebase and merchant configuration remains available; ordinary private workspace routes stay closed.

Production operator access requires an explicit `OPERATOR_UIDS` allowlist. The local launcher defaults to no operators. For trusted local support/recovery only, the optional ignored `hosted/.local/firebase-project/operators.json` may contain a JSON array of at most two Firebase UIDs, each already present in `members.json`. Restart the launcher to apply it. Ordinary test checkout and customer cancellation do not require this file or operator access. Do not add someone merely because they need to buy or cancel a subscription.

Use the merchant dashboard to identify the candidate subscription, then submit its reference through an approved operator client. The server accepts it only when the retained intent, opaque merchant reference, creation-time window, original plan/amount/currency, owner and generation agree. It cannot replace an existing subscription ID, invent an intent or choose new sale terms. A recovered terminal subscription may have no checkout URL. A frozen or suspended workspace is reconciled toward cancellation; an active workspace still requires independently verified payment evidence for access. If this proof is unavailable, preserve the record and investigate rather than guessing a binding.

**Cancel subscription renewal** remains available while a member is suspended or the hosted workbench is paused, provided identity and merchant recovery configuration remain available. Cancellation requires fresh Google or password/TOTP confirmation, uses no workspace capability, and returns a small cancellation receipt without exposing private workspace data. Failure to confirm cancellation freezes account deletion with `BILLING_DELETION_PENDING`; retry retains the billing binding until future charging is confirmed stopped.

Deletion removes the private workspace billing ledger along with workspace content and encrypted provider credentials. A minimal closed billing mapping remains outside the deleted workspace: verified UID/generation, subscription and plan IDs, amount/currency, and the closed marker. It prevents late payment events from recreating access or being attached to a different generation. This retained record contains no card data or raw provider payloads; neither private billing records nor public plan/payment projections are included in workspace exports. The retention policy and cumulative storage cost of these mappings must be included in release/capacity decisions rather than counted as zero after deletion.

## Before live payments

Merchant onboarding/activation, the actual price and finite cycle count, a real test-mode checkout/renewal/cancellation run, public webhook delivery, and final release/capacity evidence are still pending. Refund handling, disputes/chargebacks, taxes/invoicing and customer cancellation/support terms need an explicit product and operational policy. The current code does not implement a refund or dispute entitlement workflow. Those decisions and their acceptance checks are live-payment gates, not implied by passing synthetic tests.

Completed synthetic checks are recorded in [product refinement evidence](evidence/PRODUCT_REFINEMENTS.md). Keeping Cloudflare/Firebase on hard-free infrastructure remains a separate requirement from collecting subscription revenue.
