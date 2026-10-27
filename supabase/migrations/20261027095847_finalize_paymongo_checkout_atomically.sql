create table if not exists public.paymongo_reconciliation_alerts (
  id uuid primary key default gen_random_uuid(),
  checkout_reference uuid not null,
  checkout_session_id text not null,
  paymongo_payment_id text not null unique,
  expected_amount_php integer not null,
  observed_amount_minor bigint not null,
  observed_currency text not null,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.paymongo_reconciliation_alerts enable row level security;
revoke all on table public.paymongo_reconciliation_alerts from anon, authenticated;
grant all on table public.paymongo_reconciliation_alerts to service_role;

CREATE OR REPLACE FUNCTION public.finalize_paymongo_checkout(p_checkout_reference uuid, p_checkout_session_id text, p_payment_id text, p_payment_method text, p_currency text, p_amount_minor bigint, p_customer_name text DEFAULT NULL::text, p_customer_company text DEFAULT NULL::text, p_customer_school text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
declare
  v_batch public.checkout_batches%rowtype;
  v_order public.orders%rowtype;
  v_entitlement public.entitlements%rowtype;
  v_is_batch boolean := false;
  v_child_count integer := 0;
  v_child_total integer := 0;
  v_child_codes text[] := array[]::text[];
  v_expected_codes text[];
  v_index integer;
  v_expected_price integer;
  v_expected_track text;
  v_now timestamptz;
  v_base timestamptz;
  v_expires_at timestamptz;
  v_expires_by_product jsonb := '{}'::jsonb;
  v_code text;
  v_paid_payment_exists boolean := false;
  v_existing_payment_reference uuid;
begin
  if p_checkout_reference is null
     or nullif(trim(p_checkout_session_id), '') is null
     or nullif(trim(p_payment_id), '') is null
     or p_currency is distinct from 'PHP'
     or p_amount_minor is null or p_amount_minor <= 0
     or p_payment_method is null
     or left(p_payment_method, 11) <> 'PayMongo · '
     or length(p_payment_method) > 100 then
    raise exception 'Invalid verified PayMongo payment details' using errcode = '22023';
  end if;

  -- A checkout session reference can identify either a basket batch or a legacy
  -- single order. Row locks serialize webhook delivery and customer-side verification.
  select * into v_batch
    from public.checkout_batches
   where id = p_checkout_reference
   for update;

  if found then
    v_is_batch := true;

    if v_batch.paymongo_checkout_session_id is distinct from p_checkout_session_id then
      raise exception 'Checkout session does not match basket reference' using errcode = '23514';
    end if;

    if p_amount_minor <> v_batch.amount_php::bigint * 100 then
      raise exception 'Payment amount does not match basket total' using errcode = '23514';
    end if;

    if v_batch.status = 'paid' then
      if v_batch.paymongo_payment_id = p_payment_id then
        return jsonb_build_object(
          'status', 'paid', 'duplicate', true, 'orderId', v_batch.id,
          'productCodes', to_jsonb(v_batch.product_codes), 'totalPhp', v_batch.amount_php
        );
      end if;

      insert into public.paymongo_reconciliation_alerts (
        checkout_reference, checkout_session_id, paymongo_payment_id,
        expected_amount_php, observed_amount_minor, observed_currency, reason
      ) values (
        v_batch.id, p_checkout_session_id, p_payment_id,
        v_batch.amount_php, p_amount_minor, p_currency,
        'A distinct paid payment was reported for a basket that is already paid; no additional license term was granted.'
      ) on conflict (paymongo_payment_id) do nothing;

      return jsonb_build_object(
        'status', 'paid', 'duplicatePayment', true, 'orderId', v_batch.id,
        'productCodes', to_jsonb(v_batch.product_codes), 'totalPhp', v_batch.amount_php
      );
    end if;

    if v_batch.status not in ('pending', 'failed', 'cancelled') then
      raise exception 'Basket is not eligible for payment finalization' using errcode = '23514';
    end if;

    if v_batch.product_codes is null or cardinality(v_batch.product_codes) < 1
       or cardinality(v_batch.product_codes) > 5
       or v_batch.license_terms is null
       or cardinality(v_batch.product_codes) <> cardinality(v_batch.license_terms) then
      raise exception 'Basket has invalid product or term arrays' using errcode = '23514';
    end if;

    if (select count(distinct x) from unnest(v_batch.product_codes) as x)
       <> cardinality(v_batch.product_codes) then
      raise exception 'Basket contains duplicate products' using errcode = '23514';
    end if;

    -- Acquire per-user/per-track transaction locks in stable order so concurrent
    -- payments for the same track serialize rather than overwrite each other's expiry.
    for v_code in
      select x from unnest(v_batch.product_codes) as x order by x
    loop
      perform pg_advisory_xact_lock(hashtext(v_batch.user_id::text), hashtext(v_code));
    end loop;

    -- Validate every child order against the server-stored batch and canonical price table.
    for v_order in
      select o.* from public.orders o
       where o.checkout_batch_id = v_batch.id and o.user_id = v_batch.user_id
       order by o.product_code
       for update
    loop
      v_child_count := v_child_count + 1;
      v_child_total := v_child_total + v_order.amount_php;
      v_child_codes := array_append(v_child_codes, v_order.product_code);
      v_index := array_position(v_batch.product_codes, v_order.product_code);

      v_expected_track := case v_order.product_code
        when 'oic_nw' then 'DECK_OIC_NW'
        when 'gmdss' then 'GMDSS_GOC'
        when 'engine_ew' then 'ENGINE_OIC_EW'
        when 'deck_mgt' then 'DECK_MGT'
        when 'engine_mgt' then 'ENGINE_MGT'
        else null end;

      v_expected_price := case v_order.product_code
        when 'oic_nw' then case v_order.license_term when 'week' then 20 when 'month' then 50 when 'year' then 350 else null end
        when 'gmdss' then case v_order.license_term when 'week' then 15 when 'month' then 50 when 'year' then 350 else null end
        when 'engine_ew' then case v_order.license_term when 'week' then 20 when 'month' then 50 when 'year' then 350 else null end
        when 'deck_mgt' then case v_order.license_term when 'week' then 40 when 'month' then 100 when 'year' then 700 else null end
        when 'engine_mgt' then case v_order.license_term when 'week' then 40 when 'month' then 100 when 'year' then 700 else null end
        else null end;

      if v_index is null
         or v_order.track_id is distinct from v_expected_track
         or v_order.license_term is distinct from v_batch.license_terms[v_index]
         or v_order.amount_php is distinct from v_expected_price
         or v_order.currency is distinct from 'PHP'
         or v_order.status not in ('pending', 'paid', 'failed', 'cancelled')
         or (v_order.payment_method is distinct from 'PayMongo Checkout'
             and coalesce(v_order.payment_method, '') not like 'PayMongo · %') then
        raise exception 'Basket child order does not match verified checkout' using errcode = '23514';
      end if;
    end loop;

    v_expected_codes := array(select x from unnest(v_batch.product_codes) as x order by x);
    v_child_codes := array(select x from unnest(v_child_codes) as x order by x);

    if v_child_count <> cardinality(v_batch.product_codes)
       or v_child_codes is distinct from v_expected_codes
       or v_child_total <> v_batch.amount_php then
      raise exception 'Basket items do not match the stored basket total' using errcode = '23514';
    end if;

    -- Detect a payment ID already tied to another checkout. A second charge is
    -- recorded for reconciliation, but must never extend access a second time.
    if exists (
      select 1 from public.orders o
       where o.paymongo_payment_id = p_payment_id
         and (o.checkout_batch_id is distinct from v_batch.id)
    ) or exists (
      select 1 from public.checkout_batches b
       where b.paymongo_payment_id = p_payment_id and b.id <> v_batch.id
    ) then
      insert into public.paymongo_reconciliation_alerts (
        checkout_reference, checkout_session_id, paymongo_payment_id,
        expected_amount_php, observed_amount_minor, observed_currency, reason
      ) values (
        v_batch.id, p_checkout_session_id, p_payment_id,
        v_batch.amount_php, p_amount_minor, p_currency,
        'PayMongo payment ID was already associated with another checkout; automatic fulfillment was not repeated.'
      ) on conflict (paymongo_payment_id) do nothing;
      return jsonb_build_object('status', 'reconciliation_required', 'orderId', v_batch.id);
    end if;

    v_now := now();

    for v_order in
      select o.* from public.orders o
       where o.checkout_batch_id = v_batch.id and o.user_id = v_batch.user_id
       order by o.product_code
       for update
    loop
      select * into v_entitlement
        from public.entitlements e
       where e.user_id = v_order.user_id and e.product_code = v_order.product_code
       for update;

      if found
         and v_entitlement.order_id = v_order.id
         and v_entitlement.status = 'active'
         and v_entitlement.expires_at is not null then
        -- Retry after an older partial write: reuse the original expiry.
        v_expires_at := v_entitlement.expires_at;
      else
        v_base := v_now;
        if found and v_entitlement.status = 'active' and v_entitlement.expires_at > v_now then
          v_base := v_entitlement.expires_at;
        end if;
        v_expires_at := case v_order.license_term
          when 'week' then v_base + interval '7 days'
          when 'month' then (timezone('UTC', v_base) + interval '1 month') at time zone 'UTC'
          when 'year' then (timezone('UTC', v_base) + interval '1 year') at time zone 'UTC'
          else null end;
        if v_expires_at is null then
          raise exception 'Invalid license term during fulfillment' using errcode = '23514';
        end if;

        insert into public.entitlements (
          user_id, product_code, track_id, order_id, license_term, status,
          granted_at, renewed_at, expires_at
        ) values (
          v_order.user_id, v_order.product_code, v_order.track_id, v_order.id,
          v_order.license_term, 'active', v_now, v_now, v_expires_at
        )
        on conflict (user_id, product_code) do update set
          track_id = excluded.track_id,
          order_id = excluded.order_id,
          license_term = excluded.license_term,
          status = 'active',
          granted_at = v_now,
          renewed_at = v_now,
          expires_at = v_expires_at;
      end if;

      update public.orders set
        status = 'paid',
        payment_reference = p_payment_id,
        payment_method = p_payment_method,
        paid_at = coalesce(paid_at, v_now),
        customer_name = coalesce(nullif(trim(customer_name), ''), nullif(left(trim(coalesce(p_customer_name, '')), 160), '')),
        customer_company = coalesce(nullif(trim(customer_company), ''), nullif(left(trim(coalesce(p_customer_company, '')), 160), '')),
        customer_school = coalesce(nullif(trim(customer_school), ''), nullif(left(trim(coalesce(p_customer_school, '')), 160), ''))
      where id = v_order.id and user_id = v_batch.user_id;

      v_expires_by_product := v_expires_by_product || jsonb_build_object(v_order.product_code, v_expires_at);
    end loop;

    update public.checkout_batches set
      status = 'paid',
      paymongo_payment_id = p_payment_id,
      payment_reference = p_payment_id,
      payment_method = p_payment_method,
      paid_at = coalesce(paid_at, v_now),
      customer_name = coalesce(nullif(trim(customer_name), ''), nullif(left(trim(coalesce(p_customer_name, '')), 160), '')),
      customer_company = coalesce(nullif(trim(customer_company), ''), nullif(left(trim(coalesce(p_customer_company, '')), 160), '')),
      customer_school = coalesce(nullif(trim(customer_school), ''), nullif(left(trim(coalesce(p_customer_school, '')), 160), ''))
    where id = v_batch.id;

    return jsonb_build_object(
      'status', 'paid', 'duplicate', false, 'orderId', v_batch.id,
      'productCodes', to_jsonb(v_batch.product_codes),
      'totalPhp', v_batch.amount_php, 'expiresAtByProduct', v_expires_by_product
    );
  end if;

  select * into v_order
    from public.orders
   where id = p_checkout_reference
   for update;

  if not found then
    raise exception 'Checkout reference not found' using errcode = 'P0002';
  end if;

  if v_order.paymongo_checkout_session_id is distinct from p_checkout_session_id then
    raise exception 'Checkout session does not match order reference' using errcode = '23514';
  end if;

  if p_amount_minor <> v_order.amount_php::bigint * 100 then
    raise exception 'Payment amount does not match order total' using errcode = '23514';
  end if;

  v_expected_track := case v_order.product_code
    when 'oic_nw' then 'DECK_OIC_NW'
    when 'gmdss' then 'GMDSS_GOC'
    when 'engine_ew' then 'ENGINE_OIC_EW'
    when 'deck_mgt' then 'DECK_MGT'
    when 'engine_mgt' then 'ENGINE_MGT'
    else null end;
  v_expected_price := case v_order.product_code
    when 'oic_nw' then case v_order.license_term when 'week' then 20 when 'month' then 50 when 'year' then 350 else null end
    when 'gmdss' then case v_order.license_term when 'week' then 15 when 'month' then 40 when 'year' then 250 else null end
    when 'engine_ew' then case v_order.license_term when 'week' then 20 when 'month' then 50 when 'year' then 350 else null end
    when 'deck_mgt' then case v_order.license_term when 'week' then 40 when 'month' then 100 when 'year' then 700 else null end
    when 'engine_mgt' then case v_order.license_term when 'week' then 40 when 'month' then 100 when 'year' then 700 else null end
    else null end;

  if v_order.track_id is distinct from v_expected_track
     or v_order.amount_php is distinct from v_expected_price
     or v_order.currency is distinct from 'PHP' then
    raise exception 'Order does not match canonical product catalogue' using errcode = '23514';
  end if;

  if v_order.status = 'paid' then
    if coalesce(v_order.payment_method, '') not like 'PayMongo · %' then
      raise exception 'Order was paid outside PayMongo; refuse PayMongo fulfillment' using errcode = '23514';
    end if;
    if v_order.paymongo_payment_id = p_payment_id then
      return jsonb_build_object('status', 'paid', 'duplicate', true, 'orderId', v_order.id, 'productCode', v_order.product_code, 'productCodes', jsonb_build_array(v_order.product_code), 'totalPhp', v_order.amount_php);
    end if;

    insert into public.paymongo_reconciliation_alerts (
      checkout_reference, checkout_session_id, paymongo_payment_id,
      expected_amount_php, observed_amount_minor, observed_currency, reason
    ) values (
      v_order.id, p_checkout_session_id, p_payment_id,
      v_order.amount_php, p_amount_minor, p_currency,
      'A distinct paid payment was reported for an already-paid order; no additional license term was granted.'
    ) on conflict (paymongo_payment_id) do nothing;

    return jsonb_build_object('status', 'paid', 'duplicatePayment', true, 'orderId', v_order.id, 'productCode', v_order.product_code, 'productCodes', jsonb_build_array(v_order.product_code), 'totalPhp', v_order.amount_php);
  end if;

  if v_order.status not in ('pending', 'failed', 'cancelled')
     or (v_order.payment_method is distinct from 'PayMongo Checkout'
         and coalesce(v_order.payment_method, '') not like 'PayMongo · %') then
    raise exception 'Order is not eligible for PayMongo fulfillment' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.orders o
     where o.paymongo_payment_id = p_payment_id and o.id <> v_order.id
  ) or exists (
    select 1 from public.checkout_batches b
     where b.paymongo_payment_id = p_payment_id
  ) then
    insert into public.paymongo_reconciliation_alerts (
      checkout_reference, checkout_session_id, paymongo_payment_id,
      expected_amount_php, observed_amount_minor, observed_currency, reason
    ) values (
      v_order.id, p_checkout_session_id, p_payment_id,
      v_order.amount_php, p_amount_minor, p_currency,
      'PayMongo payment ID was already associated with another checkout; automatic fulfillment was not repeated.'
    ) on conflict (paymongo_payment_id) do nothing;
    return jsonb_build_object('status', 'reconciliation_required', 'orderId', v_order.id);
  end if;

  perform pg_advisory_xact_lock(hashtext(v_order.user_id::text), hashtext(v_order.product_code));
  select * into v_entitlement
    from public.entitlements e
   where e.user_id = v_order.user_id and e.product_code = v_order.product_code
   for update;
  v_now := now();

  if found
     and v_entitlement.order_id = v_order.id
     and v_entitlement.status = 'active'
     and v_entitlement.expires_at is not null then
    v_expires_at := v_entitlement.expires_at;
  else
    v_base := v_now;
    if found and v_entitlement.status = 'active' and v_entitlement.expires_at > v_now then
      v_base := v_entitlement.expires_at;
    end if;
    v_expires_at := case v_order.license_term
      when 'week' then v_base + interval '7 days'
      when 'month' then (timezone('UTC', v_base) + interval '1 month') at time zone 'UTC'
      when 'year' then (timezone('UTC', v_base) + interval '1 year') at time zone 'UTC'
      else null end;
    if v_expires_at is null then
      raise exception 'Invalid license term during fulfillment' using errcode = '23514';
    end if;

    insert into public.entitlements (
      user_id, product_code, track_id, order_id, license_term, status,
      granted_at, renewed_at, expires_at
    ) values (
      v_order.user_id, v_order.product_code, v_order.track_id, v_order.id,
      v_order.license_term, 'active', v_now, v_now, v_expires_at
    )
    on conflict (user_id, product_code) do update set
      track_id = excluded.track_id,
      order_id = excluded.order_id,
      license_term = excluded.license_term,
      status = 'active',
      granted_at = v_now,
      renewed_at = v_now,
      expires_at = v_expires_at;
  end if;

  update public.orders set
    status = 'paid',
    paymongo_payment_id = p_payment_id,
    payment_reference = p_payment_id,
    payment_method = p_payment_method,
    paid_at = coalesce(paid_at, v_now),
    customer_name = coalesce(nullif(trim(customer_name), ''), nullif(left(trim(coalesce(p_customer_name, '')), 160), '')),
    customer_company = coalesce(nullif(trim(customer_company), ''), nullif(left(trim(coalesce(p_customer_company, '')), 160), '')),
    customer_school = coalesce(nullif(trim(customer_school), ''), nullif(left(trim(coalesce(p_customer_school, '')), 160), ''))
  where id = v_order.id;

  return jsonb_build_object(
    'status', 'paid', 'duplicate', false, 'orderId', v_order.id,
    'productCode', v_order.product_code, 'productCodes', jsonb_build_array(v_order.product_code),
    'totalPhp', v_order.amount_php, 'expiresAt', v_expires_at
  );
end;
$function$
;

revoke all on function public.finalize_paymongo_checkout(uuid, text, text, text, text, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.finalize_paymongo_checkout(uuid, text, text, text, text, bigint, text, text, text) to service_role;
