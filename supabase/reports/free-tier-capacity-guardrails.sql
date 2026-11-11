-- Hyperion Free-tier capacity watch: read-only, no customer rows or secrets.
-- Project-specific Free database allowance at the time of this report:
-- 500 MiB (524,288,000 bytes). Confirm current plan limits in Dashboard.
-- Run after deploying optimizations and compare against a prior saved sample.
-- This is DATABASE SIZE, not full disk usage (WAL/system logs) or physical IOPS.
WITH size_budget AS (
  SELECT pg_database_size(current_database())::numeric AS used_bytes,
         (500 * 1024 * 1024)::numeric AS free_database_budget_bytes
)
SELECT now() AS measured_at,
       current_database() AS database_name,
       used_bytes::bigint AS database_bytes,
       pg_size_pretty(used_bytes::bigint) AS database_size,
       free_database_budget_bytes::bigint AS budget_bytes,
       pg_size_pretty(greatest(free_database_budget_bytes-used_bytes,0)::bigint) AS headroom,
       round(100.0 * used_bytes / free_database_budget_bytes,2) AS budget_used_percent,
       CASE WHEN used_bytes >= free_database_budget_bytes THEN 'CRITICAL: over Free budget; do not downgrade'
            WHEN used_bytes >= free_database_budget_bytes * 0.90 THEN 'CRITICAL: less than 10% headroom'
            WHEN used_bytes >= free_database_budget_bytes * 0.80 THEN 'WARNING: less than 20% headroom'
            ELSE 'BELOW 80%: monitor growth and peak workload'
       END AS capacity_readiness
FROM size_budget;

-- Identify growing or write-heavy objects without scanning customer contents.
-- Cumulative DML counters are NOT today's activity; compare two snapshots.
SELECT schemaname, relname,
       pg_total_relation_size(relid)::bigint AS total_bytes,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
       n_tup_ins AS inserts_since_stats_reset,
       n_tup_upd AS updates_since_stats_reset,
       n_tup_del AS deletes_since_stats_reset,
       n_dead_tup AS estimated_dead_rows,
       last_autovacuum
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 15;

-- Compare against a prior capture; 500 MiB budget applies to the database,
-- not all platform billable storage, bandwith, or Disk IO Budget balance.
-- An alert/green status here does NOT prove Nano is safe. Check the Dashboard
-- for 7-day minimum Disk IO Budget, IOWait, memory/swap, and outage history.
