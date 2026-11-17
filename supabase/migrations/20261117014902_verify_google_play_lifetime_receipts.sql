begin;

-- Voided non-consumable Play tokens are terminal, including refunds that reach
-- RTDN before the authenticated Android device can link the purchase.
create table if not exists public.google_play_lifetime_voided_tokens (
  purchase_ref_sha256 text primary key
    check (purchase_ref_sha256 ~ '^[a-f0-9]{64}$'),
  voided_at timestamptz not null default now()
);
alter table public.google_play_lifetime_voided_tokens enable row level security;
revoke all on public.google_play_lifetime_voided_tokens from public, anon, authenticated;
grant select, insert on public.google_play_lifetime_voided_tokens to service_role;

-- Only a server-verified, account-bound Play receipt can call this RPC.
-- Serialize with voided RTDNs so payment/refund reordering never restores access.
create or replace function public.link_verified_google_play_lifetime(
  p_user_id uuid,
  p_product_code text,
  p_purchase_ref_sha256 text
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
begin
  if p_user_id is null
     or p_product_code not in ('oic_nw','gmdss','engine_ew','deck_mgt','engine_mgt')
     or p_purchase_ref_sha256 is null
     or p_purchase_ref_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid verified Google Play lifetime receipt' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hyperion-play-lifetime:' || p_purchase_ref_sha256,0)
  );
  if exists (select 1 from public.google_play_lifetime_voided_tokens
             where purchase_ref_sha256=p_purchase_ref_sha256) then
    return false;
  end if;
  return public.record_verified_lifetime_entitlement(
    p_user_id,p_product_code,'google_play',p_purchase_ref_sha256,'active'
  );
end $$;
revoke all on function public.link_verified_google_play_lifetime(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.link_verified_google_play_lifetime(uuid,text,text)
  to service_role;

-- Invoke only after an authenticated Google Pub/Sub voided-purchase notification.
create or replace function public.record_voided_google_play_lifetime(
  p_purchase_ref_sha256 text
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
begin
  if p_purchase_ref_sha256 is null
     or p_purchase_ref_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid voided Google Play receipt' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hyperion-play-lifetime:' || p_purchase_ref_sha256,0)
  );
  insert into public.google_play_lifetime_voided_tokens(purchase_ref_sha256)
    values(p_purchase_ref_sha256) on conflict (purchase_ref_sha256) do nothing;
  update public.lifetime_entitlements
     set status='revoked',revoked_at=coalesce(revoked_at,pg_catalog.now()),
         updated_at=pg_catalog.now()
   where provider='google_play'
     and purchase_ref_sha256=p_purchase_ref_sha256
     and status='active';
  return true;
end $$;
revoke all on function public.record_voided_google_play_lifetime(text)
  from public,anon,authenticated;
grant execute on function public.record_voided_google_play_lifetime(text)
  to service_role;

commit;
