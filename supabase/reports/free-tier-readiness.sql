-- Hyperion Maritime: Supabase Free readiness (read-only; no rows modified).
-- Run as an administrator in Supabase SQL Editor before downgrading and
-- periodically afterward. These are current logical sizes, not the host's
-- Disk IO % consumed, monthly bandwidth usage, or backup health.
--
-- 2026-11 Free quotas: 500 MiB PostgreSQL database, 1 GiB Storage objects.
-- 75% database utilization is an early-warning threshold; 85% is critical.
WITH database_usage AS (
  SELECT pg_catalog.pg_database_size(pg_catalog.current_database())::numeric AS used_bytes
),
storage_usage AS (
  SELECT COALESCE(SUM(
    CASE WHEN metadata->>'size' ~ '^[0-9]+$'
      THEN (metadata->>'size')::numeric ELSE 0 END
  ),0) AS used_bytes
  FROM storage.objects
),
quota AS (
  SELECT 'database' AS resource, used_bytes, (500*1024*1024)::numeric AS quota_bytes,
         75 AS warn_percent,85 AS critical_percent
  FROM database_usage
  UNION ALL
  SELECT 'storage',used_bytes,(1024*1024*1024)::numeric,75,85
  FROM storage_usage
)
SELECT pg_catalog.now() AS measured_at,resource,
       pg_catalog.round(used_bytes / (1024*1024),1) AS used_mib,
       pg_catalog.round(quota_bytes / (1024*1024),1) AS free_quota_mib,
       pg_catalog.round(100*used_bytes / quota_bytes,1) AS percent_used,
       pg_catalog.round((quota_bytes-used_bytes)/(1024*1024),1) AS remaining_mib,
       CASE WHEN used_bytes >= quota_bytes * critical_percent / 100 THEN 'CRITICAL'
            WHEN used_bytes >= quota_bytes * warn_percent / 100 THEN 'WARNING'
            ELSE 'WITHIN_BUDGET' END AS readiness
FROM quota ORDER BY resource;

-- Focus on the actual sources of database growth; do NOT delete archives,
-- recovery checkpoints, licensed questions or purchase entitlements.
SELECT relname AS table_name,pg_catalog.pg_size_pretty(pg_catalog.pg_total_relation_size(relid)) AS total_size,
       n_live_tup AS approx_rows,n_tup_ins AS inserted_since_stats_reset,
       n_tup_upd AS updated_since_stats_reset,n_tup_del AS deleted_since_stats_reset,
       n_dead_tup AS approx_dead_rows
FROM pg_catalog.pg_stat_user_tables
WHERE schemaname='public'
  AND relname IN ('user_learning_progress_revisions','user_learning_session_archives',
                  'user_learning_progress','google_play_purchase_links',
                  'google_play_entitlements','user_learning_progress_section_operations')
ORDER BY pg_catalog.pg_total_relation_size(relid) DESC;

-- V2 synchronization is currently disabled in both clients. Count its
-- idempotency receipts separately before enabling it; these can accumulate
-- indefinitely if retries are not bounded by a safe conflict/ack protocol.
-- Never truncate receipts while a device might replay an uncertain commit.
SELECT pg_catalog.now() AS measured_at,
       COUNT(*) AS v2_receipts,
       pg_catalog.pg_size_pretty(
         pg_catalog.pg_total_relation_size('public.user_learning_progress_section_operations'::regclass)
       ) AS receipt_table_total,
       MIN(acknowledged_at) AS oldest_receipt,
       MAX(acknowledged_at) AS newest_receipt
FROM public.user_learning_progress_section_operations;

-- Scheduled jobs currently maintained; pg_cron works on Free, but frequent
-- reconciliation may waste database writes. Do not disable license revocation.
SELECT jobname,schedule,active FROM cron.job ORDER BY jobname;

-- Protected restoration policy: the old watermark must never be pruned.
SELECT protected_through_id,max_future_per_account,min_checkpoint_seconds,enabled
FROM public.user_learning_progress_revision_retention;

-- Historical counters for comparing two sampling times (NOT monthly totals).
SELECT stats_reset,blks_read,blks_hit,tup_inserted,tup_updated,tup_deleted,
       temp_files,temp_bytes
FROM pg_catalog.pg_stat_database
WHERE datname=pg_catalog.current_database();

-- Not included in PostgreSQL SQL metrics:
-- * Supabase Billing/Usage: Edge Function invocations, cached/uncached egress,
--   Auth monthly active users and Realtime messages/connections.
-- * Supabase Observability: Disk IO % consumed and response error rate.
-- * Offsite-backup integrity, paused-project risk, and Google Play RTDN health.
