# November 2026 price rollout

Target PHP prices (weekly / monthly / yearly): OIC-NW and OIC-EW **29 / 79 / 499**; GMDSS **25 / 59 / 399**; Deck and Engine Management **59 / 149 / 999**.

1. Confirm Google Play Console final PH buyer prices; Android fallback labels need a separate update. Leave existing Google Play subscribers on legacy rates unless explicitly migrated.
2. Pause **new** PayMongo checkout creation during backend rollout; keep verified webhook/order finalization available for previously paid sessions.
3. Apply `supabase/migrations/20261113115708_accept_updated_paymongo_prices.sql`. Confirm exactly two database price guards now allow legacy and current prices; all payment/session/currency/track checks must remain in place.
4. Deploy `verify-checkout` and `paymongo-webhook` **first** (old and new recorded prices accepted); do not change webhook signature or PayMongo live/test mode.
5. Deploy `create-checkout` and `submit-manual-payment` (new orders use new prices), then deploy the PWA storefront. Confirm server and checkout advertised amounts match before re-enabling payments.
6. With PayMongo **test mode**, verify all three terms, a multi-track basket, manual submissions, prior-price checkouts, successful cross-platform license activation, duplicate/retry behavior, cancellation, and refund paths. New-order APIs require the client's exact expected PHP total to fail closed for outdated cached PWAs; pre-existing PayMongo checkout sessions can still be resumed. Never create real-charge test orders.
7. Monitor PayMongo reconciliation alerts. If reverting, first coordinate creation prices and storefront; retain backward-compatible paid order verification until all recorded orders settle.

Source checks: `bun run test:security` and `bun run build`. These do not replace test-mode end-to-end payment checks.

**Merging the PWA branch alone does not deploy Supabase functions or SQL. Never merge before coordinating backend and Cloudflare deployment.**
