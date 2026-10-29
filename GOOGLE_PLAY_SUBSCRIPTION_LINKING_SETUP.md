# Google Play subscription linking: release checklist

## Current test rollout state

The two Google Play migrations have been applied to the hosted Supabase project, and these Edge Functions are deployed: `link-google-play-subscription` (JWT verification enabled), `google-play-rtdn` (Google OIDC verification in the handler), and `reconcile-google-play-subscriptions` (private token verification in the handler). The purchase-link/entitlement tables are empty as of rollout verification. RLS is enabled, client roles cannot read raw purchase tokens or invoke the atomic entitlement RPC, and the reconciliation Vault flag is confirmed to be `false`.

**The integration is not yet end-to-end ready.** This rollout did not configure or verify `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `GOOGLE_PLAY_PUBSUB_AUDIENCE`, or `GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL`; these must be configured securely in Supabase Edge Function secrets. The Android CI Web OAuth client ID and its signing-certificate registration must also be verified before sign-in is expected to work in the test APK.

Do not describe Android Google Play purchases as automatically unlocking website/PWA access until those credentials are configured and real Play test-subscription acceptance tests pass.

## No-additional-cost validation (preferred)

**Do not create a hosted Supabase branch for this project under the current no-additional-cost requirement.** The local Supabase stack runs on your own machine and does not consume your hosted Supabase project's quota. It requires the Supabase CLI and a Docker-compatible container runtime.

From the repository root, in a local development environment:

```sh
supabase start
supabase db reset
deno check --no-lock --node-modules-dir=auto \
  supabase/functions/question-bank/index.ts \
  supabase/functions/link-google-play-subscription/index.ts \
  supabase/functions/google-play-rtdn/index.ts \
  supabase/functions/reconcile-google-play-subscriptions/index.ts \
  supabase/functions/create-checkout/index.ts \
  supabase/functions/submit-manual-payment/index.ts \
  supabase/functions/admin-license-management/index.ts \
  supabase/functions/expire-inactive-accounts/index.ts
