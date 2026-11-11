# Supabase Free: consolidate historical license lookup for saved progress

## Why this change

Supabase gateway logs in a one-day window (2026-11-11/12 UTC) showed approximately 20k `entitlements` reads, 18k `google_play_entitlements` reads and 17k `learning-progress` Edge invocations. These are observed HTTP request counts, **not** DB disk I/O consumption. Historical ownership previously loaded both website and Play tables over two REST requests every time a paid user saved question history or archive snapshots.

## Exact behavior

- New private `get_learning_progress_owned_tracks(p_user_id uuid)` SQL function runs one `UNION` query across the same two tables. The function is `STABLE SECURITY INVOKER` and EXECUTE is denied to `PUBLIC`, `anon`, and `authenticated`; only the authenticated Edge Function's **service role** can call it.
- `learning-progress` still extracts the owner from a Supabase gateway-verified JWT. The `p_user_id` argument is not accepted from the request body. Admin overrides remain unchanged.
- The result includes **historically owned tracks** even if their website/Play license has expired or been revoked. This permission allows backing up user-owned prior work only, **not accessing paid questions**. Premium-content reads, expired access, free-question validation and all current-license checks are unchanged.
- When Supabase has not yet installed the private RPC (`PGRST202`) the Edge Function uses the old two-query implementation for compatibility. Any other error returns 503 instead of bypassing the ownership check.
- This only cuts one backend REST roundtrip per historical-ownership check; it **does not** reduce the number of Edge Function invocations. Compare actual usage metrics after deployment.

## Safety and verification

- No tables or rows modified. No changes to payment, subscription, license grant/revoke, or Android versions.
- Isolated SQL regression verifies owner separation, duplicates, old revoked/expired tracks for backups, private grants and absence of writes.
- Deno Edge regression verifies account-scoped calls, denied/unowned backups, old-database fallback and fail-closed errors.
- Run full PWA and Supabase CI before merging. Deploy SQL migration before Edge update, retain `verify_jwt=true`, and verify live function source matches repository.
- Roll back by restoring the previous Edge function; SQL is read-only and may remain installed without side effects. Do not drop the SQL function while newer Edge builds may still call it.

## Future improvements

Highest potential impact after this change is reducing **total `learning-progress` invocations** without compromising completed-exam immediate checkpoints or local offline saves. The previously deployed 12-second archive coalescer needs at least a day of representative post-release traffic before changing its interval further.

A separate enhancement could batch/reuse authorization within the `question-bank` Edge function while preserving live revocation, but should not cache positive paid grants across requests without an expiry/owner-revocation contract.
