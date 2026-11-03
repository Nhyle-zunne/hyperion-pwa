# Historical revision cleanup proposal — not approved or enabled

No historical deletion is part of the initial optimization. The old automatic
20-point pruning is disabled to honor the instruction to preserve every existing
recovery record. Full meaningful recovery snapshots can therefore grow without a
cap. Monitor revision count, stored payload and total relation bytes daily during
the first week, then weekly. The migration adds no paid service or scheduler.

Start any later cleanup review with semantic duplicate candidates, retaining the
newest equivalent complete snapshot per account. The initial audit found192
such rows /9,186,387 stored payload bytes (about8.76MiB). This estimate is historical;
rerun the accompanying read-only aggregate SQL. Do not promise relation shrinkage:
TOAST/index overhead and reusable pages differ from stored payload bytes.

A simple newest10 rule would select176 rows /14,022,832 payload bytes, but92
semantically distinct older recovery points remain beyond the newest10. A
newest5 rule selects341 rows /24,116,315 bytes. Neither cap is recommended without
reviewing unique recovery value. No age alone establishes that data is disposable.

Before proposing an executable cleanup:

1. Obtain explicit owner approval for an exact reviewed selection and retention
   policy. This document and initial optimization request are not that approval.
2. Export every complete revision plus current progress independently of this
   database, encrypted with access restricted to the owner. Include ownership,
   IDs, timestamps, full payloads, schema and a checksum manifest. A backup from
   before a revision existed cannot protect that revision.
3. Restore the export in an isolated database and verify record counts and every
   fingerprint, ownership, tombstones, answers and recovery behavior. Confirm
   decryption keys and a restoration runbook are available.
4. Review the final candidate set against that verified backup. Keep full distinct
   milestones and current progress. Separately approve any future automatic cap;
   do not delete current progress or completed session archives.
5. If approved, execute a small bounded transactional batch with before/after
   manifests, account-scoped selection and a tested restore. Monitor recovery and
   storage afterward. Ordinary VACUUM supports reuse; VACUUM FULL is not included.

`supabase/proposals/progress_revision_cleanup_review.sql` is read-only. No cleanup
job, DELETE procedure, destructive migration, or scheduled task is installed.
