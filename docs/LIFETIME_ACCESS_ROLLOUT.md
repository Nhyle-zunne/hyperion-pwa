# Lifetime Access rollout — staged, not for sale yet

## Approved product policy

- Lifetime Access is a **non-renewing, one-time purchase for one of five tracks**.
- It includes future question-bank updates while the Hyperion service operates.
- A lifetime receipt belongs to exactly one Hyperion user/track and follows that
  account between Android and PWA. The discontinued All Access product is excluded.
- Subscription billing remains unchanged. Buying lifetime access does **not**
  automatically cancel a Google Play auto-renewing subscription; warn owners to
  cancel their recurring subscription before/when upgrading.
- A refunded/charged-back or revoked lifetime receipt must not grant access.
- Offline access uses the current account-bound signed entitlement protocol.
  After a successful online sync, revocations take effect; disconnected clients
  cannot receive an immediate remote revocation signal.

## Provisional prices (NOT approved / NOT active)

| Track | Lifetime PHP | Proposed Play product ID |
|---|---:|---|
| GMDSS GOC | 1,999 | `hyperion_gmdss_lifetime` |
| OIC-NW | 2,499 | `hyperion_oic_nw_lifetime` |
| OIC-EW | 2,499 | `hyperion_engine_oic_ew_lifetime` |
| Deck Management | 4,999 | `hyperion_deck_mgt_lifetime` |
| Engine Management | 4,999 | `hyperion_engine_mgt_lifetime` |

These figures were *suggested*, not explicitly agreed as final, so do not
activate products, expose a live Buy button, or charge these prices yet.

## Completed in this foundation branch

1. An isolated `lifetime_entitlements` table with account-scoped RLS, service-only
   writes and a globally unique hashed receipt ID per provider.
2. A service-only, idempotent receipt recorder that rejects another account
   or product claiming the same purchase and never resurrects revoked receipts.
   This RPC is a **data primitive**, not proof of payment: callers must verify
   PayMongo or Google Play server-side before invoking it.
3. Existing active-license and progress-ownership readers include lifetime
   purchases without changing subscription rows. An active lifetime track is
   represented by an ISO-compatible far-future expiry in the existing signed
   offline grant format to preserve both platform clients.
4. Account retention excludes active lifetime owners; an unavailable lifetime
   lookup fails closed to prevent accidental account deletion.
5. Existing PayMongo subscription checkout denies new charges to a user who
   already owns that track for life.
6. Synthetic isolated PostgreSQL regression tests for receipt replay, account
   isolation, revocation, scoped access and database privileges.

## Required before launch

- Approve final lifetime prices and the customer-facing Lifetime terms.
- Create the five **non-consumable** Play Console one-time products and verify
  actual PHP prices. Never add an All Access product.
- Implement Android `INAPP` product query/purchase/restore flow and **backend**
  `purchases.productsv2.getproductpurchasev2` validation. Acknowledge only
  verified `PURCHASED` orders, never pending or rejected purchases.
- Implement PayMongo lifetime checkout and payment verification separately from
  expiring subscription orders. Keep client-provided prices untrusted; match
  provider order/currency/amount, user, product and reference atomically.
- Handle one-time-product RTDN, voided purchase/refund reconciliation and PayMongo
  refund/revocation without resuscitating refunded receipts.
- Surface the Lifetime option, lifetime purchase history and expiry-free
  ownership state in both PWA and Android stores/account pages.
- Verify payment failures, interruptions, duplicate callbacks, signed offline
  access, saved progress, all five tracks and account isolation using test
  transactions only; then independently authorize production migration/Edge
  deployment and Android Studio release. The feature must remain unpurchasable
  until *all* of these checks pass.

## Release gating

Do **not** merge or deploy this foundation on its own: the existing checkout
guard requires its accompanying migration and would fail closed before that
migration is installed. Launch the schema and compatible Edge Functions in a
controlled, verified sequence. Never modify Android `versionCode` or
`versionName`, generate a release AAB/APK, or publish to Google Play from CI.
