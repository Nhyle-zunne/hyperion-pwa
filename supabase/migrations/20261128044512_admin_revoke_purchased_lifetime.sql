begin;

create function public.revoke_admin_purchased_lifetime(
  p_user_id uuid, p_product_code text, p_admin_user_id uuid, p_admin_email text, p_note text
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz;
begin
  if p_user_id is null or p_admin_user_id is null or coalesce(p_admin_email, '') = ''
     or p_product_code is null or p_product_code not in ('oic_nw', 'engine_ew', 'deck_mgt', 'engine_mgt', 'gmdss') then
    raise exception 'Invalid purchased lifetime license change' using errcode = '22023';
  end if;

  -- Use the same account and product lock as manual checkout approval.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_user_id::text), pg_catalog.hashtext(p_product_code)
  );
  v_now := pg_catalog.clock_timestamp();

  -- Keep receipt rows so provider reconciliation cannot reactivate a revoked purchase.
  with revoked as (
    update public.lifetime_entitlements
    set status = 'revoked', revoked_at = v_now, updated_at = v_now
    where user_id = p_user_id and product_code = p_product_code
      and provider <> 'admin' and status = 'active'
    returning track_id
  )
  insert into public.license_admin_audit
    (user_id, product_code, track_id, action, prior_status, new_status, license_term,
     admin_user_id, admin_email, note)
  select p_user_id, p_product_code, track_id, 'revoke', 'active', 'revoked', 'lifetime',
    p_admin_user_id, p_admin_email, pg_catalog.concat_ws(' ', 'Purchased lifetime access revoked.', nullif(p_note, ''))
  from revoked
  limit 1;

  return found;
end;
$$;

revoke all on function public.revoke_admin_purchased_lifetime(uuid,text,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.revoke_admin_purchased_lifetime(uuid,text,uuid,text,text)
  to service_role;

notify pgrst, 'reload schema';

commit;
