# Saved study data preservation and recovery

This release preserves the existing local storage keys, encrypted stores and encryption keys. License changes control access; they do not delete bookmarks, mistakes, saved-session metadata, audits or downloaded packs. Initial hydration cannot persist a premature empty collection. Local mutations create encrypted, owner-bound recovery copies. Legacy plaintext collection copies are encrypted into recovery storage before plaintext is removed. Explicit remove/clear and redeemed-mistake tombstones remain authoritative.

Same-account sync merges saved collections and explicit tombstones rather than treating an omitted item as a deletion. Offline edits remain on the device and upload after authenticated reconnection; first-time sign-in cannot occur offline. Signed offline license expiry still applies to opening paid question content. Historical purchase ownership permits backing up previously saved study data after expiry; reading/studying paid questions still requires current access. No other user's data is merged into an account.

## Live deployment order

1. Apply `supabase/migrations/20261102090000_preserve_saved_progress_and_session_audits.sql`. It retains the current row, records bounded service-role-only revisions, prevents omission-based collection loss, and creates owner-scoped session audit storage. A delayed autosave cannot overwrite a finished audit. Completion is recorded only after the encrypted question-and-answer snapshot succeeds; failed saves keep the answers open with a retry action.
2. Deploy the updated `learning-progress` Edge Function with JWT verification enabled. For example, use the Supabase CLI's `functions deploy learning-progress --project-ref PROJECT_REF --use-api`. Keep the existing project secret bindings.
3. Deploy the frontend. It can then attempt account-scoped revision recovery on sign-in, recover surviving same-owner local/cache copies, synchronize audits separately and pre-cache restored audits for offline review.

The database and Edge Function must be deployed as well as the frontend. A frontend commit or Cloudflare build does not deploy Supabase changes.

## Inspect and recover surviving cloud copies

Use a project-authorized management token supplied securely as `SUPABASE_ACCESS_TOKEN`. Never put values in source, chat, command arguments or log output. In a managed environment use the inherited proxy/CA trust and `NODE_USE_ENV_PROXY=1` with Node 24.

```sh
# Counts only; no question text or answers are printed.
NODE_USE_ENV_PROXY=1 node scripts/recover-saved-progress.mjs --project-ref PROJECT_REF --email ACCOUNT_EMAIL
# Restore the inspected account's applicable copies, honoring explicit deletes.
NODE_USE_ENV_PROXY=1 node scripts/recover-saved-progress.mjs --project-ref PROJECT_REF --email ACCOUNT_EMAIL --apply
# Inspect all accounts, then restore applicable copies for all accounts.
NODE_USE_ENV_PROXY=1 node scripts/recover-saved-progress.mjs --project-ref PROJECT_REF --all
NODE_USE_ENV_PROXY=1 node scripts/recover-saved-progress.mjs --project-ref PROJECT_REF --all --apply
```

`--install` can apply the migration before a recovery operation. It is an explicit database schema change. Without `--apply`, recovery returns before/after counts and does not alter progress rows. Revision recovery is restricted to service-role/admin access; the Edge Function's `recover-saved` action always takes the account ID from the authenticated user, never an email or caller-supplied ID.

No migration can recreate records that were already overwritten and have no remaining copy. Before clearing browser data or uninstalling the PWA, check the original device's encrypted store, legacy localStorage, same-account recovery cache, surviving server row/revisions, and any independently available database backup/PITR snapshot. Restore a database backup into a separate recovery project for inspection rather than rolling the live database back over newer users' work. Older history entries without a surviving question snapshot retain their score/summary; answers must never be fabricated from a score alone. History distinguishes unavailable downloads, offline-only gaps and a confirmed missing archive, and offers retry. Unlike Android records, older PWA summary rows do not contain the original question IDs and per-question answers needed to reconstruct a review from the bank. Bookmarks and mistakes use the shared Practice configuration screen with the saved selection as their question pool, including its range selector and sequencing controls.

## Validation

- `npm run build`, `npm run test:security`, `npm run test:offline-build`.
- `bun test scripts/tests/license-offline.test.ts`.
- Deno: `deno test --no-lock --allow-env --node-modules-dir=none supabase/tests/learning_progress_preservation_test.ts`.
- PostgreSQL/PGlite: `node scripts/tests/progress-recovery-sql-test.mjs` (PGlite installed as a test prerequisite, optionally selected by `HYPERION_TEST_TOOLS`).
- Browser fixture: `npm run test:saved-data:browser` after `npx playwright install chromium` (or set `CHROMIUM_PATH` to an installed Chromium). This uses a synthetic account service and bank only in the isolated test build; real stores, account synchronization, routing, configuration, archives and audits execute unchanged. No real account credentials or bank text are needed.

## Idempotent session archive writes

The `skip_unchanged_session_archives` migration adds a service-role-only trigger function after the existing completed-audit protection trigger. An identical effective JSONB snapshot for the same account/session skips the physical UPDATE, retaining its previous `updated_at`. Real draft edits, new archives, and the first completion still save. Stale writes to an already completed audit remain acknowledged without replacing the authoritative answers or repeatedly updating its timestamp. Single and batch archive endpoints request no returned rows from their UPSERTs, so a skipped existing row remains a successful idempotent backup.

This is a schema-only change. It neither rewrites nor deletes current progress, archives, or historical revisions, and does not change the future-revision retention policy. It reduces future duplicate writes; it does not reclaim the disk occupied by protected historical backups. The existing `preserve_completed_session_audit` function and audited baseline stay unchanged.

Validate with `node scripts/tests/session-archive-noop-test.mjs` (also included in `npm run test:saved-data:sql`). The data-preserving rollback is `supabase/rollbacks/skip_unchanged_session_archives.sql`; it removes only the new trigger/function and leaves completed-audit protection in place.
