# Safe progress revision storage optimization

Spec: user's pasted safe optimization request; audit findings are documented in
`docs/progress-revision-audit-2026-11-04.md` before implementation.

Keep full JSONB snapshots. Canonical comparison ignores only the already-ignored
root savedAt/changedSections and normalizes known JSON-encoded storage objects;
all values and array order remain significant. Use one pure effective-snapshot
helper for comparator and trigger. It preserves omitted root/storage/state fields,
merges deletion ledgers by newest timestamp with deletion winning ties, and applies
the existing bookmark/mistake preservation rules. Reject malformed/incomplete
incoming root snapshots and structured sections, without touching current data.
Allow existing explicit nullable draft/plan/session operations and valid history
arrays/tombstone changes; do not invent a new deletion protocol.

Keep the optimistic version check before content comparison and leave the
updated_at trigger unchanged. Only a genuine effective data change inserts a full
OLD.data revision. Disable automatic pruning in this initial phase: no historical
or future recovery rows are deleted by this optimization. Meaningful growth is
therefore uncapped until a separate independently backed-up cleanup is approved.
Do not broaden automatic collection recovery to old histories (could resurrect
intentional deletions). Existing full snapshots and all client/API contracts remain.

Add service-only helpers with empty search_path and no paid features/extensions.
Versioned migration and safety rollback change definitions only. Deployment locks
progress/revision writes briefly, hashes all current and historical records before
and after the DDL, aborts on any difference, and records the migration atomically.
Verify backup metadata, permissions, definitions, raw sizes/counts and old clients.
No synthetic test rows, repairs, compression rewrites or cleanup in production.

Test synthetic PG17 scenarios with old/new formats, invalid inputs, omissions,
tombstones, genuine session/answer/history/study changes, no-op autosaves and
20-point boundaries; use two real PostgreSQL sessions for concurrent compare-and-
swap conflicts. Benchmark separate old/new synthetic databases and disclose scope.
Keep historical cleanup as a read-only proposal requiring explicit approval.
