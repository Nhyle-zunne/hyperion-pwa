# Idempotent session backups

Scope: reduce redundant backend backup writes without deleting historical recovery points or changing saved answers. Read-only production audit found existing progress canonical no-op detection and future-only per-account revision retention already enabled. Of 1,290 historical revisions, 31 repeated exact payloads and 210 repeated canonical study state; all remain protected. Archive storage already has one row per account/session, but identical retries update that row and timestamp unnecessarily.

Add a small BEFORE UPDATE trigger after the existing completed-audit preservation trigger. Compare effective JSONB data plus account/session identity; return NULL for a true no-op so neither the timestamp nor physical row is rewritten. Preserve the existing trigger/function and its baseline hashes. Genuine draft changes, completion, new archives, atomic batches, RLS, entitlement validation and API acknowledgments remain unchanged. No Edge Function or frontend contract change is needed.

1. Reproduce duplicate UPSERT writes in an isolated PostgreSQL-compatible test.
2. Implement the schema-only trigger and a data-preserving rollback. Register tests in CI and verify no-op tuple/timestamp preservation, genuine edits, completion protection, mixed batches, rollback and account isolation.
3. Run existing recovery/revision tests, security and build checks; review before integration. Keep live data unchanged during migration, inspect the installed trigger and permissions, and report that existing storage is not reclaimed by this change.

No historical cleanup, compression rewrite or new retention deletion is included.
