# Google Play subscription linking: release checklist

## Current release state

Google Play purchase linking is implemented in the Android and PWA feature branches, but it is **not enabled in the production Supabase project**. The production database does not yet have the `google_play_purchase_links` / `google_play_entitlements` migration, and production does not have the `link-google-play-subscription` or `google-play-rtdn` Edge Functions deployed. A missing Google Play entitlement table is handled as an optional data source by the Android client, so existing website-license sync can continue before the backend rollout.

Do not describe Android Google Play purchases as automatically unlocking website/PWA access until the server-side migration, Edge Functions, Google service-account secret, and acceptance tests are complete.

## No-additional-cost validation (preferred)

**Do not create a hosted Supabase branch for this project under the current no-additional-cost requirement.** The local Supabase stack runs on your own machine and does not consume your hosted Supabase project's quota. It requires the Supabase CLI and a Docker-compatible container runtime.

From the repository root, in a local development environment:

```sh
supabase start
supabase db reset
deno check --no-lock --node-modules-dir=auto \
  supabase/functions/link-google-play-subscription/index.ts \
  supabase/functions/google-play-rtdn/index.ts
bun run test:security
bun run build
bun run test:offline-build
```

- `supabase db reset` resets and reapplies migrations to the **local** Supabase database. It will erase local test data; it does not affect production unless an explicit remote/linked option is used.
- Do not run `supabase db reset --linked`, `supabase db push`, or any deploy command while intending only to test locally.
- For local function testing, use the CLI's `supabase functions serve` with a local-only environment file. Keep service-account JSON and other secrets out of Git, and never use the production service-role key in browser or Android code.
- The GitHub PWA workflow already checks both Google Play functions with Deno, runs the release-safety smoke tests, builds the PWA, and verifies the generated offline app shell. These checks are useful and free within applicable GitHub Actions limits, but they are **not** a substitute for executing the migration against a local Postgres instance or testing a real Play test purchase.

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

## Backend rollout (requires a separate release decision)

1. Complete the no-additional-cost local validation above before considering any hosted changes.
2. Apply `supabase/migrations/20261029164000_add_google_play_purchase_links.sql` only after confirming the migration has passed against a fresh local database.
3. Deploy `link-google-play-subscription` with JWT verification enabled and `google-play-rtdn` with Supabase JWT verification disabled (the RTDN handler verifies Google OIDC itself). Set `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `GOOGLE_PLAY_PUBSUB_AUDIENCE`, and `GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL` in the relevant Edge Function environment.
4. Verify the database has the expected tables, unique purchase-token hash, row-level security policy for users' own entitlements, service-role-only token access, and inactive/product-change revocation trigger.
5. Test the full acceptance checklist below. Keep the change in draft until it passes.
6. Do not create a hosted Supabase branch, change production secrets, deploy functions, apply a production migration, or switch the PR out of draft without a separate explicit decision from the owner.

## Acceptance checklist

- [ ] A signed-in Android user can sync existing website entitlements.
- [ ] A paid Play subscription is verified through Google's Android Publisher API before any website/PWA entitlement is created.
- [ ] An active subscription unlocks only its mapped track; all-access maps to all five supported tracks.
- [ ] The same token can be synced repeatedly for the same account without duplicate entitlements.
- [ ] A token already linked to another Hyperion account is rejected and does not transfer ownership.
- [ ] A verified replacement token is accepted only for the same Hyperion account, and its previous token's grants are retired.
- [ ] Canceled-but-still-valid subscriptions stay entitled only through the verified expiry; expired, pending, on-hold, paused, or otherwise ineligible states do not grant new access.
- [ ] An unrecognized product, malformed token, invalid JWT, missing service-account secret, or Google API outage fails closed for website/PWA access.
- [ ] A missing optional Google Play entitlement table does not break website-license sync.
- [ ] Multiple separately purchased track subscriptions are all considered, even if an all-access subscription is also owned.
- [ ] The offline Android account-license cache is tied to the signed-in Supabase user and respects its bounded offline grace and server-provided expiry.
- [ ] Logging and errors do not expose raw purchase tokens, service-account keys, access tokens, or question-bank content.

## Subscription lifecycle release gate

The feature branch includes a `google-play-rtdn` handler that verifies the Google Pub/Sub OIDC bearer token (signature, issuer, configured audience and verified service-account email), validates the package name, then re-reads subscription state from Google's Android Publisher API. It ignores unknown tokens rather than creating account links. The handler uses the same database-side atomic entitlement reconciliation function as the signed-in Android linking endpoint.

**The RTDN handler is not configured or deployed in production, and scheduled reconciliation is not yet implemented.** Before presenting cross-platform linking as automatic and production-ready, configure a Pub/Sub push subscription with OIDC audience and service account matching the two RTDN secrets, send Google Play Console test notifications, verify retries and revocations, and add a scheduled reconciliation path as recovery. Neither RTDN message payloads nor client claims may be trusted on their own to grant access.

Until these configuration and lifecycle tests pass, do not promise immediate synchronization of cancellation/refund/revocation events between Google Play and the website.
