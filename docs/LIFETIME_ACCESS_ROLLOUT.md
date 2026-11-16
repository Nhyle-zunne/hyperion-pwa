# Lifetime Access rollout — staged, checkout disabled by default

## Product policy

- One-time, non-renewing **per-track** ownership for the supported lifetime of Hyperion, including future question-bank updates. No All Access SKU.
- Ownership follows the linked Hyperion account between the PWA and Android; signed offline grants use the existing owner-bound verification mechanism.
- Subscription prices/durations remain unchanged. A lifetime purchase does not automatically cancel an auto-renewing Google Play subscription. Warn customers to cancel their old subscription separately before buying Lifetime Access.
- A successfully refunded/charged-back receipt must not provide premium access. Old study progress and question references remain recoverable after revocation.
- Disconnected clients cannot receive instantaneous remote revocation; signed offline ownership updates on a successful online license sync or sign-in.

## PayMongo one-time catalogue (PHP)

| Track | One-time PHP | Planned Play INAPP product ID |
|---|---:|---|
| GMDSS GOC | 1,999 | hyperion_gmdss_lifetime |
| OIC-NW | 2,499 | hyperion_oic_nw_lifetime |
| OIC-EW | 2,499 | hyperion_engine_oic_ew_lifetime |
| Deck Management | 4,999 | hyperion_deck_mgt_lifetime |
| Engine Management | 4,999 | hyperion_engine_mgt_lifetime |

PayMongo code is prepared using the proposed amounts above. They are **not published or charged** while the Lifetime feature flag is disabled. Android Play Console products/prices are a separate launch step.

## Backend and storefront implemented in the draft PR

- Isolated lifetime receipt and PayMongo order tables, RLS owner reads, service-role-only writes, canonical price/track check constraints, and uniqueness of provider payment receipts.
- One-time checkout server action: authenticate the customer, reject existing active lifetime ownership, verify displayed price, create one QR Ph PayMongo session and resume a pending order using the same idempotency key. A failed provider response never results in an untracked payable URL.
- Dedicated payment verification: only a server-to-PayMongo GET or correctly signed webhook can confirm a payment. Check session reference, metadata owner/product, live/test mode, amount and currency against server-owned values.
- Atomic fulfillment/revocation: replayed payments are idempotent; overlapping paid sessions are flagged for manual reconciliation rather than granted twice; refunds of a duplicate charge do not revoke a separate valid purchase; a delayed paid callback cannot resurrect a refunded receipt.
- My Licenses displays Lifetime without a fabricated expiration date. Orders & Payment History includes one-time transactions and a Refresh status recovery path. Pending Lifetime checkouts can be resumed or safely cancelled.
- The normal PayMongo and manual subscription checkouts reject a user who already owns permanent access to the selected track. Existing subscription entitlements are never overwritten.
- Account retention excludes active Lifetime owners. Progress ownership preserves even historical refunded lifetime receipts for saved-data recovery.

## PayMongo configuration (not changed in production)

1. Apply **both** lifetime migrations in timestamp order. The new checkout and retention functions must **not** run against a database without them.
2. Deploy create-lifetime-checkout, verify-lifetime-checkout, paymongo-webhook, create-checkout, submit-manual-payment, expire-inactive-accounts together, followed by the PWA.
3. Keep all existing PAYMONGO_* secrets and the configured API key mode. Register/extend the corresponding existing PayMongo **webhook** subscription to include checkout_session.payment.paid, payment.refund.updated, and payment.refunded.
4. In **test mode**, only after all migrations and functions pass validation, set LIFETIME_PAYMONGO_ENABLED=true. Also requires the existing PAYMONGO_CHECKOUT_ENABLED=true, a matching PAYMONGO_SECRET_KEY (sk_test_... for test), and PAYMONGO_EXPECT_LIVEMODE=false.
5. Verify five exact-price test checkouts; successful redirect without payment must **not** grant; validate missed webhook recovery, duplicate delivery, concurrent tab purchases, cancellation/resume, refund and account isolation.
6. Check the shape of real signed payment.refund.updated payloads and confirm a completed refund revokes the correct lifetime receipt. Partial refunds currently revoke the lifetime receipt too. Disputes/chargebacks require an additional provider reconciliation process before general live launch.
7. Promote to **live mode only after** test and rollback verification. Explicitly authorize migration/deploy and enable the Lifetime flag only after the live PayMongo webhook has been registered with the correct signing secret.

LIFETIME_PAYMONGO_ENABLED defaults to **disabled**. Existing subscription checkout is unaffected by this flag. Never enable live Lifetime checkout merely by merging the schema PR; a main-branch PWA merge can trigger deployment.

## Outstanding Android and release tasks

- Android INAPP query/launch, server-side Google Play productsV2 verification, acknowledgment/restore, real-time developer notifications and refund handling are **not** implemented by these PayMongo-only changes. Android PR #43 only stages product IDs; it must not be presented as a ready-to-use payment feature.
- Confirm Google Play one-time-product PHP prices, inventory and account binding. Never activate the discontinued All Access purchase.
- Cross-platform access from a website Lifetime purchase works via the existing signed Hyperion-account license sync, subject to device testing.
- Do not modify Android versionCode/versionName, generate a release APK/AAB, sign artifacts, publish to Play or run release workflows here.
