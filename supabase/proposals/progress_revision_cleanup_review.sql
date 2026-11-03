-- READ ONLY. This is an estimate, not a cleanup migration or authorization.
-- Run only after 20261104010000. No user IDs or payloads leave the database.
-- Semantic duplicate payload bytes do not equal reclaimable relation-file bytes.
begin read only;
with ranked as (
  select pg_column_size(data) bytes,
    row_number() over (
      partition by user_id, public.canonical_learning_progress(data)
      order by captured_at desc,id desc
    ) duplicate_position
  from public.user_learning_progress_revisions
)
select count(*) filter(where duplicate_position>1) candidate_duplicate_rows,
  coalesce(sum(bytes) filter(where duplicate_position>1),0) candidate_payload_bytes
from ranked;
rollback;
