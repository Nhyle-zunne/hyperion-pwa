\set ON_ERROR_STOP on
begin;

DO $checks$
DECLARE
  v_today date := (pg_catalog.now() at time zone 'UTC')::date;
  v_count bigint;
  v_before bigint;
  v_after bigint;
BEGIN
  IF pg_catalog.has_schema_privilege('anon','hyperion_ops','USAGE') OR
     pg_catalog.has_schema_privilege('authenticated','hyperion_ops','USAGE') OR
     pg_catalog.has_schema_privilege('service_role','hyperion_ops','USAGE') THEN
    RAISE EXCEPTION 'Private operations telemetry schema is exposed to client or Edge roles';
  END IF;

  IF pg_catalog.has_table_privilege('anon','hyperion_ops.free_tier_usage_samples','SELECT') OR
     pg_catalog.has_table_privilege('authenticated','hyperion_ops.free_tier_usage_samples','SELECT') OR
     pg_catalog.has_table_privilege('service_role','hyperion_ops.free_tier_usage_samples','SELECT') THEN
    RAISE EXCEPTION 'Aggregate telemetry table permits untrusted reads';
  END IF;

  IF pg_catalog.has_function_privilege('anon','hyperion_ops.capture_free_tier_usage_sample()','EXECUTE') OR
     pg_catalog.has_function_privilege('authenticated','hyperion_ops.capture_free_tier_usage_sample()','EXECUTE') OR
     pg_catalog.has_function_privilege('service_role','hyperion_ops.capture_free_tier_usage_sample()','EXECUTE') THEN
    RAISE EXCEPTION 'Daily capture function is callable by API or Edge clients';
  END IF;

  SELECT pg_catalog.count(*) INTO v_count
  FROM cron.job
  WHERE jobname = 'hyperion-free-tier-usage-daily'
    AND schedule = '10 0 * * *'
    AND command = 'select hyperion_ops.capture_free_tier_usage_sample();'
    AND active;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Private daily Supabase cron is missing, duplicated or misconfigured';
  END IF;

  SELECT pg_catalog.count(*) INTO v_before
  FROM hyperion_ops.free_tier_usage_samples
  WHERE sampled_on = v_today;
  IF v_before <> 1 THEN
    RAISE EXCEPTION 'Initial capture sample is missing';
  END IF;

  PERFORM hyperion_ops.capture_free_tier_usage_sample();

  SELECT pg_catalog.count(*) INTO v_after
  FROM hyperion_ops.free_tier_usage_samples
  WHERE sampled_on = v_today;
  IF v_after <> 1 THEN
    RAISE EXCEPTION 'Repeated capture created duplicate rows';
  END IF;

  -- Synthetic old-only telemetry is eligible for deletion. Customer/recovery
  -- tables are deliberately never included in this test or its retention job.
  INSERT INTO hyperion_ops.free_tier_usage_samples
  SELECT v_today - 90, measured_at - interval '90 days',
         database_bytes,storage_bytes,wal_bytes,wal_reset,database_stats_reset,
         blocks_read,blocks_hit,temp_bytes,rows_inserted,rows_updated,rows_deleted
  FROM hyperion_ops.free_tier_usage_samples WHERE sampled_on = v_today;
  PERFORM hyperion_ops.capture_free_tier_usage_sample();

  IF EXISTS (SELECT 1 FROM hyperion_ops.free_tier_usage_samples WHERE sampled_on = v_today - 90) THEN
    RAISE EXCEPTION 'Telemetry-only retention did not prune old synthetic sample';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hyperion_ops.free_tier_usage_samples WHERE sampled_on = v_today) THEN
    RAISE EXCEPTION 'Recent readiness sample was removed unexpectedly';
  END IF;
END
$checks$;

rollback;
