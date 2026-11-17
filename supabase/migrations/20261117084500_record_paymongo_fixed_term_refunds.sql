begin;
set local lock_timeout = '5s';

-- Keep the existing order history; refunds are payment statuses, not deletions.
-- Multi-track checkout batches need the same status already supported by orders.
alter table public.checkout_batches
  drop constraint if exists checkout_batches_status_check;
alter table public.checkout_batches
  add constraint checkout_batches_status_check
  check (status in ('pending','paid','failed','cancelled','refunded'));

-- A successfully refunded provider payment can arrive before its paid event.
-- Record it before matching a checkout so delayed paid callbacks never grant it.
create table if not exists public.paymongo_fixed_term_refunds (
  payment_id text primary key
    check (payment_id ~ '^pay_[A-Za-z0-9_-]{6,}$' and length(payment_id) <= 255),
  recorded_at timestamptz not null default now()
);
alter table public.paymongo_fixed_term_refunds enable row level security;
revoke all on public.paymongo_fixed_term_refunds from public,anon,authenticated;
grant select,insert on public.paymongo_fixed_term_refunds to service_role;

-- Only a verified-signature, correct-mode refund webhook may invoke this RPC.
-- Revoke automatically only when the purchase is the *sole* timed grant for
-- that track. Earlier renewals or administrative extensions have no per-order
-- expiry ledger, so their remaining time needs explicit reconciliation rather
-- than arbitrarily revoking unrelated paid access.
create or replace function public.revoke_paymongo_fixed_term_checkout(
  p_payment_id text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_batch public.checkout_batches%rowtype;
  v_order public.orders%rowtype;
  v_entitlement public.entitlements%rowtype;
  v_checkout_id uuid;
  v_user_id uuid;
  v_session_id text;
  v_amount_php integer;
  v_is_batch boolean := false;
  v_requires_review boolean := false;
  v_revoked integer := 0;
  v_matched integer := 0;
begin
  if p_payment_id is null or p_payment_id !~ '^pay_[A-Za-z0-9_-]{6,}$'
     or length(p_payment_id) > 255 then
    raise exception 'Invalid refunded PayMongo payment' using errcode='22023';
  end if;

  -- Same provider-payment lock as finalize_paymongo_checkout. Order and
  -- entitlement updates are one transaction; webhook replays are harmless.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hyperion-paymongo-payment:' || p_payment_id,0)
  );
  insert into public.paymongo_fixed_term_refunds(payment_id)
    values(p_payment_id) on conflict(payment_id) do nothing;

  select * into v_batch from public.checkout_batches
   where paymongo_payment_id=p_payment_id for update;
  if found then
    v_is_batch := true;
    v_checkout_id := v_batch.id;
    v_user_id := v_batch.user_id;
    v_session_id := v_batch.paymongo_checkout_session_id;
    v_amount_php := v_batch.amount_php;
    if v_batch.status not in ('paid','refunded')
       or coalesce(v_batch.payment_method,'') not like 'PayMongo · %' then
      raise exception 'Refund references an unverified basket' using errcode='23514';
    end if;
  else
    select * into v_order from public.orders
     where checkout_batch_id is null
       and (paymongo_payment_id=p_payment_id or
         (paymongo_payment_id is null and payment_reference=p_payment_id
          and payment_method like 'PayMongo · %'))
     for update;
    if not found then
      return pg_catalog.jsonb_build_object('status','recorded','matched',false);
    end if;
    v_checkout_id := v_order.id;
    v_user_id := v_order.user_id;
    v_session_id := v_order.paymongo_checkout_session_id;
    v_amount_php := v_order.amount_php;
    if v_order.status not in ('paid','refunded')
       or coalesce(v_order.payment_method,'') not like 'PayMongo · %' then
      raise exception 'Refund references an unverified order' using errcode='23514';
    end if;
  end if;

  -- Acquire per-track locks in a stable order, matching the paid finalizer.
  for v_order in
    select o.* from public.orders o
    where o.user_id=v_user_id and (
      (v_is_batch and o.checkout_batch_id=v_checkout_id) or
      (not v_is_batch and o.id=v_checkout_id)
    )
    order by o.product_code
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(v_user_id::text),pg_catalog.hashtext(v_order.product_code)
    );
  end loop;

  for v_order in
    select o.* from public.orders o
    where o.user_id=v_user_id and (
      (v_is_batch and o.checkout_batch_id=v_checkout_id) or
      (not v_is_batch and o.id=v_checkout_id)
    )
    order by o.product_code for update
  loop
    v_matched := v_matched+1;
    if v_order.status not in ('paid','refunded') then
      raise exception 'Refund basket has an unverified child order' using errcode='23514';
    end if;

    update public.orders set status='refunded'
      where id=v_order.id and status='paid';

    select * into v_entitlement from public.entitlements
      where user_id=v_order.user_id and product_code=v_order.product_code
      for update;
    if found and v_entitlement.status='active'
       and v_entitlement.expires_at>pg_catalog.now() then
      if v_entitlement.order_id=v_order.id
         and not exists (
           select 1 from public.orders other
           where other.user_id=v_order.user_id
             and other.product_code=v_order.product_code
             and other.id<>v_order.id and other.status='paid'
         )
         and not exists (
           select 1 from public.license_admin_audit audit
           where audit.user_id=v_order.user_id
             and audit.product_code=v_order.product_code
             and audit.action in ('grant','extend')
         ) then
        update public.entitlements set status='revoked'
         where id=v_entitlement.id and status='active' and order_id=v_order.id;
        v_revoked := v_revoked+1;
      else
        -- A subsequent purchase, previous purchase or manual extension may
        -- still legitimately provide access. Preserve it for manual review.
        v_requires_review := true;
      end if;
    end if;
  end loop;

  if v_matched=0 then
    raise exception 'Refunded basket contains no verified orders' using errcode='23514';
  end if;
  if v_is_batch then
    update public.checkout_batches set status='refunded'
      where id=v_checkout_id and status='paid';
  end if;

  if v_requires_review then
    insert into public.paymongo_reconciliation_alerts (
      checkout_reference,checkout_session_id,paymongo_payment_id,
      expected_amount_php,observed_amount_minor,observed_currency,reason
    ) values (
      v_checkout_id,v_session_id,p_payment_id,v_amount_php,
      v_amount_php::bigint*100,'PHP',
      'Refunded fixed-term payment overlaps another paid license or admin extension; reconcile remaining expiry without deleting saved data.'
    ) on conflict(paymongo_payment_id) do nothing;
  end if;
  return pg_catalog.jsonb_build_object(
    'status',case when v_requires_review then 'reconciliation_required' else 'refunded' end,
    'matched',true,'revokedTracks',v_revoked
  );
