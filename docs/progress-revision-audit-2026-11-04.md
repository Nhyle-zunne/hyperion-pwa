# Progress revision storage audit — before implementation

## Production observations

Read-only aggregate queries: PostgreSQL 17.11; database 83,211,955 bytes
(79.36 MiB); revision relation 45,260,800 bytes (43.16 MiB), including 163,840
heap bytes and 98,304 index bytes. TOAST and its index account for most of the
remaining size. 661 rows cover 134 accounts;137 accounts have current progress.
All current records have version 1 and object-shaped storage. Revision payloads
use PostgreSQL pglz compression; mean stored payload 57,648 bytes, mean logical
JSON 243,884 bytes, maximum stored payload 424,789 bytes.

81 owners have one revision and 11 have 20. Retained timestamps span November 2
23:20:36 UTC to November 3 18:32:43 UTC. Pruning already occurred, so retained
rows per hour are not a reliable historical insertion/growth rate.

25 rows duplicate identical full content (1,133,343 stored payload bytes).
178 duplicate another snapshot for the same account after excluding root savedAt
and changedSections (8,844,321 bytes). Normalizing recognized JSON-encoded storage
sections identifies 192 redundant rows (29.0%;9,186,387 payload bytes). Array
ordering and all actual values remain significant. These are candidate duplicate
payload bytes, not guaranteed physical disk reclamation or prospective savings.

## Root causes and consumers

The preserve_learning_progress BEFORE UPDATE trigger inserts OLD.data on every
update, even unchanged data or timestamp-only autosaves. It then merges bookmarks
and mistakes and prunes to 20 per owner. It performs no semantic-change check.
The updated_at trigger runs afterward; it supplies optimistic concurrency tokens.

The Edge write handler calls compare_user_learning_progress before sanitizing and
writing. That comparator excludes savedAt/changedSections but compares serialized
storage JSON strings literally, so whitespace/key-order differences can trigger
unnecessary writes. Server preservation canonicalizes those strings, while PWA
JSON.stringify and Android JSONObject serialize them differently. Native no-op
checks can therefore miss equivalent snapshots. No client API change is needed.

Recovery uses full historical JSON only for bookmark/mistake collection merging;
full revisions nevertheless preserve session/history/answer and other fields for
administrative recovery. Automatic recovery must not be broadened blindly: older
history entries may represent intentional deletions. The separate session archive
has an immutable-completed-audit trigger. License expiry permits owner backups but
still restricts reading paid questions; this work will not change that policy.

The current trigger preserves only bookmark/mistake omissions; omitted other
storage fields can disappear. Incoming deletion ledgers can also omit earlier
tombstones. The initial change will preserve omitted fields and merge tombstones
by timestamp, while retaining explicit restore markers and deletion tie priority.

## Security and backup status

Current progress, revision and session-archive tables have RLS enabled, no client
policies or client read/write grants, and service-role access only. Security
Definer routines have an empty search_path and restricted EXECUTE permissions.
Those restrictions must remain.

Supabase reports completed physical daily backups; latest observed backup is
November 2 19:18:30 UTC, PITR disabled. That backup predates creation of these
revision records and does not justify deleting current recovery points. No
historical cleanup is authorized or planned during this stage. Migration and
rollback must be schema-only, without modifying/deleting user or revision rows.

## Initial decision and limits

Use full snapshots with semantic equality, never deltas or lossy compression.
Recognized serialized JSON objects are normalized only for comparison, not by
rewriting stored history. Keep both existing client formats and existing APIs.
Preserve omitted root/storage fields and existing tombstones before comparing.
Only genuine effective changes produce a full OLD.data revision. Do not change
the updated_at trigger or optimistic version conflict rules.

Disable the existing automatic DELETE/pruning clause for this initial rollout,
which strictly preserves every historical revision as requested. Do not enable
5/10-point or age-based cleanup. Meaningful revision growth is temporarily
unbounded; monitor it and approve a separately backed-up retention policy later.
This tradeoff prioritizes the explicit no-deletion instruction over a storage cap.
No current/historical row rewrites, migrations to compressed/delta formats, paid
features, extensions or additional subscriptions are needed.

## Historical cleanup evaluation (not executable authorization)

Simply keeping the newest 10 points would select 176 rows/14,022,832 payload bytes;
keeping 5 selects 341 rows/24,116,315 bytes. Even after deduplication,92 distinct
points lie beyond the newest 10 per owner (8,808,994 bytes). Deleting those based
only on age/count could lose unique recoverable information. Do not do so.

A future proposal may start with verified semantic duplicates, retaining recent
and milestone full snapshots and an independent complete backup with a tested
restore. Any cleanup requires explicit owner approval. Ordinary VACUUM permits
space reuse and does not guarantee a smaller relation file; no VACUUM FULL or
irreversible cleanup is included here.

## Compatibility decisions after review

An absent or malformed snapshot/section is not an instruction to erase saved data.
The new preparation validates structured members and retains omitted properties.
Valid explicit arrays continue to mean replacement, as in existing clients:
history's soft-delete, restore, permanent-delete, discard and expiry workflows do
not have a shared persistent deletion ledger. Automatically unioning every history
array would resurrect intentional deletions. Each meaningful replacement retains
its complete prior snapshot. This is not a new history recovery protocol.

Legacy active sessions with zero/missing change clock are protected against a null
replacement with no newer clock. A newer explicit clear marker still succeeds.
Bookmarks/mistakes continue using their established per-ID tombstone ledger.

Predeployment refresh:138 current records,662 revisions,45,293,568 relation bytes,
38,138,837 payload bytes,83,269,299 database bytes. A newer completed daily backup
is available at2026-11-03T19:18:45.032Z; PITR remains disabled. Aggregate member-shape
checks and deployment transaction checks do not export user payloads.
