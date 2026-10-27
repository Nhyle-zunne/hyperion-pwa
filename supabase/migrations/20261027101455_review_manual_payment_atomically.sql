CREATE OR REPLACE FUNCTION public.review_manual_payment(p_order_id uuid, p_decision text, p_admin_email text, p_admin_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
declare
  v_order public.orders%rowtype;
  v_entitlement public.entitlements%rowtype;
  v_now timestamptz := now();
  v_current_expiry timestamptz;
  v_base timestamptz;
  v_expires_at timestamptz;
  v_term text;
  v_expected_price integer;
  v_expected_track text;
  v_updated_id uuid;
  v_reuse_expiry boolean := false;
  v_note text := nullif(left(trim(coalesce(p_admin_note, '')), 1000), '');
begin
  if p_order_id is null or p_decision not in ('approve', 'reject')
     or nullif(trim(coalesce(p_admin_email, '')), '') is null then
    raise exception 'Invalid manual payment review request' using errcode = '22023';
  end if;

  select * into v_order
    from public.orders
   where id = p_order_id
   for update;

  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  if v_order.status not in ('submitted', 'pending') then
    raise exception 'This order is not awaiting review' using errcode = '23514';
  end if;

  if v_order.paymongo_checkout_session_id is not null
     or v_order.payment_method = 'PayMongo Checkout'
     or coalesce(v_order.payment_method, '') like 'PayMongo · %' then
    raise exception 'PayMongo checkout orders must be finalized by verified PayMongo processing' using errcode = '23514';
  end if;

  if p_decision = 'reject' then
    update public.orders
       set status = 'failed',
           admin_note = v_note,
           reviewed_by = trim(p_admin_email),
           reviewed_at = v_now
     where id = v_order.id and status in ('submitted', 'pending')
     returning id into v_updated_id;

    if v_updated_id is null then
      raise exception 'Order changed while being reviewed' using errcode = '40001';
    end if;

    return jsonb_build_object('ok', true, 'status', 'failed', 'orderId', v_order.id);
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

  if v_expected_track is null
     or v_order.track_id is distinct from v_expected_track
     or v_order.currency is distinct from 'PHP'
     or v_order.amount_php is distinct from v_expected_price
     or v_order.license_term not in ('week', 'month', 'year') then
    raise exception 'Manual payment order does not match the canonical product catalogue' using errcode = '23514';
  end if;

  -- Serialize manual approvals against PayMongo fulfillment for the same user/product.
  perform pg_advisory_xact_lock(hashtext(v_order.user_id::text), hashtext(v_order.product_code));

  select * into v_entitlement
    from public.entitlements e
   where e.user_id = v_order.user_id and e.product_code = v_order.product_code
   for update;

  v_current_expiry := case
    when v_entitlement.status = 'active' and v_entitlement.expires_at is not null
      then v_entitlement.expires_at
    else null end;

  if v_entitlement.status = 'active'
     and (v_entitlement.expires_at is null or v_entitlement.expires_at > v_now)
     and v_entitlement.order_id is distinct from v_order.id then
    raise exception 'This user already has an active license for this track' using errcode = '23514';
  end if;

  v_reuse_expiry := v_entitlement.order_id = v_order.id
    and v_entitlement.status = 'active'
    and v_entitlement.expires_at is not null
    and v_entitlement.expires_at > v_now;

  if v_reuse_expiry then
    v_expires_at := v_entitlement.expires_at;
  else
    v_base := case when v_current_expiry > v_now then v_current_expiry else v_now end;
    v_expires_at := case v_order.license_term
      when 'week' then v_base + interval '7 days'
      when 'month' then (timezone('UTC', v_base) + interval '1 month') at time zone 'UTC'
      when 'year' then (timezone('UTC', v_base) + interval '1 year') at time zone 'UTC'
      else null end;
  end if;

  if v_expires_at is null then
    raise exception 'Unable to calculate license expiry' using errcode = '23514';
  end if;

  insert into public.entitlements (
    user_id, product_code, track_id, order_id, license_term, status,
    granted_at, renewed_at, expires_at
  ) values (
    v_order.user_id, v_order.product_code, v_order.track_id, v_order.id, v_order.license_term, 'active',
    case when v_reuse_expiry and v_entitlement.granted_at is not null then v_entitlement.granted_at else v_now end,
    v_now, v_expires_at
  )
  on conflict (user_id, product_code) do update set
    track_id = excluded.track_id,
    order_id = excluded.order_id,
    license_term = excluded.license_term,
    status = 'active',
    granted_at = excluded.granted_at,
    renewed_at = excluded.renewed_at,
    expires_at = excluded.expires_at;

  update public.orders
     set status = 'paid',
         admin_note = v_note,
         reviewed_by = trim(p_admin_email),
         reviewed_at = v_now,
         paid_at = coalesce(paid_at, v_now)
   where id = v_order.id and status in ('submitted', 'pending')
   returning id into v_updated_id;

  if v_updated_id is null then
    raise exception 'Order changed while being reviewed' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'ok', true, 'status', 'paid', 'orderId', v_order.id,
    'productCode', v_order.product_code, 'licenseTerm', v_order.license_term,
    'expiresAt', v_expires_at, 'reusedExpiry', v_reuse_expiry
  );
end;
$function$;

revoke all on function public.review_manual_payment(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.review_manual_payment(uuid, text, text, text) to service_role;
