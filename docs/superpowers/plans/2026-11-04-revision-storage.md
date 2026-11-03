# Revision Storage Implementation Plan

Goal: Reduce unnecessary full-snapshot revisions while preserving every existing record.
Spec: ../specs/2026-11-04-revision-storage-design.md
Execute inline using test-first implementation.

1. Complete and record read-only production audit, backup and permission metadata.
2. Write failing database tests for semantic no-ops, effective merges, tombstones,
   malformed inputs, preserved fields, genuine changes and retained legacy rows.
3. Implement versioned service-only normalization/preparation helpers and trigger/
   comparator replacements; no pruning or record updates in migration.
4. Run synthetic PostgreSQL17 two-session CAS tests and controlled before/after
   autosave benchmarks; add schema-only safety rollback and test it.
5. Review independently. Run DB/backend, PWA saved-data/offline/build and Android
   regression suites. Prepare aggregate cleanup proposal without executing it.
6. Verify backups and live baseline definitions. Apply atomically with write locks,
   record fingerprints and ledger entry; verify unchanged data/permissions and
   before/after aggregate metrics. Publish source after checks and report limits.
