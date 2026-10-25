# Hyperion PWA: Supabase + PayMongo setup

This integration uses Supabase Auth/Postgres/Edge Functions and PayMongo Hosted Checkout. Monthly platform cost can remain $0 while usage stays within free quotas; PayMongo charges transaction fees on successful live payments.

## Current status

- Account screen supports email/password signup and sign-in.
- Checkout is created server-side, with product prices held in Supabase Function secrets.
- The PayMongo webhook verifies signatures and records paid orders and entitlements.
- Track access UI is not yet fully wired to cloud entitlements across every screen. Do not launch sales until that integration and end-to-end tests are complete.
- Existing offline activation-key licensing remains in the app.

## 1. Create Supabase project

1. Create a Supabase project on the Free plan.
2. Run \`supabase/schema.sql\` in SQL Editor.
3. In Authentication > URL Configuration, set your deployed PWA URL as the Site URL and add it to Redirect URLs.
4. Copy the project URL and public anon/publishable key from Project Settings > API.
5. In Cloudflare Pages > Settings > Environment variables, set \`VITE_SUPABASE_URL\` and \`VITE_SUPABASE_ANON_KEY\` for Preview and Production. These are public browser values; never use the service-role key here.

## 2. Set server-side secrets

From the repository root, after installing the Supabase CLI:

\`\`\`sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set PAYMONGO_SECRET_KEY=sk_test_REPLACE_ME
supabase secrets set PAYMONGO_WEBHOOK_SECRET=REPLACE_WITH_TEST_WEBHOOK_SECRET
supabase secrets set APP_BASE_URL=https://YOUR_DEPLOYED_PWA_URL
supabase secrets set PRICE_OIC_NW_PHP=499
supabase secrets set PRICE_GMDSS_PHP=499
supabase secrets set PRICE_ENGINE_EW_PHP=499
supabase secrets set PRICE_DECK_MGT_PHP=499
supabase secrets set PRICE_ENGINE_MGT_PHP=499
supabase secrets set PRICE_ALL_ACCESS_PHP=1499
supabase functions deploy create-checkout
supabase functions deploy paymongo-webhook
\`\`\`

The prices above are placeholders, not a recommendation. Replace them with your actual prices before enabling checkout. Prices are whole Philippine pesos; the function converts them to centavos. Do not use live keys until test-mode checkout and webhook fulfillment pass.

Supabase automatically provides \`SUPABASE_URL\`, \`SUPABASE_ANON_KEY\`, and \`SUPABASE_SERVICE_ROLE_KEY\` to deployed functions. Never expose the service-role key in the browser or commit it to Git.

## 3. Configure PayMongo test mode

1. Create/complete your PayMongo merchant account and use test API keys first.
2. Enable the payment methods available to your account (the checkout requests GCash, Maya, QRPh, and cards).
3. In PayMongo Dashboard > Developer Tools/Webhooks, add endpoint \`https://YOUR_PROJECT_REF.supabase.co/functions/v1/paymongo-webhook\`.
4. Subscribe to \`checkout_session.payment.paid\` and save that endpoint's webhook secret as \`PAYMONGO_WEBHOOK_SECRET\` in Supabase secrets. Use the test-mode secret with the test API key; configure live mode separately when launching.
5. Create a test account, start checkout, complete a PayMongo test payment, and confirm the order becomes \`paid\` and an entitlement is inserted in Supabase.

## 4. Cost and safety notes

- PayMongo Hosted Checkout has no setup or monthly subscription fee according to its current pricing page, but successful payments incur transaction fees.
- Keep Supabase within Free-plan quotas; free projects may pause after inactivity and quotas/terms can change.
- Never grant access from the success redirect alone. Only the signed webhook can mark an order paid.
- RLS allows users to read only their own orders and entitlements. Writes happen server-side using the service role.
- Before production, test duplicate webhook deliveries, invalid signatures, wrong amount/session IDs, canceled checkout, refund handling, and each track's access behavior.
- This PWA currently ships question-bank assets to the client for offline use. UI gating discourages casual access but cannot guarantee content secrecy against a technically determined user. Strong server-enforced content protection requires changing the question delivery model.
