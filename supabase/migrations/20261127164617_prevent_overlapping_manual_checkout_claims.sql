-- Prevent multiple open payment requests for the same reviewer track, even
-- when the customer changes the duration or includes it in another cart.
-- The original function still owns price, entitlement and order validation.
begin;

create function public.create_manual_checkout_claim_unique_tracks(p_user_id uuid, p_selection text)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','pg_temp'
as $$
declare
  v_selection_key text;
  v_codes text[];
begin
  if p_user_id is null or nullif(p_selection,'') is null or length(p_selection)>200 then
    raise exception 'Invalid checkout selection' using errcode='22023';
  end if;
  select string_agg(part,',' order by part), array_agg(split_part(part,':',1))
    into v_selection_key,v_codes from unnest(string_to_array(p_selection,',')) part;

  -- Match the existing claim function's account locks to serialize requests.
  perform pg_advisory_xact_lock(hashtextextended('hyperion-checkout-account:'||p_user_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('hyperion-manual-cart:'||p_user_id::text,0));
  if exists (
    select 1 from public.manual_checkout_claims claim
    where claim.user_id=p_user_id and claim.selection_key=v_selection_key
      and (claim.status='pending_verification'
        or (claim.status='awaiting_proof' and claim.expires_at>now()))
  ) then
    return public.create_manual_checkout_claim(p_user_id,p_selection);
  end if;
  if exists (
    select 1 from public.manual_checkout_claims claim
    where claim.user_id=p_user_id and claim.selection_key<>v_selection_key
      and (claim.status='pending_verification'
        or (claim.status='awaiting_proof' and claim.expires_at>now()))
      and exists (
        select 1 from jsonb_array_elements(claim.items) item
        where item->>'code'=any(v_codes)
      )
  ) then
    raise exception 'A payment request is already pending for one of these tracks. Do not pay again.' using errcode='23514';
  end if;
  return public.create_manual_checkout_claim(p_user_id,p_selection);
end;
$$;

revoke all on function public.create_manual_checkout_claim_unique_tracks(uuid,text) from public,anon,authenticated;
grant execute on function public.create_manual_checkout_claim_unique_tracks(uuid,text) to service_role;
commit;
