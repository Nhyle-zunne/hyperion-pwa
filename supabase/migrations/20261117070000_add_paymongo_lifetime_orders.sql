begin;

-- One-time PayMongo payments are separate from recurring/fixed-term orders.
-- The existing subscription tables and license durations remain unchanged.
create table if not exists public.lifetime_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null,
  track_id text not null,
  amount_php integer not null,
  currency text not null default 'PHP' check (currency = 'PHP'),
  status text not null default 'pending'
    check (status in ('pending','paid','failed','cancelled','refunded','reconciliation_required')),
  paymongo_livemode boolean not null,
  paymongo_checkout_session_id text unique,
  paymongo_payment_id text unique,
  payment_ref_sha256 text check (payment_ref_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  refunded_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint lifetime_order_catalog check (
    (product_code = 'gmdss' and track_id = 'GMDSS_GOC' and amount_php = 1999) or
    (product_code = 'oic_nw' and track_id = 'DECK_OIC_NW' and amount_php = 2499) or
    (product_code = 'engine_ew' and track_id = 'ENGINE_OIC_EW' and amount_php = 2499) or
    (product_code = 'deck_mgt' and track_id = 'DECK_MGT' and amount_php = 4999) or
    (product_code = 'engine_mgt' and track_id = 'ENGINE_MGT' and amount_php = 4999)
  )
);

-- Concurrent tabs cannot start two independently payable lifetime checkouts
-- for the same user/track. Failed provider responses can be retried with the
-- original order UUID as the PayMongo idempotency key.
create unique index if not exists lifetime_orders_single_pending_per_track
  on public.lifetime_orders(user_id, product_code) where status = 'pending';
create index if not exists lifetime_orders_owner_history
  on public.lifetime_orders(user_id,created_at desc);

-- Record signed PayMongo refunds before or after their corresponding paid
-- webhook. A refund arriving first must permanently block that receipt from
-- being activated when webhook delivery is out of order.
create table if not exists public.lifetime_paymongo_refunds (
  payment_id text primary key check (length(payment_id) between 12 and 255),
  recorded_at timestamptz not null default now()
);
alter table public.lifetime_paymongo_refunds enable row level security;
revoke all on public.lifetime_paymongo_refunds from public, anon, authenticated;
grant select,insert on public.lifetime_paymongo_refunds to service_role;

alter table public.lifetime_orders enable row level security;
revoke all on public.lifetime_orders from public,anon,authenticated;
grant select on public.lifetime_orders to authenticated;
grant select,insert,update,delete on public.lifetime_orders to service_role;
drop policy if exists "Users read own lifetime orders" on public.lifetime_orders;
create policy "Users read own lifetime orders" on public.lifetime_orders
  for select to authenticated using ((select auth.uid()) = user_id);

