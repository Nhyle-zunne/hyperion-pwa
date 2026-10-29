-- Periodic Google Play reconciliation is opt-in: setting the Vault flag to "true"
-- enables outbound calls. This migration creates the private token and cron definition,
-- but does not make any HTTP request until an operator enables the flag after E2E tests.
-- Keep the migration readable by plain-Postgres static regression tests: Supabase installs
-- these extensions; other runtimes must provide the same cron/net schemas to apply this file.
DO $extensions$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_available_extensions WHERE name = 'pg_cron') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_available_extensions WHERE name = 'pg_net') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net';
  END IF;
  IF pg_catalog.to_regnamespace('cron') IS NULL OR pg_catalog.to_regnamespace('net') IS NULL THEN
    RAISE EXCEPTION 'Google Play reconciliation requires the existing pg_cron and pg_net schemas.';
  END IF;
END;
$extensions$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'hyperion_supabase_project_url'
  ) THEN
    RAISE EXCEPTION 'The hyperion_supabase_project_url Vault secret must exist before scheduling Google Play reconciliation.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'hyperion_google_play_reconciliation_cron_token'
  ) THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'hyperion_google_play_reconciliation_cron_token',
      'Private token for the scheduled Google Play subscription reconciliation worker'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'hyperion_google_play_reconciliation_enabled'
  ) THEN
    PERFORM vault.create_secret(
      'false',
      'hyperion_google_play_reconciliation_enabled',
      'Set to true only after Google Play linking and reconciliation pass production-readiness tests'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_google_play_reconciliation_cron_token(p_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'vault'
AS $function$
  SELECT p_token IS NOT NULL
    AND EXISTS (
      SELECT 1
        FROM vault.decrypted_secrets
       WHERE name = 'hyperion_google_play_reconciliation_cron_token'
         AND decrypted_secret = p_token
    )
    AND EXISTS (
      SELECT 1
        FROM vault.decrypted_secrets
       WHERE name = 'hyperion_google_play_reconciliation_enabled'
         AND decrypted_secret = 'true'
    );
$function$;

REVOKE ALL ON FUNCTION public.verify_google_play_reconciliation_cron_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_google_play_reconciliation_cron_token(text) TO service_role;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid FROM cron.job
    WHERE jobname = 'hyperion-reconcile-google-play-subscriptions'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  -- Check the opt-in flag in the database before sending an outbound HTTP request.
  -- At installation the flag is false; no request is made until an operator enables it.
  PERFORM cron.schedule(
    'hyperion-reconcile-google-play-subscriptions',
    '*/15 * * * *',
    $job$
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM vault.decrypted_secrets
          WHERE name = 'hyperion_google_play_reconciliation_enabled'
            AND decrypted_secret = 'true'
        )
        THEN net.http_post(
          url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'hyperion_supabase_project_url')
            || '/functions/v1/reconcile-google-play-subscriptions',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-hyperion-google-play-reconcile-token',
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'hyperion_google_play_reconciliation_cron_token')
          ),
          body := jsonb_build_object('source', 'pg_cron', 'requested_at', now()),
          timeout_milliseconds := 55000
        )
        ELSE NULL::bigint
      END AS request_id;
    $job$
  );
END;
$$;
