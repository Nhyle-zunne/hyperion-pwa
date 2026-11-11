# Incremental progress V2 — cross-platform release gates

**Status (2026-11-12): staged, disabled.** This must not be interpreted as a production migration or measured I/O saving. Supabase Free quota work remains on the existing V1 protocol until this checklist is completed.

## Baseline and safety invariants

- V1 `learning-progress:read/write` plus Save & Exit and independent `write-sessions` archives remain the production system of record.
- Cloud account identity is derived from a gateway-verified JWT, never a user ID in the request body. Paid access and revocation are checked fresh before serving question-bearing content.
- Existing `prepare_learning_progress` and `merge_preserved_progress_items` **merge item-only bookmark/mistake patches with old rows**, and require timestamped deletion ledgers to remove old items. New SQL/PGlite tests exercise these exact triggers.
- V2 operations are owner-scoped, versioned per section, and durable. An ambiguous timeout must replay the same operation ID and content. Only a verified 200 ACK clears the encrypted outbox. A definite HTTP 409 requires read, merge and a new durable operation ID. A wrong-account response never clears queued data.
- Full snapshots remain available for unknown versions, malformed/oversized operations, migration recovery, older Android builds, or a server rollout with V2 missing.
- SQL functions must be `SECURITY INVOKER` and `EXECUTE` restricted to service_role. They are never direct APIs for client JWT roles.

## Progress in this branch

- Ported the V2 server handlers and additive SQL migration from superseded PWA PR #88 onto current `main`, preserving all recent Supabase disk I/O, archive, Google Play and license lookup optimizations.
- Added PWA per-record planner, encrypted owner-scoped IndexedDB outbox and a **disabled** gated delivery boundary, with tests for replay, account switching and 409 retention.
- Android PR #10 contains a native planner, encrypted outbox, and disabled delivery boundary with corresponding Robolectric tests. Android GitHub Actions currently fail before emitting job steps/logs: **not verified**.

## Must complete before enabling clients

1. Get deterministic **Android Kotlin compilation + Robolectric unit tests** to pass. The missing runner logs are not proof of success. Do not publish an AAB based only on branch changes.
2. Wire PWA and Android sync workers to their V2 delivery boundaries under flags that default OFF, with authenticated owner checks before every network request and the existing per-account synchronization lock.
3. Implement and test three-way conflict resolution: bookmarks/mistakes by item ID and mutation timestamp; completed history by stable session ID; study time by stable segment ID; deletion tombstones versus late offline edits; never discard unacknowledged operations.
4. Synchronize portable **settings** (daylight/theme, text scale, practice automations) via a separately versioned field-level preference format. Older V1 clients cannot accidentally wipe this key because `prepare_learning_progress` merges unknown keys, but the actual PWA/Android mapping, per-field merge and tests are still missing.
5. Plan bounded receipt storage for the `user_learning_progress_section_operations` table before production traffic. This table is additive and receives *zero* live writes while V2 clients remain OFF. Unlimited idempotency receipts could consume Free storage.
6. Run browser + Android regression tests for offline initial hydration, lost ACK, concurrent devices, account switch, expired license, admin revocation, old V1 writer racing V2, completed exam audit and offline restore.
7. Apply the SQL migration with recorded-version-aligned GitHub filename, then deploy `learning-progress` with `verify_jwt=true`. Verify live Edge code matches main. Deploying the backend alone is additive, but should only follow green tests and release review.
8. Canary with synthetic paid account, both real platforms, and a deliberately old Android client. Compare `pg_stat_wal`, backend Edge requests, database row size and egress over representative days, not cumulative counters.

## Known limitation and rollback

V2 currently patches the canonical `user_learning_progress.data` JSONB. It can reduce *network payload bytes*, but PostgreSQL still may rewrite the full current JSONB row and recovery history. **Do not claim reduced disk I/O without measuring it.**

Disable both client flags to restore V1, without deleting V2 receipts or migrations. Keep queued encrypted operations until recovered/acknowledged or explicitly reconciled—never wipe pending user data during fallback. Historical revisions and separately archived sessions must remain untouched.
