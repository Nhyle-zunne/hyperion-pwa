-- Abandoned PayMongo checkouts are only eligible for cleanup after 12 hours.
-- A 30-minute sweep keeps status updates timely while avoiding 288 scheduled
-- Edge Function invocations per day for a task that does not need five-minute precision.
do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job
     where jobname = 'hyperion-expire-abandoned-paymongo-checkouts'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'hyperion-expire-abandoned-paymongo-checkouts',
    '*/30 * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'hyperion_supabase_project_url')
          || '/functions/v1/expire-abandoned-checkouts',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-hyperion-cron-token',
          (select decrypted_secret from vault.decrypted_secrets where name = 'hyperion_abandoned_checkout_cron_token')
        ),
        body := jsonb_build_object('source', 'pg_cron', 'requested_at', now()),
        timeout_milliseconds := 5000
      ) as request_id;
    $job$
  );
end;
$$;
