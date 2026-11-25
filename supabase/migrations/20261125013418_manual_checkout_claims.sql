-- A claim means someone clicked Messenger. It is not proof they paid.
-- Never store customer receipt images; they are sent directly to Messenger.
begin;

create table public.manual_checkout_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  selection_key text not null,
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 5),
  total_amount_php integer not null check (total_amount_php > 0),
  status text not null default 'awaiting_proof' check (status in ('awaiting_proof','pending_verification','approved','rejected','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '72 hours'),
  proof_received_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  admin_note text
);

create unique index manual_checkout_claims_one_open_cart
  on public.manual_checkout_claims (user_id, selection_key)
  where status in ('awaiting_proof','pending_verification');
create index manual_checkout_claims_admin_recent on public.manual_checkout_claims (created_at desc);
create index manual_checkout_claims_owner_recent on public.manual_checkout_claims (user_id,created_at desc);

alter table public.manual_checkout_claims enable row level security;
revoke all on public.manual_checkout_claims from public,anon,authenticated;
-- The administrator's matching notes and identity are *internal*.
grant select(id,user_id,selection_key,items,total_amount_php,status,created_at,updated_at,expires_at,proof_received_at,reviewed_at)
  on public.manual_checkout_claims to authenticated;
grant select,insert,update,delete on public.manual_checkout_claims to service_role;
create policy "Customers read their own checkout claims" on public.manual_checkout_claims
  for select to authenticated using ((select auth.uid()) = user_id);

-- Short-lived deletion intent coordinates automatic/customer account deletion
-- with creation and approval of Messenger claims. It never stores a receipt.
create table public.checkout_account_deletion_holds (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null check(reason in ('customer','retention')),
  expires_at timestamptz not null
);
alter table public.checkout_account_deletion_holds enable row level security;
revoke all on public.checkout_account_deletion_holds from public,anon,authenticated;
grant select,insert,update,delete on public.checkout_account_deletion_holds to service_role;

create function public.begin_checkout_account_deletion(p_user_id uuid,p_reason text)
returns boolean language plpgsql security definer
set search_path to 'pg_catalog','public','pg_temp'
as $$
declare v_user_id uuid;
begin
  if p_user_id is null or p_reason is null or p_reason not in ('customer','retention') then
    raise exception 'Invalid account deletion hold' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hyperion-checkout-account:'||p_user_id::text,0));
  select id into v_user_id from auth.users where id=p_user_id for update;
  if not found then return false; end if;
  if exists(select 1 from public.manual_checkout_claims where user_id=p_user_id
    and (status='pending_verification' or (status='awaiting_proof' and expires_at>now())))
    or exists(select 1 from public.orders where user_id=p_user_id and status in ('pending','submitted'))
    or exists(select 1 from public.lifetime_orders where user_id=p_user_id and status='pending') then
    return false;
  end if;
  if p_reason='retention' and (
    exists(select 1 from public.lifetime_entitlements where user_id=p_user_id and status='active')
    or exists(select 1 from public.entitlements where user_id=p_user_id and status='active' and expires_at>now())
    or exists(select 1 from public.google_play_entitlements where user_id=p_user_id and status='active' and expires_at>now())
  ) then return false; end if;
  insert into public.checkout_account_deletion_holds(user_id,reason,expires_at)
    values(p_user_id,p_reason,now()+interval '10 minutes')
  on conflict(user_id) do update set reason=excluded.reason,expires_at=excluded.expires_at;
  return true;
end;
$$;

create function public.cancel_checkout_account_deletion(p_user_id uuid)
returns void language plpgsql security definer
set search_path to 'pg_catalog','public','pg_temp'
as $$
begin
  if p_user_id is null then raise exception 'Invalid account' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hyperion-checkout-account:'||p_user_id::text,0));
  delete from public.checkout_account_deletion_holds where user_id=p_user_id;
end;
$$;

revoke all on function public.begin_checkout_account_deletion(uuid,text) from public,anon,authenticated;
revoke all on function public.cancel_checkout_account_deletion(uuid) from public,anon,authenticated;
grant execute on function public.begin_checkout_account_deletion(uuid,text) to service_role;
grant execute on function public.cancel_checkout_account_deletion(uuid) to service_role;

alter table public.orders add column manual_claim_id uuid references public.manual_checkout_claims(id) on delete set null;
create unique index orders_manual_claim_product_once
  on public.orders(manual_claim_id,product_code) where manual_claim_id is not null;

-- Separate provider: do not reinterpret existing PayMongo or Google Play receipts.
alter table public.lifetime_entitlements
  drop constraint lifetime_entitlements_provider_check,
  add constraint lifetime_entitlements_provider_check
    check (provider in ('paymongo','google_play','admin','manual'));

-- Both functions are callable *only* by service_role behind authenticated Edge functions.
-- The database, not the browser, determines track, price, and recipient identity.
create function public.create_manual_checkout_claim(p_user_id uuid, p_selection text)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','pg_temp'
as $$
declare
  v_parts text[];
  v_part text;
  v_code text;
  v_term text;
  v_label text;
  v_price integer;
  v_seen text[] := '{}';
  v_keys text[] := '{}';
  v_key text;
  v_items jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_existing public.manual_checkout_claims%rowtype;
  v_enabled boolean;
  v_open_count integer;
  v_current_website_expiry timestamptz;
  v_current_play_expiry timestamptz;
begin
  if p_user_id is null or nullif(p_selection,'') is null or length(p_selection) > 200 then
    raise exception 'Invalid checkout selection' using errcode='22023';
  end if;
  v_parts := string_to_array(p_selection,',');
  if cardinality(v_parts) < 1 or cardinality(v_parts) > 5 then
    raise exception 'Invalid checkout selection' using errcode='22023';
  end if;

  foreach v_part in array v_parts loop
    v_code := split_part(v_part,':',1);
    v_term := split_part(v_part,':',2);
    if length(v_part) - length(replace(v_part,':','')) <> 1
       or v_term not in ('week','month','year','lifetime')
       or v_code = any(v_seen) then
      raise exception 'Invalid or duplicate checkout selection' using errcode='22023';
    end if;
    v_label := case v_code
      when 'oic_nw' then 'Deck OIC-NW' when 'engine_ew' then 'Engine OIC-EW'
      when 'gmdss' then 'GMDSS GOC' when 'deck_mgt' then 'Deck Management'
      when 'engine_mgt' then 'Engine Management' else null end;
    v_price := case v_code
      when 'oic_nw' then case v_term when 'week' then 29 when 'month' then 79 when 'year' then 499 when 'lifetime' then 999 end
      when 'engine_ew' then case v_term when 'week' then 29 when 'month' then 79 when 'year' then 499 when 'lifetime' then 999 end
      when 'gmdss' then case v_term when 'week' then 25 when 'month' then 59 when 'year' then 399 when 'lifetime' then 599 end
      when 'deck_mgt' then case v_term when 'week' then 59 when 'month' then 149 when 'year' then 999 when 'lifetime' then 1999 end
      when 'engine_mgt' then case v_term when 'week' then 59 when 'month' then 149 when 'year' then 999 when 'lifetime' then 1999 end end;
    if v_label is null or v_price is null then
      raise exception 'Invalid checkout selection' using errcode='22023';
    end if;
    v_seen := array_append(v_seen,v_code);
    v_keys := array_append(v_keys,v_part);
    v_items := v_items || jsonb_build_array(jsonb_build_object('code',v_code,'term',v_term,'label',v_label,'amountPhp',v_price));
    v_total := v_total + v_price;
  end loop;
  select array_to_string(array_agg(k order by k),',') into v_key from unnest(v_keys) k;

  perform pg_advisory_xact_lock(hashtextextended('hyperion-checkout-account:'||p_user_id::text,0));
  if exists(select 1 from public.checkout_account_deletion_holds where user_id=p_user_id and expires_at>now()) then
    raise exception 'Account deletion is in progress; checkout unavailable' using errcode='23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hyperion-manual-cart:' || p_user_id::text,0));
  select website_checkout_enabled into v_enabled from public.payment_settings where id=1;
  if v_enabled is distinct from true then
    raise exception 'Website checkout is disabled' using errcode='23514';
  end if;
  foreach v_code in array v_seen loop
    if exists (select 1 from public.lifetime_entitlements
      where user_id=p_user_id and product_code=v_code and status='active') then
      raise exception 'Lifetime Access already owned for this track; do not transfer money' using errcode='23514';
    end if;
    select expires_at into v_current_play_expiry from public.google_play_entitlements
      where user_id=p_user_id and product_code=v_code and status='active' and expires_at>now()
      order by expires_at desc limit 1;
    select expires_at into v_current_website_expiry from public.entitlements
      where user_id=p_user_id and product_code=v_code and status='active' and expires_at>now();
    if v_current_play_expiry is not null and
       (v_current_website_expiry is null or v_current_play_expiry>v_current_website_expiry) then
      raise exception 'An active Google Play license overlaps this track; do not transfer money' using errcode='23514';
    end if;
    if exists(select 1 from public.orders
      where user_id=p_user_id and product_code=v_code and status in ('pending','submitted')) or
       exists(select 1 from public.orders
      where user_id=p_user_id and product_code=v_code and status='failed'
        and payment_method='PayMongo Checkout' and paymongo_checkout_session_id is not null) or
       exists(select 1 from public.lifetime_orders
      where user_id=p_user_id and product_code=v_code and status='pending') then
      raise exception 'An unresolved historical payment is pending for this track; do not pay again' using errcode='23514';
    end if;
  end loop;
  update public.manual_checkout_claims set status='expired', updated_at=now()
    where user_id=p_user_id and status='awaiting_proof' and expires_at <= now();
  select * into v_existing from public.manual_checkout_claims
    where user_id=p_user_id and selection_key=v_key
      and status in ('awaiting_proof','pending_verification');
  if found then return to_jsonb(v_existing); end if;
  select count(*) into v_open_count from public.manual_checkout_claims
    where user_id=p_user_id and status in ('awaiting_proof','pending_verification');
  if v_open_count >= 3 then
    raise exception 'Too many open payment claims. Please contact Hyperion support.' using errcode='23514';
  end if;
  insert into public.manual_checkout_claims (user_id,selection_key,items,total_amount_php)
    values (p_user_id,v_key,v_items,v_total) returning * into v_existing;
  return to_jsonb(v_existing);
