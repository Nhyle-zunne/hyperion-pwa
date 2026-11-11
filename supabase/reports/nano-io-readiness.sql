-- Hyperion Maritime: Nano readiness and disk-I/O profiler (read-only).
-- IMPORTANT: This script does not read Supabase's actual Disk IO Budget,
-- IOPS/throughput, CPU IOWait or memory/swap metrics. Those are available in
-- Supabase Observability -> Database Health / Infrastructure settings.
-- pg_stat_* are cumulative since their stats_reset timestamps, NOT rates.
-- Run and save this output at least twice ~15-60 minutes apart; subtract
-- counters and divide by elapsed seconds to estimate present PostgreSQL load.
-- Do not confuse PostgreSQL WAL bytes/s with physical disk throughput.
--
-- Nano (Free) published minimums (Nov 2026): 250 baseline IOPS, 5 MB/s
-- sustained throughput, up to 0.5 GB RAM, shared CPU. All Nano compute limits
-- must be validated under real workload; the current compute may be larger.

-- 1) Sample database counters at the SAME instant.
select now() as measured_at,
       pg_postmaster_start_time() as instance_started_at,
       pg_size_pretty(pg_database_size(current_database())) as database_size,
       pg_database_size(current_database()) as database_bytes,
       w.stats_reset as wal_stats_reset,
       w.wal_bytes as wal_bytes_since_reset,
       w.wal_records as wal_records_since_reset,
       d.stats_reset as database_stats_reset,
       d.blks_read as relation_blocks_read_since_reset,
       d.blks_hit as relation_blocks_hit_since_reset,
       round(100.0*d.blks_hit::numeric/greatest(d.blks_read+d.blks_hit,1),2) as cache_hit_percent,
       d.tup_inserted as tuples_inserted_since_reset,
       d.tup_updated as tuples_updated_since_reset,
       d.temp_bytes as temp_bytes_since_reset
from pg_stat_wal w
cross join pg_stat_database d
where d.datname=current_database();

-- 2) Observe which writes and dead tuples may impose pressure on Nano.
select relname as table_name,
       pg_total_relation_size(relid) as bytes,
       pg_size_pretty(pg_total_relation_size(relid)) as size,
       n_tup_ins as cumulative_inserts,
       n_tup_upd as cumulative_updates,
       n_tup_del as cumulative_deletes,
       n_dead_tup as estimated_dead_rows,
       last_autovacuum,
       last_autoanalyze
from pg_stat_user_tables
where schemaname='public'
  and relname in (
    'user_learning_progress',
    'user_learning_progress_revisions',
    'user_learning_session_archives',
    'user_learning_progress_section_operations',
    'google_play_purchase_links',
    'google_play_entitlements'
  )
order by pg_total_relation_size(relid) desc;

-- 3) Identify top cumulative query sources of WAL.
--    DO NOT assume this list reflects only today's traffic.
select calls, round(total_exec_time::numeric,1) as cumulative_exec_ms,
       wal_bytes::bigint as wal_bytes_since_stats_reset,
       temp_blks_written as temp_blocks_written,
       left(regexp_replace(query,'[[:space:]]+',' ','g'),220) as statement_prefix
from pg_stat_statements
where calls >= 10
order by wal_bytes desc
limit 15;

-- 4) Number of occupied connections and replication slots vs Nano max.
select count(*) as connections_in_use,
       count(*) filter (where state='active') as active_connections,
       current_setting('max_connections')::int as configured_max_connections
from pg_stat_activity;
select count(*) as replication_slots_in_use from pg_replication_slots;

-- 5) Check recovery/backup policy without touching customer data.
select (select count(*) from public.user_learning_progress_revisions) as protected_and_rolling_revisions,
       (select count(*) from public.user_learning_session_archives) as archived_sessions,
       (select count(*) from public.user_learning_progress_section_operations) as v2_operation_receipts,
       (select protected_through_id from public.user_learning_progress_revision_retention) as protected_revision_watermark,
       (select max_future_per_account from public.user_learning_progress_revision_retention) as rolling_revisions_per_account;
