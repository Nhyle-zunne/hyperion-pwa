# Progress revision optimization verification

Audit: [baseline and decisions](progress-revision-audit-2026-11-04.md).
Cleanup: [separate unapproved proposal](progress-revision-cleanup-proposal.md).

## Implemented scope

Migration `20261104010000_optimize_progress_revision_storage.sql` adds
`progress_json_or_null`, `canonical_learning_progress`,
`merge_learning_progress_deletions`, `prepare_learning_progress`; replaces
`preserve_learning_progress` and `compare_user_learning_progress`. No existing
record is rewritten or deleted. No Edge Function or client update is required.
Full snapshots, existing collection-recovery RPC and immutable session archives
remain. Service-only access, empty search_path, RLS, expected-version checks and
updated_at behavior remain. Malformed members/sessions fail without saving;
omitted fields and existing tombstones survive older/partial payloads.

Valid explicit arrays retain existing replacement/deletion semantics. They cannot
be distinguished from every possible buggy client clear without a new client
intent protocol. This change does not claim to solve that ambiguity; a meaningful
replacement keeps the complete OLD snapshot. It does not resurrect deleted history
by automatically merging every old history row.

## Synthetic PostgreSQL17.11 comparison

Identical synthetic202,379-byte logical snapshots;100 formatting-only autosaves,
then20 actual counter changes. Single local run; no real user records used.

| Measurement | Previous definitions | New definitions |
|---|---:|---:|
| No-op current-row writes |100|0|
| No-op revision inserts |100|0|
| No-op WAL bytes |6,500,856|56|
| No-op elapsed ms |556.56|558.84|
| Retained revision rows after no-ops |20|1|
| Revision relation bytes after no-ops |3,260,416|114,688|
| Meaningful changes / full revisions |20 /20|20 /20|
| Meaningful-change elapsed ms |105.65|132.83|
| Meaningful-change WAL bytes |1,303,656|1,282,320|

Elapsed time/WAL vary by run. The new preparation/comparison has CPU cost; genuine
updates were slightly slower in this run. These synthetic sizes and timing are
not production savings, egress measurements, or a future growth prediction. The
old cap deletes snapshots, so retained-row comparisons also reflect retention.

Future payload growth is approximately the sum of stored OLD snapshot sizes for
meaningful updates; no-ops contribute zero new revisions. At the observed average
~57.6KB per payload,1,000 meaningful updates would add roughly57.6MB of payload
before relation/index overhead. This is an illustrative conditional estimate, not
an observed daily rate. With pruning disabled, meaningfully different snapshots
can grow without limit until a separately approved retention policy exists.

## Verification

- New synthetic PGlite suite: semantic no-ops, timestamps/stale conflicts, partial
  older payloads, answer/mistake changes, tombstones/ties/restores, expiry-null
  protection including legacy clocks, malformed members/root/session, account
  ownership and permissions, recovery and repeated recovery, >20-point retention,
  definition-only rollback/reapply. Pass.
- Real PostgreSQL17: two simultaneous connections, one CAS winner, stale writer
  rejected, offline retry preserves both writers; same meaningful-revision count.
  Guard rejects an injected record UPDATE and rolls it back. Safety rollback and
  reapply preserve all current/revision fingerprints. Pass.
- Existing saved-data SQL and full browser suites, sync browser fixture, backend
 7tests, production build, security and offline checks. Pass.
- Android CI for unchanged03e14d7: successful
  [run41697979169](https://github.com/Nhyle-zunne/hyperion-reviewer/actions/runs/41697979169).
- Independent review found malformed-member and legacy-clock gaps; both corrected
  and covered by regression tests before deployment.

## Deployment and rollback

Deployment tool defaults to read-only audit. Explicit apply checks audited live
function hashes and completed backup availability, locks both progress tables,
hashes every complete current/revision record inside the transaction, applies
only definitions and a migration ledger row, and aborts on any record difference.
Afterward it verifies function bodies, permissions, unchanged unrelated recovery
functions and table RLS. It exports only aggregate metadata.

Safety rollback file restores previous duplicate-write behavior while retaining
new preservation safeguards and no automatic pruning. Apply it through the same
`guardedProgressRevisionSql` transaction helper. It is intentionally not the old
pruning definition, and it does not restore previously deleted historical data.
Full-data fingerprints were verified across rollback/reapply in synthetic PG17.
Do not run the old historical migration as rollback: it contains pruning/data SQL.

## Production receipt

Applied and verified migration20261104010000 with a completed daily backup from
2026-11-03T19:18:45.032Z available. PITR was not enabled or required. Transaction
receipt: unchanged current records=138 and revisions=662. Full row fingerprints
matched inside the locked transaction, including IDs, ownership and timestamps.
No synthetic or real user-record writes were performed by rollout/testing.

| Production metric | Immediately before | Immediately after |
|---|---:|---:|
| Database bytes |83,269,299|83,318,451|
| Revision relation bytes |45,293,568|45,293,568|
| Revision rows / owners |662 /134|662 /134|
| Stored revision payload bytes |38,138,837|38,138,837|
| Mean stored revision payload bytes |57,612|57,612|
| Current progress records |138|138|

The49,152-byte database increase is catalog/DDL/ledger overhead, not a user-payload
rewrite. Historical storage has not been reclaimed. No cleanup or VACUUM was run.
All three protected tables retain RLS and no anon/authenticated read/write grants.
All six deployed function bodies/ACLs match the migration; unrelated recovery,
merge, updated_at and completed-audit definitions retain their audited hashes.

Predeployment CI passed on30ff985:
[PWA and PostgreSQL16](https://github.com/Nhyle-zunne/hyperion-pwa/actions/runs/41703919472),
[full Supabase replay/lint](https://github.com/Nhyle-zunne/hyperion-pwa/actions/runs/41703919495).
Local PostgreSQL17.11, PGlite, backend and browser results are described above.
Source integration: [PR36](https://github.com/Nhyle-zunne/hyperion-pwa/pull/36).


## Live no-op compatibility follow-up

A non-mutating service-role check after the first rollout found102 snapshots
already returned unchanged;36 were classified changed because preparation would
reorder pre-existing vault arrays or introduce absent empty collections. No test
writes were performed. Versioned follow-up20261104020000 adds a canonical equality
shortcut before preparation, after ownership/version checks. This preserves raw
legacy ordering and omissions on actual no-ops. New regression fixtures cover
unsorted first-inserted lists, absent collections, history restore/permanent clear,
saved-session discard and unknown wrapper metadata. Independent review found no
remaining deployment blocker. Both synthetic DB suites pass with the follow-up.
