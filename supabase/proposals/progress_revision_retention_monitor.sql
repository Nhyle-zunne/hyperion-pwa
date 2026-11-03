-- Read-only operational monitor for recovery snapshots. No personal data returned.
select
  p.protected_through_id,
  p.max_future_per_account,
  p.enabled as future_pruning_enabled,
  count(*) filter (where r.id <= p.protected_through_id) as protected_historical_rows,
  count(*) filter (where r.id > p.protected_through_id) as newer_rows,
  count(distinct r.user_id) filter (where r.id > p.protected_through_id) as newer_accounts,
  coalesce(sum(pg_column_size(r.data)) filter (where r.id > p.protected_through_id),0) as newer_payload_bytes,
  pg_total_relation_size('public.user_learning_progress_revisions') as total_relation_bytes
from public.user_learning_progress_revision_retention p
left join public.user_learning_progress_revisions r on true
where p.singleton = true
group by p.protected_through_id,p.max_future_per_account,p.enabled;
