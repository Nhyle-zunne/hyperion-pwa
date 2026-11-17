begin;
set local lock_timeout = '5s';

-- Change only the existing, service-only PayMongo abandonment RPC. Keep its
-- row locking, provider session binding, payment-race checks and grants intact.
do $migration$
declare
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'public.mark_abandoned_paymongo_checkout_failed(uuid,text,boolean)'::regprocedure
  ) into definition;

  if definition is null
     or (length(definition) - length(replace(definition, 'interval ''12 hours''', ''))) / length('interval ''12 hours''') <> 4
     or (length(definition) - length(replace(definition, 'set status = ''failed''', ''))) / length('set status = ''failed''') <> 3
     or (length(definition) - length(replace(definition, 'jsonb_build_object(''status'', ''failed''', ''))) / length('jsonb_build_object(''status'', ''failed''') <> 2 then
    raise exception 'Abandoned-checkout RPC differs from the reviewed 12-hour implementation; no changes applied';
  end if;

  updated_definition := replace(definition, 'interval ''12 hours''', 'interval ''30 minutes''');
  updated_definition := replace(updated_definition, 'set status = ''failed''', 'set status = ''cancelled''');
  updated_definition := replace(updated_definition,
    'jsonb_build_object(''status'', ''failed''', 'jsonb_build_object(''status'', ''cancelled''');
  execute updated_definition;
end
$migration$;

-- Preserve the existing private HTTP command, vault credentials and 55-second
-- network timeout. Five-minute sweeps finish within five minutes of the cutoff.
do $migration$
declare
  existing_job bigint;
  existing_schedule text;
begin
  select jobid,schedule into existing_job,existing_schedule
    from cron.job
   where jobname = 'hyperion-expire-abandoned-paymongo-checkouts';

  if existing_job is null or existing_schedule not in ('*/30 * * * *', '*/5 * * * *') then
    raise exception 'Unexpected abandoned-checkout scheduled job; no changes applied';
  end if;
  perform cron.alter_job(job_id => existing_job, schedule => '*/5 * * * *');
end
$migration$;
commit;