end;
$$;

create function public.review_manual_checkout_claim(p_claim_id uuid,p_action text,p_admin_email text,p_admin_note text default null)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','pg_temp'
set "TimeZone" to 'UTC'
as $$
declare
  v_claim public.manual_checkout_claims%rowtype;
  v_owner uuid;
  v_item jsonb;
  v_code text;
  v_term text;
  v_track text;
  v_price integer;
  v_row public.entitlements%rowtype;
  v_base timestamptz;
  v_expiry timestamptz;
  v_order_id uuid;
  v_now timestamptz := now();
  v_note text := nullif(left(trim(coalesce(p_admin_note,'')),1000),'');
begin
  if p_claim_id is null or p_action is null or p_action not in ('proof_received','approve','reject')
     or nullif(trim(coalesce(p_admin_email,'')),'') is null then
    raise exception 'Invalid payment review action' using errcode='22023';
  end if;
  select user_id into v_owner from public.manual_checkout_claims where id=p_claim_id;
  if not found then raise exception 'Claim not found' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hyperion-checkout-account:'||v_owner::text,0));
  if exists(select 1 from public.checkout_account_deletion_holds where user_id=v_owner and expires_at>now()) then
    raise exception 'Account deletion is in progress; review unavailable' using errcode='23514';
  end if;
  select * into v_claim from public.manual_checkout_claims where id=p_claim_id for update;
  if not found then raise exception 'Claim not found' using errcode='P0002'; end if;

  if v_claim.status='awaiting_proof' and v_claim.expires_at<=v_now then
    update public.manual_checkout_claims set status='expired',updated_at=v_now where id=p_claim_id;
    return jsonb_build_object('ok',false,'status','expired','claimId',p_claim_id);
  end if;
  if p_action='proof_received' then
    if v_claim.status <> 'awaiting_proof' then
      raise exception 'Claim is not awaiting proof' using errcode='23514';
    end if;
    update public.manual_checkout_claims
      set status='pending_verification',proof_received_at=v_now,updated_at=v_now,
          admin_note=coalesce(v_note,admin_note),reviewed_by=trim(p_admin_email)
      where id=p_claim_id;
    return jsonb_build_object('ok',true,'status','pending_verification','claimId',p_claim_id);
  end if;
  if v_claim.status not in ('awaiting_proof','pending_verification') then
    raise exception 'Claim already reviewed or expired' using errcode='23514';
  end if;
  if p_action='reject' then
    update public.manual_checkout_claims set status='rejected',updated_at=v_now,
      reviewed_at=v_now,reviewed_by=trim(p_admin_email),admin_note=v_note where id=p_claim_id;
    return jsonb_build_object('ok',true,'status','rejected','claimId',p_claim_id);
  end if;
  if v_claim.status <> 'pending_verification' then
    raise exception 'Receipt proof not yet received' using errcode='23514';
  end if;

  -- One transaction, one lock per owner/product; any error rolls back every grant.
  for v_item in select value from jsonb_array_elements(v_claim.items) as e(value) order by value->>'code' loop
    v_code := v_item->>'code'; v_term := v_item->>'term';
    v_price := (v_item->>'amountPhp')::integer;
    v_track := case v_code
      when 'oic_nw' then 'DECK_OIC_NW' when 'engine_ew' then 'ENGINE_OIC_EW'
      when 'gmdss' then 'GMDSS_GOC' when 'deck_mgt' then 'DECK_MGT'
      when 'engine_mgt' then 'ENGINE_MGT' else null end;
    if v_track is null or v_term not in ('week','month','year','lifetime')
       or v_price <= 0 then
      raise exception 'Invalid saved claim items' using errcode='23514';
    end if;
    perform pg_advisory_xact_lock(hashtext(v_claim.user_id::text),hashtext(v_code));

    if exists(select 1 from public.lifetime_entitlements
        where user_id=v_claim.user_id and product_code=v_code and status='active') then
      raise exception 'This track already has lifetime access; resolve the duplicate before approval' using errcode='23514';
    end if;
    -- A Play grant may have appeared after this claim was created.
    if exists (select 1 from public.google_play_entitlements g
      where g.user_id=v_claim.user_id and g.product_code=v_code and g.status='active'
        and g.expires_at>v_now and g.expires_at>coalesce((select e.expires_at
          from public.entitlements e where e.user_id=v_claim.user_id and e.product_code=v_code
            and e.status='active'),v_now)) then
      raise exception 'An overlapping Google Play license was activated while the claim was pending' using errcode='23514';
    end if;

    if v_term='lifetime' then
      insert into public.lifetime_entitlements
        (user_id,product_code,track_id,provider,purchase_ref_sha256,status,purchased_at,updated_at)
      values (v_claim.user_id,v_code,v_track,'manual',
        encode(sha256(convert_to(p_claim_id::text||':'||v_code,'UTF8')),'hex'),
        'active',v_now,v_now);
    else
      select * into v_row from public.entitlements
        where user_id=v_claim.user_id and product_code=v_code for update;
      v_base := case when v_row.status='active' and v_row.expires_at>v_now then v_row.expires_at else v_now end;
      v_expiry := case v_term
        when 'week' then v_base + interval '7 days'
        when 'month' then (timezone('UTC',v_base) + interval '1 month') at time zone 'UTC'
        when 'year' then (timezone('UTC',v_base) + interval '1 year') at time zone 'UTC' end;
      insert into public.orders
        (user_id,product_code,track_id,license_term,amount_php,currency,status,
         payment_method,payment_reference,manual_claim_id,admin_note,reviewed_by,reviewed_at,paid_at)
      values (v_claim.user_id,v_code,v_track,v_term,v_price,'PHP','paid',
        'Manual QR Ph / InstaPay',p_claim_id::text,p_claim_id,null,'Hyperion payment team',v_now,v_now)
      returning id into v_order_id;
      insert into public.entitlements
        (user_id,product_code,track_id,order_id,license_term,status,granted_at,renewed_at,expires_at)
      values (v_claim.user_id,v_code,v_track,v_order_id,v_term,'active',v_now,v_now,v_expiry)
      on conflict(user_id,product_code) do update set
        track_id=excluded.track_id,order_id=excluded.order_id,
        license_term=excluded.license_term,status='active',granted_at=v_now,
        renewed_at=v_now,expires_at=excluded.expires_at;
    end if;
  end loop;
  update public.manual_checkout_claims set status='approved',updated_at=v_now,
    reviewed_at=v_now,reviewed_by=trim(p_admin_email),admin_note=coalesce(v_note,admin_note) where id=p_claim_id;
  return jsonb_build_object('ok',true,'status','approved','claimId',p_claim_id);
end;
$$;

revoke all on function public.create_manual_checkout_claim(uuid,text) from public,anon,authenticated;
revoke all on function public.review_manual_checkout_claim(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.create_manual_checkout_claim(uuid,text) to service_role;
grant execute on function public.review_manual_checkout_claim(uuid,text,text,text) to service_role;
commit;