bun run test:security
bun run build
bun run test:offline-build
```

- `supabase db reset` resets and reapplies migrations to the **local** Supabase database. It will erase local test data; it does not affect production unless an explicit remote/linked option is used.
- Do not run `supabase db reset --linked`, `supabase db push`, or any deploy command while intending only to test locally.
- For local function testing, use the CLI's `supabase functions serve` with a local-only environment file. Keep service-account JSON and other secrets out of Git, and never use the production service-role key in browser or Android code.
- The GitHub PWA workflow checks the modified Edge Functions with Deno, runs the release-safety smoke tests, builds the PWA, verifies the generated offline app shell, and tests the entitlement RPC plus the Vault-gated scheduler against isolated PostgreSQL. These checks do not touch the hosted Supabase project, but they are **not** a substitute for local Supabase-stack validation or testing a real Play test purchase.

Official reference: [Supabase local development is free and does not consume hosted project quota](https://supabase.com/docs/guides/local-development).

## Required configuration

### 1. Google Play Console and Google Cloud

1. Verify that the Android package name is exactly `com.nhyle.hyperionmaritime`.
2. Confirm that the existing subscription product IDs match the app and server mapping:
   - `hyperion_oic_nw_pass`
   - `hyperion_gmdss_pass`
   - `hyperion_engine_oic_ew_pass`
   - `hyperion_deck_mgt_pass`
   - `hyperion_engine_mgt_pass`
   - `hyperion_all_access_pass`
3. Enable the Google Play Android Publisher API in the appropriate Google Cloud project.
4. Create or identify a dedicated service account, authorize it for the Android Publisher API in Play Console, and verify it can read subscription state for the production app.
5. Store its JSON in Supabase Edge Function secrets as `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`. Never commit the JSON, private key, OAuth client secret, or Supabase service-role key to GitHub or the Android/PWA client.

### 2. Google sign-in in the Android app

1. Configure Google as a Supabase Auth provider and confirm the Web OAuth client ID.
2. Register the Android OAuth client for `com.nhyle.hyperionmaritime` and the correct signing certificate fingerprints, including Play App Signing for Play-distributed builds.
3. Set `HYPERION_GOOGLE_WEB_CLIENT_ID` as a Gradle property or CI secret. It is a client ID, not a client secret.
4. Sign-in remains optional. Existing Google Play Billing access and the existing device-bound/offline license mechanisms must keep working when a user does not sign in.

## Remaining setup and test rollout

1. The no-additional-cost local Supabase-stack validation has passed in GitHub Actions, including full migration replay, the Google Play atomic entitlement regression tests, scheduler/security assertions, and database lint.
2. The purchase-link and scheduler migrations are already applied to the hosted Supabase project. The three Edge Functions listed above are deployed.
3. In Supabase Dashboard → Edge Functions → Secrets, configure `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` with a service-account JSON authorized for the Android Publisher API in Play Console. Never commit the JSON/private key or expose it to the Android/PWA client.
4. Configure `GOOGLE_PLAY_PUBSUB_AUDIENCE` and `GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL` to match the Google Pub/Sub push subscription's OIDC settings before testing RTDN. The service-account secret is also required for the linker and reconciler to read subscription state from Google.
5. Verify the Android Google Web OAuth client ID and register the test APK's signing certificate SHA-1 in the Android OAuth client. Set GitHub Actions secret `HYPERION_GOOGLE_WEB_CLIENT_ID` to the Web OAuth client ID (not its client secret).
6. The scheduler migration creates the private cron token and a 15-minute job, but `hyperion_google_play_reconciliation_enabled` remains `false`. Keep it disabled until real Play test purchases, cancellation/expiry, RTDN delivery, and periodic recovery have been accepted. The scheduler's project URL secret must also be correct before enabling it.
7. Keep the PRs in draft until the acceptance checklist passes. Do not enable the reconciliation flag based only on compile or schema tests.

## Acceptance checklist

- [ ] A signed-in Android user can sync existing website entitlements.
- [ ] A paid Play subscription is verified through Google's Android Publisher API before any website/PWA entitlement is created.
- [ ] An active subscription unlocks only its mapped track; all-access maps to all five supported tracks.
- [ ] The same token can be synced repeatedly for the same account without duplicate entitlements.
- [ ] A token already linked to another Hyperion account is rejected and does not transfer ownership.
- [ ] A verified replacement token is accepted only for the same Hyperion account, its previous token's grants are retired, and that replaced token can never be re-linked or restored by a late RTDN notification.
- [ ] Canceled-but-still-valid subscriptions stay entitled only through the verified expiry; expired, pending, on-hold, paused, or otherwise ineligible states do not grant new access.
- [ ] An unrecognized product, malformed token, invalid JWT, missing service-account secret, or Google API outage fails closed for website/PWA access.
- [ ] A missing optional Google Play entitlement table does not break website-license sync.
- [ ] Multiple separately purchased track subscriptions are all considered, even if an all-access subscription is also owned.
- [ ] The offline Android account-license cache is tied to the signed-in Supabase user and respects its bounded offline grace and server-provided expiry.
- [ ] Logging and errors do not expose raw purchase tokens, service-account keys, access tokens, or question-bank content.

## Subscription lifecycle release gate

The deployed `google-play-rtdn` handler that verifies the Google Pub/Sub OIDC bearer token (signature, issuer, configured audience and verified service-account email), validates the package name, then re-reads subscription state from Google's Android Publisher API. It ignores unknown tokens rather than creating account links. The signed-in Android linker, RTDN handler, and new periodic worker share the same database-side atomic entitlement reconciliation function. The worker processes up to 20 purchase links per invocation in oldest-attempt-first order, skips replaced predecessors, and records attempts so one bad token does not permanently starve later records.

**RTDN delivery and periodic reconciliation are not yet fully configured for end-to-end use.** The functions and opt-in schedule are deployed, but: the migration creates the cron entry and Vault-backed token but leaves `hyperion_google_play_reconciliation_enabled=false`; the cron sends no HTTP request until an owner explicitly enables it. Before presenting cross-platform linking as automatic and production-ready, configure a Pub/Sub push subscription with OIDC audience and service account matching the RTDN secrets, set the Edge Function service-account secret, test Play purchases and cancellation/expiry behavior, verify RTDN retries and revocations, and only then approve the periodic job. Neither RTDN message payloads nor client claims may be trusted on their own to grant access.

Until these credentials, RTDN delivery settings, and lifecycle tests pass, do not promise immediate synchronization of cancellation/refund/revocation events between Google Play and the website.


## Reconciliation opt-in checklist

- [ ] Deploy the migration and `reconcile-google-play-subscriptions` Edge Function only after reviewing the local regression evidence.
- [ ] Keep the Vault flag `hyperion_google_play_reconciliation_enabled` at `false` during setup and test calls.
- [ ] Verify that the `hyperion_google_play_reconciliation_cron_token` exists only in Vault and that the verifier RPC is executable only by `service_role`.
- [ ] Test the handler with an incorrect token (401), with reconciliation disabled (401), and after enabling only in a non-production environment.
- [ ] Confirm the 15-minute cron entry performs no outbound request while disabled.
- [ ] After real test subscriptions cover renewals, canceled-but-valid subscriptions, expiry, on-hold, refunds/revocations, and replacement tokens, obtain the owner's separate approval before enabling the production flag.