end $$;
revoke all on function public.revoke_paymongo_fixed_term_checkout(text)
  from public,anon,authenticated;
grant execute on function public.revoke_paymongo_fixed_term_checkout(text)
  to service_role;

-- Atomic late-paid guard: a refunded receipt cannot be resurrected by webhook
-- retries or an on-demand customer verification that races with the refund.
do $migration$
declare
  definition text;
  marker text := '  -- A checkout session reference can identify either a basket batch or a legacy';
  guard text := $guard$
  -- Any succeeded refund, including one delivered before this paid event,
  -- permanently disqualifies this provider payment from term fulfillment.
  if exists (select 1 from public.paymongo_fixed_term_refunds
             where payment_id=p_payment_id) then
    return jsonb_build_object('status','refunded','orderId',p_checkout_reference);
  end if;

$guard$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.finalize_paymongo_checkout(uuid,text,text,text,text,bigint,text,text,text)'::regprocedure
  ) into definition;
  if definition is null or pg_catalog.position(marker in definition)=0
     or pg_catalog.position('hyperion-paymongo-payment:' in definition)=0 then
    raise exception 'Expected transaction-serialized PayMongo finalizer not found';
  end if;
  if pg_catalog.position(guard in definition)>0 then return; end if;
  execute pg_catalog.replace(definition,marker,guard || marker);
end $migration$;
commit;
