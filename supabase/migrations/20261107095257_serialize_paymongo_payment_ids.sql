begin;
set local lock_timeout = '5s';
-- Schema-only defense in depth: serialize a provider payment across both legacy
-- orders and basket references before checking whether another checkout used it.
do $migration$
declare
  definition text;
  marker text := '  -- A checkout session reference can identify either a basket batch or a legacy';
  payment_lock text := E'  -- One provider payment may fulfill only one checkout reference across both tables.\n  perform pg_advisory_xact_lock(hashtextextended(\'hyperion-paymongo-payment:\' || p_payment_id, 0));\n\n';
begin
  select pg_get_functiondef('public.finalize_paymongo_checkout(uuid,text,text,text,text,bigint,text,text,text)'::regprocedure) into definition;
  if position(payment_lock in definition) > 0 then return; end if;
  if position(marker in definition) = 0 then
    raise exception 'Expected atomic payment finalizer marker was not found; no changes applied.';
  end if;
  execute replace(definition, marker, payment_lock || marker);
end $migration$;
commit;
