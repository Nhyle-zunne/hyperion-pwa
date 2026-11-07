begin;
set local lock_timeout = '5s';
-- Restore only the previous function definition. Never change payment records.
do $rollback$
declare
  definition text;
  payment_lock text := E'  -- One provider payment may fulfill only one checkout reference across both tables.\n  perform pg_advisory_xact_lock(hashtextextended(\'hyperion-paymongo-payment:\' || p_payment_id, 0));\n\n';
begin
  select pg_get_functiondef('public.finalize_paymongo_checkout(uuid,text,text,text,text,bigint,text,text,text)'::regprocedure) into definition;
  if position(payment_lock in definition) = 0 then
    raise exception 'Expected payment-ID guard was not found; no changes applied.';
  end if;
  execute replace(definition, payment_lock, '');
end $rollback$;
commit;
