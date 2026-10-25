# Hyperion PWA: Supabase manual payment review setup

This version uses manual payment confirmation. Students send payment using the instructions you publish, then submit the payment method, transaction/reference number, and optionally a proof link. An admin verifies the transaction and approves or rejects it in the private PWA admin dashboard. PayMongo checkout and payment webhooks are not used by this flow.

## 1. Supabase project and database

1. Create a Supabase project on the Free plan.
2. Run `supabase/schema.sql` in the SQL Editor. If the earlier PayMongo schema was already applied, this script creates the additional fields/tables it needs only on a fresh table; for an existing installation, use a migration to add the new columns and update the status check constraint before deploying.
3. In Authentication > URL Configuration, set your deployed PWA URL as the Site URL and add it to Redirect URLs.
4. Copy the project URL and public anon/publishable key from Project Settings > API.
5. In Cloudflare Pages > Settings > Environment variables, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for Preview and Production. Never put the service-role key in the browser.

## 2. Set server-side secrets

From the repository root, after installing the Supabase CLI:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set ADMIN_EMAILS=your-admin-email@example.com
supabase secrets set PRICE_OIC_NW_PHP=499
supabase secrets set PRICE_GMDSS_PHP=499
supabase secrets set PRICE_ENGINE_EW_PHP=499
supabase secrets set PRICE_DECK_MGT_PHP=799
supabase secrets set PRICE_ENGINE_MGT_PHP=799
supabase functions deploy submit-manual-payment
supabase functions deploy admin-payment-review
```

Set `ADMIN_EMAILS` to a comma-separated list of exact account email addresses that should have admin access. The check runs server-side; hiding the dashboard button alone is not security. Sign up with the admin email and confirm the account before using the dashboard.

Prices are whole Philippine pesos and stored only in Supabase Function secrets. Only the five individual tracks are offered; the all-access bundle has been removed.

## 3. Configure the payment instructions

1. Sign in to the PWA using an email included in `ADMIN_EMAILS`.
2. Open Account > Admin dashboard.
3. Edit the payment instructions with your chosen payment method, account name/number or other payment details, exact transfer instructions, and a reminder to include the transaction reference.
4. Save the instructions. They are displayed to signed-in students on the account page.

The payment method is deliberately generic because the final method has not been specified yet. Do not publish sensitive account credentials or payment PINs.

## 4. Manual review flow

1. Student creates an account, selects a track, sends payment using the published instructions, then submits the payment method and transaction/reference number. A proof URL is optional.
2. The server creates a submitted order with the product price read from secrets. A success message or uploaded proof does not unlock anything.
3. Admin opens the private dashboard and compares the submission against the actual payment received outside the PWA.
4. Only after verifying the transfer, admin clicks Approve & unlock. The server creates the entitlement and marks the order paid. Reject marks the submission failed and does not grant access.
5. The student refreshes the account page or signs in again to refresh entitlements.

## 5. Important safety and launch checks

- Never approve based on a screenshot alone; verify the transaction in the payment provider/bank account.
- Use a unique transaction reference for every transfer and reconcile duplicate submissions manually.
- Configure the admin allowlist before deployment. If you lose admin access, update the server secret, redeploy only if required by your setup, and sign in with an allowlisted account.
- Test signup, email confirmation, sign-in/out, payment submission, RLS isolation, non-admin access denial, approval, rejection, duplicate submissions, and correct track unlock.
- Existing question-bank assets are bundled with the PWA for offline use. Client-side gating alone cannot keep those assets secret from a technically determined user.
- Keep Supabase within Free-plan quotas; quotas and inactivity policies can change.
