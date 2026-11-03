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
| No-op elapsed ms |579.13|482.27|
| Retained revision rows after no-ops |20|1|
| Revision relation bytes after no-ops |3,260,416|114,688|
| Meaningful changes / full revisions |20 /20|20 /20|
| Meaningful-change elapsed ms |115.34|121.31|
| Meaningful-change WAL bytes |1,303,656|1,282,344|

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

Production rollout and CI receipts will be recorded after verification.
