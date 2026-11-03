# Bounded future progress revisions (2026-11-04)

## Why

The progress-revision table stores complete earlier versions of each account's encrypted study data, including recovery history for bookmarks, mistakes and sessions. The initial optimization eliminated unnecessary full-snapshot revisions, but deliberately stopped all pruning. Without a limit, meaningful progress updates could grow PostgreSQL indefinitely.

## Exact retention boundary

Migration `20261104030000_bound_future_progress_revisions.sql` takes a write-locked, atomic watermark `protected_through_id = max(id)` of every revision that already exists at installation.

- **All records at or below this cutoff are permanently exempt from this new pruning mechanism.** No old production recovery revision is updated or deleted by the migration.
- For each account independently, **the 10 newest future revisions** (IDs strictly greater than the watermark) are retained. The current progress row is *in addition to* these ten revisions, not counted among them.
- Older *future* revisions automatically age out only following a real progress change for the same account. New snapshots and pruning commit/rollback in the same transaction.
- No-op saves do not create revisions or trigger pruning. The optimistic version, tombstone, account-scoped recovery and active-session safeguards remain unchanged.
- Admin-owned historical recovery snapshots and users' previous study records remain in the original table. The existing account recovery RPC can still read them. No additional paid service or scheduler is introduced.

The new `user_learning_progress_revision_retention` policy table has RLS enabled and is inaccessible to anonymous or ordinary authenticated clients. The trigger runs with its existing restricted server privileges. The policy may be paused by a privileged database operator using `enabled=false` if retention unexpectedly affects recovery; disabling it does not interrupt normal progress saving. Restoring the policy resumes pruning of future snapshots at the next meaningful update. If the policy row is missing, writes continue but **never delete** revision rows.

## Limits and recovery trade-off

This is a **future-only cap**. It stabilizes post-cutover per-account growth, but does not reduce the preexisting table size or the number of baseline rows. All 10 most recent future versions remain full recoverable snapshots; older future-only versions cease to be recoverable when replaced. An independent historical backup has not been verified by this migration. If longer-term exact history is required, create separately backed-up milestones before reducing this cap further.

The cap is 10, matching the prior recommended 5–10 recent history points while preserving substantially more than a single rollback. It is a cap on *revisions*, not all Supabase storage: new accounts and expanding snapshots can still grow the database. Monitor quota and Egress independently, particularly when planning to downgrade from Pro to Free.

Never interpret PostgreSQL relation-size stability as proof of immediate disk-space shrinkage: pruning makes pages reusable, and physical TOAST relation sizes may not decrease until later vacuum/rewrite maintenance. **No historical data cleanup or VACUUM FULL is part of this change.**

## Verification requirements

- Run `npm run test:progress-revisions` for legacy preservation + future-only cap + emergency pause + recovery and RLS.
- Run the existing synthetic PostgreSQL concurrency/rollback suite.
- Replay all Supabase migrations in CI and verify PWA production build/security/browser regressions.
- On deployment, confirm migration watermark and verify that the pre-cutover row count and payload fingerprints remain unchanged.
- Do not delete existing historical snapshots without a separately approved, independently backed-up cleanup plan.
