# Hyperion PWA: PayMongo automatic checkout and manual payment fallback

Hyperion supports two payment routes:

- **Pay instantly via PayMongo** — Hosted Checkout supports one or more selected tracks in a single basket payment. A signed webhook, or Hyperion's authenticated server-side checkout verification after return/status refresh, validates the payment and automatically grants 12-month access for exactly the tracks in that order.
- **Manual QR payment** — Students submit their transaction reference and profile details. An admin verifies the actual payment and approves/rejects it in the private PWA admin dashboard.

A redirect to Hyperion is not proof of payment. Only the signed webhook or authenticated server-to-PayMongo verification can mark a PayMongo checkout paid and activate access. The browser never supplies the authoritative products, amount, or license grant.

## 1. Database

The PayMongo tracking migration adds `paymongo_checkout_session_id` and `paymongo_payment_id` to `public.orders`. The basket migration also creates `public.checkout_batches` and adds `orders.checkout_batch_id`; each chosen track has its own order row while the whole basket has one shared PayMongo session and payment. Both migrations have been applied to the connected Hyperion Supabase project. Fresh installs can use `supabase/schema.sql`, which includes these tables and indexes.

## 2. Configure private Supabase Function secrets

Never place PayMongo API keys, webhook signing secrets, or Supabase service-role keys in the browser, Cloudflare environment variables prefixed with `VITE_`, or committed files.

From the repository root, after installing the Supabase CLI:

```sh
supabase login
supabase link --project-ref evnjoezffghtrzqacwcj

# Use your PayMongo TEST secret key while testing.
supabase secrets set PAYMONGO_SECRET_KEY=sk_test_REPLACE_WITH_YOUR_TEST_KEY
supabase secrets set PAYMONGO_WEBHOOK_SECRET=REPLACE_WITH_THE_TEST_WEBHOOK_SIGNING_SECRET
supabase secrets set PAYMONGO_EXPECT_LIVEMODE=false
# Start safely with checkout disabled. Enable test checkout only after the test webhook is registered.
supabase secrets set PAYMONGO_CHECKOUT_ENABLED=false
supabase secrets set APP_BASE_URL=https://hyperionmaritime.org

# Prices are defined in the client catalogue and validated by the
# create-checkout, verify-checkout, and paymongo-webhook functions.
# Do not configure PRICE_* secrets: the current functions do not read them.

supabase functions deploy create-checkout
supabase functions deploy verify-checkout
supabase functions deploy cancel-checkout
supabase functions deploy paymongo-webhook
supabase functions deploy submit-manual-payment
supabase functions deploy admin-payment-review
```

Replace both key placeholders with your actual values locally. Do not paste the keys into ChatGPT or GitHub.

Current prices are hard-coded in `src/lib/supabase.ts` and repeated in the `create-checkout`, `verify-checkout`, and `paymongo-webhook` Edge Functions. These values currently match: OIC-NW ₱20/week, ₱50/month, ₱350/year; GMDSS ₱15/week, ₱40/month, ₱250/year; Engine OIC-EW ₱20/week, ₱50/month, ₱350/year; Deck Management and Engine Management ₱40/week, ₱100/month, ₱700/year. If prices change, update the client catalogue and all three server-side price maps in the same release, then retest checkout, webhook, and verification before enabling payments. The server-side price map is authoritative for amounts charged. Checkout requires `PAYMONGO_CHECKOUT_ENABLED=true`, a key for the configured mode, and an explicit expected test/live mode.

Once you have registered the **test-mode webhook**, saved its signing secret, configured the test API key, and confirmed the expected mode is `false`, enable test checkout:

```sh
supabase secrets set PAYMONGO_CHECKOUT_ENABLED=true
```

Complete the end-to-end test below. To pause checkouts at any time, set the toggle back to `false`.

For **production/live mode**, change `PAYMONGO_SECRET_KEY` to your PayMongo live secret key (`sk_live_...`), set `PAYMONGO_WEBHOOK_SECRET` to the signing secret for the live webhook endpoint, and set `PAYMONGO_EXPECT_LIVEMODE=true`. First set `PAYMONGO_CHECKOUT_ENABLED=false` while switching to live credentials and registering the live webhook. Verify the live API key and signing secret are matched to live mode; then set `PAYMONGO_CHECKOUT_ENABLED=true`. Keep the test and live keys separate. Do not use test-mode events to activate production subscriptions.

The `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are supplied to Supabase Edge Functions. Do not add the service-role key to Cloudflare or frontend environment variables.

## 3. Register the PayMongo webhook

In the PayMongo Dashboard:

1. Open **Developers → Webhooks** and create an endpoint.
2. Use this URL for the connected Hyperion Supabase project:
   `https://evnjoezffghtrzqacwcj.supabase.co/functions/v1/paymongo-webhook`
3. Subscribe to `checkout_session.payment.paid`.
4. Copy that webhook endpoint's **signing secret** into the Supabase Function secret `PAYMONGO_WEBHOOK_SECRET`. This is not the PayMongo API secret key.
5. For test mode, use a test-mode endpoint/key and `PAYMONGO_EXPECT_LIVEMODE=false`. For live mode, use the live endpoint's signing secret and `PAYMONGO_EXPECT_LIVEMODE=true`.

