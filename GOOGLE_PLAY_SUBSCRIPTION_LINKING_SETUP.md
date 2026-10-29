# Google Play subscription linking: release checklist

## Current release state

Google Play purchase linking is implemented in the Android and PWA feature branches, but it is **not enabled in the production Supabase project**. The production database does not yet have the `google_play_purchase_links` / `google_play_entitlements` migration, and production does not have the `link-google-play-subscription` Edge Function deployed. A missing Google Play entitlement table is handled as an optional data source by the Android client, so existing website-license sync can continue before the backend rollout.

Do not describe Android Google Play purchases as automatically unlocking website/PWA access until the server-side migration, Edge Function, Google service-account secret, and acceptance tests are complete.

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

## Safe backend rollout

1. Use an isolated Supabase test environment before changing production. The Supabase branch resource has an hourly cost; obtain explicit approval for the current quoted cost before creating it.
2. Apply `supabase/migrations/20261029164000_add_google_play_purchase_links.sql` only to that isolated environment first.
3. Deploy `link-google-play-subscription` with JWT verification enabled, then set `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` in that environment.
4. Verify that the database has the expected tables, unique purchase-token hash, row-level security policy for users' own entitlements, service-role-only token access, and inactive/product-change revocation trigger.
5. Test the full acceptance checklist below. Keep the change in draft until it passes.
6. Production deployment, production migration, secrets changes, and switching the PR out of draft require a separate release decision after test evidence is reviewed.

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

## Subscription lifecycle release blocker

The current linking endpoint checks Google Play when a token is linked or synced. **Real-time Developer Notifications (RTDN) and scheduled reconciliation are not implemented in this feature yet.** That means some changes—such as a refund/revocation or an entitlement change that is not followed by another app sync—may not be reflected immediately in the linked rows.

Before presenting cross-platform linking as automatic and production-ready, implement and test an authenticated Pub/Sub RTDN handler. It must verify the OIDC push token (signature, issuer, exact audience and expected service-account email), validate the package name, and then re-read the subscription using Google's Android Publisher API as the source of truth. Add a scheduled reconciliation path as a recovery mechanism. Neither endpoint may trust notification payloads alone to grant access.

Until those lifecycle handlers exist, do not promise immediate synchronization of cancellation/refund/revocation events between Google Play and the website.
