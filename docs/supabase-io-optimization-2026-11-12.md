# Hyperion Supabase disk I/O reduction — baseline and rollout (2026-11-12)

## Verified baseline

Read-only measurements on project `hyperion-maritime`:

| Item | Observation |
|---|---|
| Database | 241 MB |
| Cache hit | 99.96% (cumulative, read-only reads) |
| Recovery revisions | 148 MB, 1,649 revisions |
| Session archives | 52 MB, 2,027 sessions |
| Current saved progress | 15 MB, 219 rows |
| Session archive row updates | ~100,655 (cumulative since stats collection) |
| Current progress row updates | ~56,654 (cumulative since stats collection) |
| `pg_stat_wal` | 18 GB accumulated since 2026-10-02; **not** current disk size |
| Revision retention | enabled, 10 future revisions per account; all IDs at/below the protected watermark untouched |

**Caution:** These are historical activity counters, not a live Disk IO % consumed reading. Compare differences between two observation times before attributing an improvement. Supabase Disk IO % consumed is a compute/host metric visible in Observability and is affected by storage IOPS, checkpointing and WAL. WAL numbers are cumulative and do not equal currently allocated storage.

## Already deployed before this PR

- The 2026-11-06 `skip_unchanged_session_archives` trigger prevents identical JSONB archive updates from writing physical tuples. A completed exam's immutable audit remains protected.
- PWA local encrypted archive sync already hashes individual records; no network request when the owner-scoped marker matches. Free users cannot use the protected cloud sync. Android already has a background sync cooldown.
- `compare_user_learning_progress` rejects stale/unchanged full-snapshot writes before updating current progress.
- Future-only retention keeps 10 full independent snapshots per account plus every protected historical revision.

Do not delete old backups or run `VACUUM FULL` on these tables as an I/O optimization.

## Changes in this PR

1. A **private conditional archive UPSERT** avoids even invoking update triggers for identical encrypted/audited JSONB payloads. The Edge Function first validates all entries and the current owner's entitlements, then calls this one-statement RPC. It can fall back to the legacy upsert while the SQL migration propagates. Old Android and PWA clients remain compatible.
2. **Revision checkpoint spacing:** full recovery revision on the first meaningful post-policy edit, then at most one normal checkpoint per account per 300 seconds. Explicit deletion ledger changes and transitions to completed exams capture recovery immediately. The *current* progress row still saves every change; neither question answers nor bookmarks are throttled. The 10 most recent future independent backups still apply; all protected historical backups and existing sessions are unchanged.
3. **Configurable emergency switch:** privileged operator sets `min_checkpoint_seconds = 0` to restore per-change full backups without changing applications or deleting data.
4. A permanent **read-only monitoring report** at `supabase/reports/disk-io-health.sql`, to compare actual query WAL/write counts and Supabase's Disk IO % consumed before and after.

## Release order and verification

- Run local isolated PGlite migration tests, complete Supabase stack validation, PWA security and browser tests.
- Apply both SQL migrations before releasing the updated Edge Function; Edge supports fallback on an older database in any case.
- Deploy the existing `learning-progress` Edge Function only via the dedicated deployment workflow/authorized CLI; the Cloudflare Worker deploy **does not** deploy Supabase Edge Functions.
- Verify private function EXECUTE is denied to `anon` and `authenticated`, and all PWA/Android paid-session access rules remain unchanged.
- Measure WAL deltas and skipped revisions across 24 hours, not just absolute counters. Never activate V2 section writes until both client outboxes and conflict tests pass.

## Remaining V2 protocol dependency

PWA PR #88 and Android PR #10 contain V2 backend/planner foundations, but are still drafts. This PR does **not** silently activate them, change client backup formats, or turn off full-snapshot recovery. The next step is implementing and testing cross-device section delta replay with stable identities, tombstones, ACKs, conflicts and offline retry, gated for controlled rollout.

### Rollback

- If there is any loss of a required recovery milestone, set `min_checkpoint_seconds=0` (no data deletion).
- The Edge can revert to `admin.from('user_learning_session_archives').upsert(...)`; the previous DB no-op trigger remains intact.
- Do not drop previous preservation or recovery functions, or delete old snapshot rows.
