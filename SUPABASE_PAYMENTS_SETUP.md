# Hyperion website payments: current flow and historical recovery

As of November 25, 2026, new website purchases use **QR Ph or BPI/VYBE InstaPay bank transfer** and manual administrator verification. There is **no new hosted PayMongo checkout**. The Android app continues to use Google Play Billing independently.

## Current customer checkout

1. Sign in with Google and select the desired tracks and duration in the Bond Store.
2. Open Checkout. Scan/save the official QR Ph image or copy the BPI/VYBE bank details and transfer the exact amount. For bank transfers, **use InstaPay, never PESONet** for faster confirmation.
3. Send the receipt and copyable purchase details through Messenger.
4. An authorized administrator checks the actual incoming payment before approving the request and granting access. Allow **24–48 hours** for activation, then contact the Hyperion Facebook page if a follow-up is needed. Proof alone is not approval.

The official QR asset is `public/qr-ph.png` (served as `/qr-ph.png`); the copyable receiving-account details are in `src/lib/manualQrCheckout.ts`, displayed by `src/screens/AdminQrCheckoutScreen.tsx`. Verify the receiving account before making changes. Supabase's `submit-manual-payment`, `admin-payment-review`, and related manual-review functions continue to provide the authoritative payment/license workflow.

## Historical hosted purchases: preserve all records and entitlements

**Do not delete, rewrite, or revoke any verified historical provider order, entitlement, refund, audit event, account link, or payment reference as part of checkout retirement.** Historical paid website subscriptions and Lifetime Access keep their original product, account ownership, term, grant, and expiry. The retiring `create-checkout` and `create-lifetime-checkout` endpoints must not create new hosted sessions; the latter still supports authenticated cancellation of an already-open Lifetime session.

Historical recovery must remain operational until all pending transactions and reconciliation needs are resolved:

- `verify-checkout`, `verify-lifetime-checkout` — authenticated direct provider verification, including delayed/missed webhooks.
- `cancel-checkout`, `create-lifetime-checkout` (`cancel` action) — safe expiration/cancellation of already-open sessions. Never mark paid/processing payments cancelled.
- `paymongo-webhook`, `_shared/paymongoLifetime.ts`, `finalize_paymongo_checkout` — signed paid/refund events, idempotent entitlement grants, and refund handling.
- `orders`, `checkout_batches`, `lifetime_orders`, `entitlements`, `lifetime_entitlements`, and `paymongo_reconciliation_alerts`, plus their migrations and RLS — historical record and audit integrity.
- `Orders & Payment History` and account screens — read-only history, pending verification, and safe cancellation remain accessible to original owners.

The existing private Supabase provider API secret, matching live/test webhook signing secrets, and `PAYMONGO_EXPECT_LIVEMODE` must remain configured **for historical verification and refunds only**, never in frontend code. Do not remove the webhook endpoint, secrets, tables, columns, or verification functions without a separately approved migration and confirmed settlement/reconciliation of all pending orders. `PAYMONGO_CHECKOUT_ENABLED` must stay disabled. Never reenable new-session creation; the source code has intentionally retired it.

## Historical payment not yet activated

1. **Do not ask the customer to pay twice, and never manually approve a historical hosted order.** Only a valid signed webhook or direct authenticated provider verification can grant that purchase.
2. Ask the original account owner to open Orders & Payment History and select **Refresh status**. Pending Lifetime Access can also be checked/cancelled from Account.
3. In the provider dashboard, inspect the historical transaction and signed webhook delivery to `/functions/v1/paymongo-webhook` in the correct test/live mode. Signature validation must remain enabled.
4. Compare the checkout session, reference, currency, amount, paid state, payment ID, and account/track metadata with the stored order. For a distinct second paid payment ID, investigate `paymongo_reconciliation_alerts` and determine whether a provider refund is required; **never grant an extra license merely because of a duplicate charge.**
5. Preserve the original record and audit trail when escalating a mismatch or refund. Do not treat a browser redirect or screenshot as proof of historical provider payment.

The transaction finalizer serializes provider payment IDs to prevent two orders from claiming the same payment. Repeated verification/webhook delivery must not extend an already-granted license. The historical price/term tables and migration `20261113115708_accept_updated_paymongo_prices.sql` must remain for validating old purchases. Supabase `schema.sql` is an older snapshot; ordered `supabase/migrations/` files remain the database source of truth.

## Administrator and verification safeguards

- Set administrator access only through the approved authenticated role configuration; do not expose `SUPABASE_SERVICE_ROLE_KEY`, provider secrets, or webhook secrets in the PWA, Android app, or `VITE_` environment variables.
- Verify the actual receiving transaction for new manual orders before approving a license. Reviewers cannot infer payment completion solely from Messenger proof.
- Keep signed webhook verification and mode checks for historical payments. Provider responses are checked for exact account/order/session identity, amount, and currency.
- Automated tests include `node scripts/tests/paymongo-verification-test.mjs`, the isolated synthetic PostgreSQL test `scripts/tests/paymongo-reconciliation-pg-test.mjs`, and `npm run test:security`. No real payment should be made as part of ordinary CI checks.
- Android purchases, billing, restore, and refund procedures continue to use Google Play and must remain unchanged by website payment retirement.

Historical setup instructions for creating new PayMongo checkouts were intentionally retired. Earlier revisions remain available in git history for auditing, not for reactivation.
