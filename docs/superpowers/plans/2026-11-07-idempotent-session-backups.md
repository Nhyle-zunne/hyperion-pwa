# Idempotent session backups

Scope: reduce redundant backend backup writes without deleting historical recovery points or changing saved answers. Read-only production audit found existing progress canonical no-op detection and future-only per-account revision retention already enabled. Of 1,290 historical revisions, 31 repeated exact payloads and 210 repeated canonical study state; all remain protected. Archive storage already has one row per account/session, but identical retries update that row and timestamp unnecessarily.

Add a small BEFORE UPDATE trigger after the existing completed-audit preservation trigger. Compare effective JSONB data plus account/session identity; return NULL for a true no-op so neither the timestamp nor physical row is rewritten. Preserve the existing trigger/function and its baseline hashes. Genuine draft changes, completion, new archives, atomic batches, RLS, entitlement validation and API acknowledgments remain unchanged. No Edge Function or frontend contract change is needed.

1. Reproduce duplicate UPSERT writes in an isolated PostgreSQL-compatible test.
2. Implement the schema-only trigger and a data-preserving rollback. Register tests in CI and verify no-op tuple/timestamp preservation, genuine edits, completion protection, mixed batches, rollback and account isolation.
3. Run existing recovery/revision tests, security and build checks; review before integration. Keep live data unchanged during migration, inspect the installed trigger and permissions, and report that existing storage is not reclaimed by this change.

No historical cleanup, compression rewrite or new retention deletion is included.

Verification: new SQL tests reproduced a redundant UPSERT before implementation and pass after it. Existing recovery/revision/retention tests, release-safety smoke checks, production build, real PostgreSQL concurrency tests, full migration replay and browser CI passed. Review found no blockers.

Live migration `20261106175405` installed the no-op trigger. Catalog checks confirmed both BEFORE UPDATE triggers enabled in preservation-first order, invoker security, no anonymous/authenticated function or archive-table access, RLS enabled, and unchanged historical watermark/future-retention policy. Security advisory categories/counts were unchanged. The tracked filename matches the version assigned by Supabase. No production user data was changed by the migration or used as a write test.
