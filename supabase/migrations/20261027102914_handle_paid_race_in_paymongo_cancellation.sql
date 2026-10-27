CREATE OR REPLACE FUNCTION public.cancel_paymongo_checkout(p_checkout_reference uuid, p_checkout_session_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
declare
  v_batch public.checkout_batches%rowtype;
  v_order public.orders%rowtype;
  v_updated_id uuid;
begin
  if p_checkout_reference is null or nullif(trim(p_checkout_session_id), '') is null then
    raise exception 'Invalid checkout cancellation request' using errcode = '22023';
  end if;

  select * into v_batch
    from public.checkout_batches
   where id = p_checkout_reference
   for update;

  if found then
    if v_batch.paymongo_checkout_session_id is distinct from p_checkout_session_id then
      raise exception 'Checkout session does not match basket reference' using errcode = '23514';
    end if;
    if v_batch.status = 'paid' then
      return jsonb_build_object('status', 'already_paid', 'orderId', v_batch.id);
    end if;
    if v_batch.status not in ('pending', 'failed', 'cancelled') then
      raise exception 'Basket checkout cannot be cancelled in its current status' using errcode = '23514';
    end if;

    update public.checkout_batches
       set status = 'cancelled'
     where id = v_batch.id and status in ('pending', 'failed', 'cancelled');

    update public.orders
       set status = 'cancelled'
     where checkout_batch_id = v_batch.id
       and user_id = v_batch.user_id
       and status in ('pending', 'failed');

    return jsonb_build_object('status', 'cancelled', 'orderId', v_batch.id);
  end if;

  select * into v_order
    from public.orders
   where id = p_checkout_reference
   for update;

  if not found then
    raise exception 'Checkout order not found' using errcode = 'P0002';
  end if;

  if v_order.paymongo_checkout_session_id is distinct from p_checkout_session_id then
    raise exception 'Checkout session does not match tracked order' using errcode = '23514';
  end if;

  -- If a verified webhook completed while the customer was cancelling,
  -- preserve the paid result instead of reporting a false cancellation failure.
  if v_order.status = 'paid' then
    return jsonb_build_object('status', 'already_paid', 'orderId', v_order.id);
  end if;

  if v_order.payment_method is distinct from 'PayMongo Checkout' then
    raise exception 'Checkout session does not match tracked order' using errcode = '23514';
  end if;
  if v_order.status not in ('pending', 'failed', 'cancelled') then
    raise exception 'Checkout order cannot be cancelled in its current status' using errcode = '23514';
  end if;

  update public.orders
     set status = 'cancelled'
   where id = v_order.id
     and status in ('pending', 'failed', 'cancelled')
   returning id into v_updated_id;

  if v_updated_id is null then
    raise exception 'Checkout order changed during cancellation' using errcode = '40001';
  end if;

  return jsonb_build_object('status', 'cancelled', 'orderId', v_order.id);
end;
$function$;

revoke all on function public.cancel_paymongo_checkout(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_paymongo_checkout(uuid, text) to service_role;