Supabase's configuration intentionally disables JWT verification only for `paymongo-webhook`, because PayMongo does not send a Supabase user JWT. The function verifies the PayMongo signature itself and rejects missing, invalid, or stale signatures. `create-checkout` still requires a signed-in Hyperion user.

## 4. What the student sees

1. Sign in to Hyperion and open Account → Shop & basket.
2. Add one or more reviewer track cards to the basket and review the summed price.
3. The server creates one basket order, one child order for each selected track, and one PayMongo hosted checkout using server-owned prices.
4. The student pays once on PayMongo's hosted page. Enabled payment methods can include GCash, Maya, QR Ph, and cards, depending on the merchant's PayMongo configuration.
5. PayMongo sends `checkout_session.payment.paid` to the configured webhook. The server verifies the signature, session ID, exact basket metadata, amount, currency, and child order list before marking the batch and item orders paid and granting 12-month access for each selected track only.
6. Hyperion also asks the authenticated `verify-checkout` function to retrieve the checkout directly from PayMongo on success return and when the student refreshes payment status. This is a fallback if webhook delivery is delayed. A successful browser redirect alone never unlocks anything.

If a student cancels the hosted checkout, PayMongo does not automatically close the checkout session. The Account page therefore offers **CANCEL CHECKOUT & SWITCH TO MANUAL** for a pending session. The authenticated `cancel-checkout` function retrieves the session, refuses cancellation if a payment is already paid or pending/processing, and otherwise calls PayMongo's session-expiration endpoint before marking the order cancelled. Only after that succeeds can the student submit a manual QR payment. PayMongo documents that active sessions do not expire automatically and that ongoing payments must not be expired: https://docs.paymongo.com/docs/payment-channels-key-concepts and https://docs.paymongo.com/reference/expire-a-checkout-session.

The existing QR/manual process remains available as a fallback. Manual payments still require an admin to verify the actual incoming transaction and approve the order.

## 5. Payment confirmation troubleshooting

For a successful PayMongo payment that remains pending in Hyperion:

1. Do not manually approve a PayMongo Checkout order, and do not ask the customer to pay again.
2. In PayMongo Dashboard → Developers → Webhooks, inspect the endpoint for the same mode used by the payment (test or live). It must be enabled and subscribe to `checkout_session.payment.paid`.
3. Confirm the URL is exactly `https://evnjoezffghtrzqacwcj.supabase.co/functions/v1/paymongo-webhook`.
4. Open the webhook delivery history and send a test event. The delivery must receive a 2xx response. If the endpoint is disabled, inspect its disabled reason and re-enable it after correcting the issue.
5. If the event was missed, use Hyperion's Orders & Payment History → Refresh status to run authenticated server-to-PayMongo verification. Hyperion must verify payment status, amount, currency, checkout reference, and metadata before granting access.

PayMongo documents that webhook delivery can be retried and that an endpoint may be automatically disabled after repeated failures. It also warns that missed events may not be redelivered after an outage, which is why the server-side verification fallback matters. See https://docs.paymongo.com/reference/webhook-resource and https://docs.paymongo.com/docs/developer-tools-webhook-setup-management.

## 5. Test before switching to live payments

- Use test keys and the PayMongo webhook test-event tool first.
- Complete a one-item checkout and confirm its `checkout_batches` row (or legacy `orders` row) is `paid`.
- Add at least two tracks to the basket and make one test checkout. Confirm that the batch total equals the sum of the displayed prices, each selected track has one paid order row, and each has an active entitlement.
- Confirm no unselected track is activated and each entitlement expires about one year after confirmation.
- Test cancellation/resume, failed checkout creation, wrong amount/currency, invalid webhook signatures, delayed webhook delivery, duplicate webhook delivery, and retried checkout creation. Duplicate deliveries must not extend the same purchase twice; creation retries should reuse the same persisted order/batch ID as the PayMongo `Idempotency-Key`.
- Verify that an arbitrary `?payment=success` URL does not grant access.
- After testing, switch the checkout API key, webhook signing secret, and expected live-mode setting together before accepting real payments. Only then set `PAYMONGO_CHECKOUT_ENABLED=true`.

## 7. Manual admin workflow

Manual QR orders continue to use the private Admin dashboard. Set `ADMIN_EMAILS` to the comma-separated exact email addresses allowed to review manual payments:

```sh
supabase secrets set ADMIN_EMAILS=your-admin-email@example.com
supabase functions deploy admin-payment-review
supabase functions deploy submit-manual-payment
```

Admins must verify the actual transaction received before approving a manual order. A screenshot alone is not sufficient proof.

## 8. Security notes

- Never trust a browser redirect, client-provided price, or a payment screenshot as confirmation of a PayMongo payment.
- Never expose `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`, or `SUPABASE_SERVICE_ROLE_KEY`.
- Only the signed webhook or authenticated server-side verification against PayMongo may auto-activate a PayMongo order.
- Keep the webhook URL public and HTTPS, but require a valid PayMongo signature before performing any database writes.
