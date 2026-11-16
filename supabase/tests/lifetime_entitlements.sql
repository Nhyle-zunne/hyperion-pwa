-- All tests use synthetic users and are rolled back.
begin;

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222')
on conflict do nothing;

do $lifetime$
declare
  v_a uuid := '11111111-1111-4111-8111-111111111111';
  v_b uuid := '22222222-2222-4222-8222-222222222222';
  v_receipt text := repeat('a',64);
  v_expiry timestamptz;
  v_count int;
begin
  -- Existing subscriptions remain independent of lifetime ownership.
  perform public.record_verified_lifetime_entitlement(v_a,'gmdss','paymongo',v_receipt,'active');
  select expires_at into v_expiry from public.get_active_paid_track_entitlements(v_a,'GMDSS_GOC');
  if v_expiry is distinct from '9999-12-31 23:59:59+00'::timestamptz then
    raise exception 'Lifetime grants did not appear in the current active license reader';
  end if;

  perform public.record_verified_lifetime_entitlement(v_a,'gmdss','paymongo',v_receipt,'active');
  select count(*) into v_count from public.lifetime_entitlements
    where user_id=v_a and product_code='gmdss';
  if v_count <> 1 then raise exception 'Retry duplicated lifetime entitlement'; end if;

  -- Cross-account and cross-product replays are forbidden.
  begin
    perform public.record_verified_lifetime_entitlement(v_b,'gmdss','paymongo',v_receipt,'active');
    raise exception 'Receipt was stolen by another account';
  exception when sqlstate '23505' then null;
  end;
  begin
    perform public.record_verified_lifetime_entitlement(v_a,'oic_nw','paymongo',v_receipt,'active');
    raise exception 'Receipt was reused on another product';
  exception when sqlstate '23505' then null;
  end;

  perform public.record_verified_lifetime_entitlement(v_a,'gmdss','paymongo',v_receipt,'revoked');
  if exists (select 1 from public.get_active_paid_track_entitlements(v_a,'GMDSS_GOC')) then
    raise exception 'Refunded lifetime license still active';
  end if;

  perform public.record_verified_lifetime_entitlement(v_a,'gmdss','paymongo',v_receipt,'active');
  if exists (select 1 from public.get_active_paid_track_entitlements(v_a,'GMDSS_GOC')) then
    raise exception 'Old payment replay resurrected revoked entitlement';
  end if;

  if not exists (select 1 from public.get_learning_progress_owned_tracks(v_a)
                 where track_id='GMDSS_GOC') then
    raise exception 'Refund wiped historical ownership needed for progress recovery';
  end if;

  -- No unrelated user or track can inherit lifetime access.
  if exists (select 1 from public.get_active_paid_track_entitlements(v_b))
     or exists (select 1 from public.get_active_paid_track_entitlements(v_a,'DECK_OIC_NW')) then
    raise exception 'Lifetime entitlement escaped owner/track scope';
  end if;

  begin
    perform public.record_verified_lifetime_entitlement(v_a,'all_access','google_play',repeat('b',64),'active');
    raise exception 'Inactive All Access product was accepted';
  exception when sqlstate '22023' then null;
  end;
end $lifetime$;

do $permissions$
begin
  if pg_catalog.has_function_privilege('anon',
      'public.record_verified_lifetime_entitlement(uuid,text,text,text,text)','EXECUTE')
    or pg_catalog.has_function_privilege('authenticated',
      'public.record_verified_lifetime_entitlement(uuid,text,text,text,text)','EXECUTE')
    or not pg_catalog.has_function_privilege('service_role',
      'public.record_verified_lifetime_entitlement(uuid,text,text,text,text)','EXECUTE')
    or pg_catalog.has_function_privilege('anon',
      'public.get_active_paid_track_entitlements(uuid,text)','EXECUTE')
    or pg_catalog.has_function_privilege('authenticated',
      'public.get_active_paid_track_entitlements(uuid,text)','EXECUTE')
    or pg_catalog.has_table_privilege('authenticated','public.lifetime_entitlements','INSERT')
    or pg_catalog.has_table_privilege('authenticated','public.lifetime_entitlements','UPDATE')
    or not pg_catalog.has_table_privilege('authenticated','public.lifetime_entitlements','SELECT') then
    raise exception 'Lifetime entitlements escaped service-only write permissions';
  end if;
end $permissions$;

rollback;
