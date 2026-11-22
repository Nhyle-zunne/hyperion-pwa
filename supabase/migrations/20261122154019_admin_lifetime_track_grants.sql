begin;

alter table public.lifetime_entitlements
  drop constraint lifetime_entitlements_provider_check,
  add constraint lifetime_entitlements_provider_check
    check (provider in ('paymongo', 'google_play', 'admin'));

alter table public.license_admin_audit
  drop constraint license_admin_audit_license_term_check,
  add constraint license_admin_audit_license_term_check
    check (license_term is null or license_term in ('week', 'month', 'year', 'lifetime'));

create or replace function public.set_admin_lifetime_entitlement(
  p_user_id uuid, p_product_code text, p_active boolean,
  p_admin_user_id uuid, p_admin_email text, p_note text
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_track text;
  v_ref text;
  v_prior text;
  v_status text;
  v_now timestamptz := pg_catalog.now();
begin
  v_track := case p_product_code
    when 'oic_nw' then 'DECK_OIC_NW'
    when 'engine_ew' then 'ENGINE_OIC_EW'
    when 'deck_mgt' then 'DECK_MGT'
    when 'engine_mgt' then 'ENGINE_MGT'
    when 'gmdss' then 'GMDSS_GOC'
  end;
  if p_user_id is null or v_track is null or p_active is null
     or p_admin_user_id is null or coalesce(p_admin_email, '') = '' then
    raise exception 'Invalid manual lifetime license change' using errcode = '22023';
  end if;

  v_ref := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(p_user_id::text || ':' || p_product_code, 'UTF8')), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hyperion-admin-lifetime:' || v_ref, 0));
  select status into v_prior from public.lifetime_entitlements
    where provider = 'admin' and purchase_ref_sha256 = v_ref
      and user_id = p_user_id and product_code = p_product_code;
  v_status := case when p_active then 'active' else 'revoked' end;
  if v_prior = v_status or (not p_active and v_prior is null) then
    return false;
  end if;

  insert into public.lifetime_entitlements
    (user_id, product_code, track_id, provider, purchase_ref_sha256, status, purchased_at, revoked_at, updated_at)
  values (p_user_id, p_product_code, v_track, 'admin', v_ref, v_status, v_now,
    case when p_active then null else v_now end, v_now)
  on conflict (provider, purchase_ref_sha256) do update
    set status = excluded.status, revoked_at = excluded.revoked_at, updated_at = excluded.updated_at,
        purchased_at = case when p_active then v_now else lifetime_entitlements.purchased_at end
    where lifetime_entitlements.user_id = excluded.user_id
      and lifetime_entitlements.product_code = excluded.product_code;
  if not found then
    raise exception 'Manual lifetime license does not match account and track' using errcode = '23505';
  end if;

  insert into public.license_admin_audit
    (user_id, product_code, track_id, action, prior_status, new_status, license_term,
     admin_user_id, admin_email, note)
  values (p_user_id, p_product_code, v_track, case when p_active then 'grant' else 'revoke' end,
    coalesce(v_prior, 'none'), v_status, 'lifetime', p_admin_user_id, p_admin_email, p_note);
  return true;
end;
$$;

revoke all on function public.set_admin_lifetime_entitlement(uuid,text,boolean,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.set_admin_lifetime_entitlement(uuid,text,boolean,uuid,text,text)
  to service_role;

commit;
