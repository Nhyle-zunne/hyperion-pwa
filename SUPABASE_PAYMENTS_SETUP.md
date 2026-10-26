# Hyperion PWA: PayMongo automatic checkout and manual payment fallback

Hyperion supports two payment routes:

- **Pay instantly via PayMongo** — Hosted Checkout accepts enabled PayMongo payment methods. A signed PayMongo webhook verifies the payment and automatically grants the selected track license for 12 months.
- **Manual QR payment** — Students submit their transaction reference and profile details. An admin verifies the actual payment and approves/rejects it in the private PWA admin dashboard.

A redirect to Hyperion is not proof of payment. Only the signed server-side webhook is allowed to mark a PayMongo order paid and activate access.

## 1. Database

The PayMongo tracking migration adds `paymongo_checkout_session_id` and `paymongo_payment_id` to `public.orders`. It has already been applied to the connected Hyperion Supabase project. Fresh installs can use `supabase/schema.sql`, which includes these columns and unique indexes.

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
# Keep checkout disabled until you have tested the full payment-to-license flow.
supabase secrets set PAYMONGO_CHECKOUT_ENABLED=false
supabase secrets set APP_BASE_URL=https://hyperionmaritime.org

# These must match the prices shown in Hyperion's Account page.
supabase secrets set PRICE_DECK_OIC_NW_PHP=350
supabase secrets set PRICE_GMDSS_PHP=250
supabase secrets set PRICE_ENGINE_EW_PHP=350
supabase secrets set PRICE_DECK_MGT_PHP=700
supabase secrets set PRICE_ENGINE_MGT_PHP=700

supabase functions deploy create-checkout
supabase functions deploy paymongo-webhook
supabase functions deploy submit-manual-payment
supabase functions deploy admin-payment-review
```

Replace both key placeholders with your actual values locally. Do not paste the keys into ChatGPT or GitHub.

The five price secrets are whole Philippine pesos, matching the current Account page prices. If you change your pricing later, update the Account page product catalogue and these server-side secrets together. The server-side secret remains authoritative for the amount actually charged. The app refuses to start checkout unless `PAYMONGO_CHECKOUT_ENABLED=true`, a key for the configured mode is present, and the expected test/live mode is explicitly configured.

For **production/live mode**, change `PAYMONGO_SECRET_KEY` to your PayMongo live secret key (`sk_live_...`), set `PAYMONGO_WEBHOOK_SECRET` to the signing secret for the live webhook endpoint, and set `PAYMONGO_EXPECT_LIVEMODE=true`. Keep `PAYMONGO_CHECKOUT_ENABLED=false` until the live webhook is registered and the live credentials have been verified. Only then set `PAYMONGO_CHECKOUT_ENABLED=true`. Keep the test and live keys separate. Do not use test-mode events to activate production subscriptions.

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

1. Sign in to Hyperion and open Account → Payments & profile.
2. Choose an individual reviewer track, then select **Pay Instantly via PayMongo**.
3. The server creates an order and asks PayMongo for a hosted checkout session using the configured server-side price.
4. The student pays on PayMongo's hosted page. Enabled payment methods can include GCash, Maya, QR Ph, and cards, depending on the merchant's PayMongo configuration.
5. PayMongo sends `checkout_session.payment.paid` to the configured webhook. The server verifies the signature, session ID, product/user metadata, amount and currency before marking the order paid and granting 12 months of access.
6. Hyperion checks the saved order status on return. If the webhook is still processing, the Account page tells the student to refresh status shortly; a successful redirect alone does not unlock anything.

The existing QR/manual process remains available as a fallback. Manual payments still require an admin to verify the actual incoming transaction and approve the order.

## 5. Test before switching to live payments

- Use test keys and the PayMongo webhook test-event tool first.
- Complete a test checkout and confirm the matching `orders` row is `paid`.
- Confirm an `entitlements` row exists with the correct `track_id` and an `expires_at` about one year ahead.
- Confirm the buyer receives access only to the purchased track.
- Test cancellation, failed checkout creation, wrong amount/currency, invalid webhook signatures, delayed webhook delivery, and duplicate webhook delivery. Duplicate webhooks must not extend the same order's entitlement twice.
- Verify that an arbitrary `?payment=success` URL does not grant access.
- After testing, switch the checkout API key, webhook signing secret, and expected live-mode setting together before accepting real payments. Only then set `PAYMONGO_CHECKOUT_ENABLED=true`.

## 6. Manual admin workflow

Manual QR orders continue to use the private Admin dashboard. Set `ADMIN_EMAILS` to the comma-separated exact email addresses allowed to review manual payments:

```sh
supabase secrets set ADMIN_EMAILS=your-admin-email@example.com
supabase functions deploy admin-payment-review
supabase functions deploy submit-manual-payment
```

Admins must verify the actual transaction received before approving a manual order. A screenshot alone is not sufficient proof.

## 7. Security notes

- Never trust a browser redirect, client-provided price, or a payment screenshot as confirmation of a PayMongo payment.
- Never expose `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`, or `SUPABASE_SERVICE_ROLE_KEY`.
- Only the server-side webhook may auto-activate a PayMongo order.
- Keep the webhook URL public and HTTPS, but require a valid PayMongo signature before performing any database writes.
