-- Hyperion Nano/Free observed database trends (read-only).
-- Run in Supabase SQL Editor as an administrator. No customer identifiers,
-- private progress or payment information are included.
-- Daily samples begin when the 2026-11-12 private telemetry migration runs.
--
-- WARNING: WAL bytes != Supabase Disk I/O Budget utilization. Postgres buffer
-- reads != disk IOPS; neither records CPU, swap, egress, Auth MAU or outages.
-- Always inspect the host Disk IO Budget/CPU/memory and Usage charts before
-- changing compute or billing plans.
WITH sample_with_previous AS (
  SELECT s.*,
    pg_catalog.lag(measured_at) over (order by sampled_on) as previous_measured_at,
    pg_catalog.lag(wal_bytes) over (order by sampled_on) as previous_wal_bytes,
    pg_catalog.lag(wal_reset) over (order by sampled_on) as previous_wal_reset,
    pg_catalog.lag(blocks_read) over (order by sampled_on) as previous_blocks_read,
    pg_catalog.lag(rows_updated) over (order by sampled_on) as previous_rows_updated,
    pg_catalog.lag(database_stats_reset) over (order by sampled_on) as previous_db_reset
  FROM hyperion_ops.free_tier_usage_samples s
)
SELECT sampled_on,
  pg_catalog.round(database_bytes::numeric / 1000000, 2) as database_mb,
  pg_catalog.round(100 * database_bytes::numeric / 500000000, 2) as database_pct_of_500mb,
  pg_catalog.round(storage_bytes::numeric / 1000000, 2) as storage_mb,
  CASE WHEN database_bytes >= 425000000 THEN 'CRITICAL - 85%+'
       WHEN database_bytes >= 375000000 THEN 'WARNING - 75%+'
       ELSE 'UNDER 75%' END as database_headroom,
  CASE WHEN wal_reset IS NOT DISTINCT FROM previous_wal_reset
            AND previous_wal_bytes IS NOT NULL AND wal_bytes >= previous_wal_bytes
       THEN pg_catalog.round((wal_bytes - previous_wal_bytes) / 1048576, 2)
       ELSE NULL END as wal_mib_since_previous_sample,
  CASE WHEN database_stats_reset IS NOT DISTINCT FROM previous_db_reset
            AND previous_blocks_read IS NOT NULL AND blocks_read >= previous_blocks_read
       THEN blocks_read - previous_blocks_read
       ELSE NULL END as buffer_blocks_read_since_previous,
  CASE WHEN database_stats_reset IS NOT DISTINCT FROM previous_db_reset
            AND previous_rows_updated IS NOT NULL AND rows_updated >= previous_rows_updated
       THEN rows_updated - previous_rows_updated
       ELSE NULL END as rows_updated_since_previous,
  CASE WHEN previous_measured_at IS NOT NULL
       THEN pg_catalog.round(pg_catalog.date_part('epoch', measured_at - previous_measured_at)::numeric / 3600, 1)
       ELSE NULL END as hours_between_samples
FROM sample_with_previous
ORDER BY sampled_on DESC
LIMIT 45;

-- Confirm scheduler state and last executions without exposing secrets.
SELECT j.jobname,j.schedule,j.active,run.status,
       run.start_time,run.end_time,pg_catalog.left(run.return_message,160) as result
FROM cron.job j
LEFT JOIN LATERAL (
  SELECT status,start_time,end_time,return_message
  FROM cron.job_run_details d WHERE d.jobid = j.jobid
  ORDER BY start_time DESC LIMIT 1
) run ON TRUE
WHERE j.jobname = 'hyperion-free-tier-usage-daily';

-- Avoid interpreting the first daily sample as a trend. Wait for at least
-- two observations, ideally >=7 consecutive days of normal traffic.
SELECT pg_catalog.count(*) as samples_recorded,
       pg_catalog.min(sampled_on) as first_day,
       pg_catalog.max(sampled_on) as most_recent_day
FROM hyperion_ops.free_tier_usage_samples;
