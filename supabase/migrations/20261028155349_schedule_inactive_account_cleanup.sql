create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'hyperion_supabase_project_url'
  ) then
    perform vault.create_secret(
      'https://evnjoezffghtrzqacwcj.supabase.co',
      'hyperion_supabase_project_url',
      'Project URL for scheduled Hyperion maintenance'
    );
  end if;

  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'hyperion_account_retention_cron_token'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'hyperion_account_retention_cron_token',
      'Private bearer token for scheduled inactive account retention'
    );
  end if;
end;
$$;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job
    where jobname = 'hyperion-expire-inactive-accounts'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  -- Evaluate website account retention every day at 04:00 UTC (12:00 Asia/Manila).
  -- The Edge Function only accepts this private Vault-backed token and rechecks
  -- license/payment/activity state immediately before deleting an eligible account.
  perform cron.schedule(
    'hyperion-expire-inactive-accounts',
    '0 4 * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'hyperion_supabase_project_url')
          || '/functions/v1/expire-inactive-accounts',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-hyperion-account-retention-token',
          (select decrypted_secret from vault.decrypted_secrets where name = 'hyperion_account_retention_cron_token')
        ),
        body := jsonb_build_object('source', 'pg_cron', 'requested_at', now()),
        timeout_milliseconds := 55000
      ) as request_id;
    $job$
  );
end;
$$;