-- Called only from the signed PayMongo webhook or the authenticated server
-- verifier AFTER verifying the provider session, exact buyer/product/mode,
-- payment ID, paid state, amount and currency. Service role only.
create or replace function public.finalize_paymongo_lifetime_checkout(
  p_order_id uuid, p_checkout_session_id text, p_payment_id text,
  p_payment_ref_sha256 text, p_amount_minor bigint, p_currency text,
  p_livemode boolean
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_order public.lifetime_orders%rowtype;
  v_existing text;
begin
  if p_order_id is null or nullif(p_checkout_session_id,'') is null
     or nullif(p_payment_id,'') is null or length(p_payment_id) > 255
     or p_payment_ref_sha256 is null
     or p_payment_ref_sha256 !~ '^[a-f0-9]{64}$'
     or p_currency <> 'PHP' or p_amount_minor is null or p_livemode is null then
    raise exception 'Invalid lifetime payment proof' using errcode='22023';
  end if;

  -- Refund and paid handlers lock the SAME payment ID before the order row.
  -- This prevents a paid webhook from racing an earlier signed refund.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('paymongo_payment:' || p_payment_id,0)
  );

  -- Serialize all verified lifetime payments for one account/track.
  select * into v_order from public.lifetime_orders
   where id = p_order_id for update;
  if not found then
    raise exception 'Unknown lifetime checkout' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_order.user_id::text || ':' || v_order.product_code, 0)
  );
  if v_order.paymongo_checkout_session_id is distinct from p_checkout_session_id
     or v_order.paymongo_livemode is distinct from p_livemode
     or p_amount_minor <> v_order.amount_php::bigint * 100
     or v_order.currency <> p_currency then
    raise exception 'Lifetime payment does not match its saved checkout'
      using errcode='23514';
  end if;
  if v_order.status = 'refunded' then
    return pg_catalog.jsonb_build_object('status','refunded','orderId',v_order.id);
  end if;

  -- An already-paid order cannot be re-bound to a distinct receipt, even
  -- when that second payment is already refunded. Never revoke the first
  -- owner's valid purchase because of another payment's refund.
  if v_order.status = 'paid' and (
    v_order.paymongo_payment_id is distinct from p_payment_id or
    v_order.payment_ref_sha256 is distinct from p_payment_ref_sha256
  ) then
    raise exception 'A second payment needs manual reconciliation'
      using errcode='23505';
  end if;

  -- A properly signed refund can arrive before the paid checkout webhook.
  -- Such a receipt must never activate (or reactivate) lifetime ownership.
  if exists (select 1 from public.lifetime_paymongo_refunds
             where payment_id = p_payment_id) then
    if v_order.status = 'paid' then
      perform public.record_verified_lifetime_entitlement(
        v_order.user_id,v_order.product_code,'paymongo',p_payment_ref_sha256,'revoked'
      );
    end if;
    update public.lifetime_orders set
      status='refunded',paymongo_payment_id=p_payment_id,
      payment_ref_sha256=p_payment_ref_sha256,
      paid_at=coalesce(paid_at,pg_catalog.now()),
      refunded_at=pg_catalog.now(),updated_at=pg_catalog.now()
    where id=v_order.id;
    return pg_catalog.jsonb_build_object('status','refunded','orderId',v_order.id);
  end if;
  if v_order.status = 'paid' then
    if v_order.paymongo_payment_id is distinct from p_payment_id
       or v_order.payment_ref_sha256 is distinct from p_payment_ref_sha256 then
      raise exception 'A second payment needs manual reconciliation'
        using errcode='23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'status','paid','orderId',v_order.id,
      'productCode',v_order.product_code,'duplicate',true
    );
  end if;
  if v_order.status <> 'pending' then
    raise exception 'This lifetime checkout cannot be fulfilled' using errcode='23514';
  end if;

  -- Concurrent verified payments must never silently charge the same owner
  -- twice for the same track. Record the extra payment for manual refund.
  select id::text into v_existing from public.lifetime_entitlements
   where user_id=v_order.user_id and product_code=v_order.product_code
     and status='active' limit 1;
  if v_existing is not null then
    update public.lifetime_orders
       set status='reconciliation_required',paymongo_payment_id=p_payment_id,
           payment_ref_sha256=p_payment_ref_sha256,paid_at=pg_catalog.now(),
           updated_at=pg_catalog.now()
     where id=v_order.id;
    return pg_catalog.jsonb_build_object(
      'status','reconciliation_required','orderId',v_order.id
    );
  end if;

  -- Both the order status and the owner-bound lifetime receipt commit together.
  perform public.record_verified_lifetime_entitlement(
    v_order.user_id,v_order.product_code,'paymongo',p_payment_ref_sha256,'active'
  );
  update public.lifetime_orders set
    status='paid',paymongo_payment_id=p_payment_id,
    payment_ref_sha256=p_payment_ref_sha256,paid_at=pg_catalog.now(),
    updated_at=pg_catalog.now()
  where id=v_order.id;
  return pg_catalog.jsonb_build_object(
    'status','paid','orderId',v_order.id,'productCode',v_order.product_code,
    'duplicate',false
  );
end $$;

revoke all on function public.finalize_paymongo_lifetime_checkout(uuid,text,text,text,bigint,text,boolean)
  from public,anon,authenticated;
grant execute on function public.finalize_paymongo_lifetime_checkout(uuid,text,text,text,bigint,text,boolean)
  to service_role;

-- Only the provider-verified refund handler may call this. Any successful
-- refund revokes the one-time grant, without touching timed subscriptions,
-- ownership history, bookmarks, questions or study records.
create or replace function public.revoke_paymongo_lifetime_checkout(
  p_payment_id text
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  v_order public.lifetime_orders%rowtype;
begin
  if nullif(p_payment_id,'') is null or length(p_payment_id) > 255 then
    raise exception 'Invalid refund reference' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('paymongo_payment:' || p_payment_id,0)
  );
  insert into public.lifetime_paymongo_refunds(payment_id)
    values(p_payment_id) on conflict(payment_id) do nothing;
  select * into v_order from public.lifetime_orders
   where paymongo_payment_id=p_payment_id for update;
  if not found then return false; end if;
  if v_order.status = 'refunded' then return true; end if;
  if v_order.status not in ('paid','reconciliation_required')
     or v_order.payment_ref_sha256 is null then
    raise exception 'Refund does not match a verified lifetime payment'
      using errcode='23514';
  end if;
  if v_order.status='paid' then
    perform public.record_verified_lifetime_entitlement(
      v_order.user_id,v_order.product_code,'paymongo',v_order.payment_ref_sha256,'revoked'
    );
  end if;
  update public.lifetime_orders set
    status='refunded',refunded_at=pg_catalog.now(),updated_at=pg_catalog.now()
    where id=v_order.id;
  return true;
end $$;
revoke all on function public.revoke_paymongo_lifetime_checkout(text)
  from public,anon,authenticated;
grant execute on function public.revoke_paymongo_lifetime_checkout(text)
  to service_role;

commit;
