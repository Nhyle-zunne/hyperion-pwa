-- Hyperion disk I/O report — READ ONLY, safe on Free and Pro.
-- Run periodically in Supabase SQL Editor or from a privileged diagnostics
-- session. No per-user data, no cron, no additional table writes.
-- Counters are cumulative from stats_reset; compare deltas over a fixed interval.
-- Disk IO % consumed / budget is a HOST metric, not derivable from these rows.

-- 1. Database size and buffer cache. A high cache hit ratio does not rule
-- out WAL/checkpoint pressure from frequent UPDATE / UPSERT operations.
select pg_catalog.now() as observed_at, datname,
       pg_catalog.pg_size_pretty(pg_catalog.pg_database_size(datname)) as database_size,
       stats_reset, xact_commit, xact_rollback, blks_read, blks_hit,
       pg_catalog.round(100.0*blks_hit / pg_catalog.nullif(blks_hit+blks_read,0),2) as cache_hit_percent,
       tup_inserted,tup_updated,tup_deleted,temp_files,temp_bytes,deadlocks
from pg_catalog.pg_stat_database
where datname = pg_catalog.current_database();

-- 2. Where mutable JSONB consumes storage and creates WAL.
select schemaname,relname, n_live_tup,n_dead_tup,
       n_tup_ins, n_tup_upd, n_tup_del,
       pg_catalog.pg_total_relation_size(relid) as total_bytes,
       pg_catalog.pg_total_relation_size(relid)
         - pg_catalog.pg_relation_size(relid)
         - pg_catalog.pg_indexes_size(relid) as approx_toast_bytes,
       last_autovacuum
from pg_catalog.pg_stat_user_tables
where schemaname='public'
  and relname in (
    'user_learning_progress',
    'user_learning_progress_revisions',
    'user_learning_session_archives',
    'google_play_purchase_links',
    'google_play_entitlements'
  ) order by pg_catalog.pg_total_relation_size(relid) desc;

-- 3. Top query patterns by WAL: no user IDs, query parameter values or tokens.
-- pg_stat_statements extension must be installed (standard on Supabase).
select calls,
       pg_catalog.round(total_exec_time::numeric/1000,1) as total_seconds,
       wal_bytes,
       shared_blks_read,
       shared_blks_written,
       pg_catalog.left(pg_catalog.regexp_replace(query,'[[:space:]]+',' ','g'),150) as normalized_statement
from extensions.pg_stat_statements
where query is not null
order by wal_bytes desc limit 15;

-- 4. Verify future recovery window and archived history without inspecting
-- any student's stored payload.
select protected_through_id, max_future_per_account,
       min_checkpoint_seconds, enabled, activated_at
from public.user_learning_progress_revision_retention;

select pg_catalog.count(*) as protected_legacy_revisions
from public.user_learning_progress_revisions
where id <= (select protected_through_id from public.user_learning_progress_revision_retention where singleton);

-- 5. WAL is cumulative since reset, NOT current disk usage.
select wal_bytes, wal_records,wal_fpi,stats_reset
from pg_catalog.pg_stat_wal;
