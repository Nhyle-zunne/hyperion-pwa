begin;

-- Lifetime ownership is separate from subscriptions, so subscriptions can be
-- renewed, cancelled or revoked without modifying permanent track access.
-- Only verified payment handlers running as service_role may mutate this table.
create table if not exists public.lifetime_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null check (
    product_code in ('oic_nw','engine_ew','deck_mgt','engine_mgt','gmdss')
  ),
  track_id text not null check (
    track_id in ('DECK_OIC_NW','ENGINE_OIC_EW','DECK_MGT','ENGINE_MGT','GMDSS_GOC')
  ),
  provider text not null check (provider in ('paymongo','google_play')),
  purchase_ref_sha256 text not null check (purchase_ref_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'active' check (status in ('active','revoked')),
  purchased_at timestamptz not null default now(),
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (provider,purchase_ref_sha256),
  constraint lifetime_product_track_match check (
    (product_code='oic_nw' and track_id='DECK_OIC_NW') or
    (product_code='engine_ew' and track_id='ENGINE_OIC_EW') or
    (product_code='deck_mgt' and track_id='DECK_MGT') or
    (product_code='engine_mgt' and track_id='ENGINE_MGT') or
    (product_code='gmdss' and track_id='GMDSS_GOC')
  )
);
create index if not exists lifetime_entitlements_user_track_active_idx
  on public.lifetime_entitlements(user_id,track_id)
  where status='active';

alter table public.lifetime_entitlements enable row level security;
revoke all on public.lifetime_entitlements from public, anon, authenticated;
grant select on public.lifetime_entitlements to authenticated;
grant select, insert, update, delete on public.lifetime_entitlements to service_role;
drop policy if exists "Users read own lifetime entitlements" on public.lifetime_entitlements;
create policy "Users read own lifetime entitlements" on public.lifetime_entitlements
  for select to authenticated using ((select auth.uid()) = user_id);

-- A receipt can only belong to one Hyperion user and one track for its whole
-- lifetime. A revoked/refunded receipt must never be replayed into active access.
-- Call ONLY after server-side PayMongo/Google Play purchase verification.
create or replace function public.record_verified_lifetime_entitlement(
  p_user_id uuid,
  p_product_code text,
  p_provider text,
  p_purchase_ref_sha256 text,
  p_status text
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_track text;
  v_id uuid;
begin
  v_track := case p_product_code
    when 'oic_nw' then 'DECK_OIC_NW'
    when 'engine_ew' then 'ENGINE_OIC_EW'
    when 'deck_mgt' then 'DECK_MGT'
    when 'engine_mgt' then 'ENGINE_MGT'
    when 'gmdss' then 'GMDSS_GOC'
    else null end;

  if p_user_id is null or v_track is null
     or p_provider not in ('paymongo','google_play')
     or p_status not in ('active','revoked')
     or p_purchase_ref_sha256 is null
     or p_purchase_ref_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid verified lifetime purchase' using errcode='22023';
  end if;

  insert into public.lifetime_entitlements (
    user_id,product_code,track_id,provider,purchase_ref_sha256,status,revoked_at
  ) values (
    p_user_id,p_product_code,v_track,p_provider,p_purchase_ref_sha256,p_status,
    case when p_status='revoked' then pg_catalog.now() else null end
  )
  on conflict (provider,purchase_ref_sha256)
  do update set
    status=case when public.lifetime_entitlements.status='revoked'
                then 'revoked' else excluded.status end,
    revoked_at=case when public.lifetime_entitlements.status='revoked' or excluded.status='revoked'
                    then coalesce(public.lifetime_entitlements.revoked_at,pg_catalog.now())
                    else null end,
    updated_at=pg_catalog.now()
  where public.lifetime_entitlements.user_id=excluded.user_id
    and public.lifetime_entitlements.product_code=excluded.product_code
    and public.lifetime_entitlements.track_id=excluded.track_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Verified purchase already belongs to another account or product'
      using errcode='23505';
  end if;

  return true;
end $$;

revoke all on function public.record_verified_lifetime_entitlement(uuid,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.record_verified_lifetime_entitlement(uuid,text,text,text,text)
  to service_role;

-- Preserve the existing return shape for all clients, including Android's
-- signed offline licenses. The far-future expiry represents service-lifetime
-- ownership, not a recurring payment or a claim that a service lasts forever.
-- We never change subscription rows or their actual expiration dates.
create or replace function public.get_active_paid_track_entitlements(
  p_user_id uuid,
  p_track_id text default null
)
returns table(user_id uuid, track_id text, expires_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select p_user_id, grants.track_id, max(grants.expires_at) as expires_at
  from (
    select e.track_id::text as track_id,e.expires_at
      from public.entitlements e
     where e.user_id=p_user_id and e.status='active'
       and e.expires_at > pg_catalog.now()
       and (p_track_id is null or e.track_id=p_track_id)
    union all
    select g.track_id::text,g.expires_at
      from public.google_play_entitlements g
     where g.user_id=p_user_id and g.status='active'
       and g.expires_at > pg_catalog.now()
       and (p_track_id is null or g.track_id=p_track_id)
    union all
    select l.track_id::text,'9999-12-31 23:59:59+00'::timestamptz
      from public.lifetime_entitlements l
     where l.user_id=p_user_id and l.status='active'
       and (p_track_id is null or l.track_id=p_track_id)
  ) grants
  where grants.track_id in (
    'DECK_OIC_NW','ENGINE_OIC_EW','DECK_MGT','ENGINE_MGT','GMDSS_GOC'
  )
  group by grants.track_id
$$;

revoke all on function public.get_active_paid_track_entitlements(uuid,text)
  from public,anon,authenticated;
grant execute on function public.get_active_paid_track_entitlements(uuid,text)
  to service_role;

commit;
