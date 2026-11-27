-- Customer cancellation withdraws only an unverified manual payment request.
-- Preserve the claim for audit, and never reverse a bank transfer or license.
begin;

alter table public.manual_checkout_claims
  drop constraint manual_checkout_claims_status_check,
  add constraint manual_checkout_claims_status_check
    check (status in ('awaiting_proof','pending_verification','approved','rejected','expired','cancelled'));

create function public.cancel_manual_checkout_claim(p_user_id uuid,p_claim_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','pg_temp'
as $$
declare
  v_claim public.manual_checkout_claims%rowtype;
begin
  if p_user_id is null or p_claim_id is null then
    raise exception 'Invalid payment request' using errcode='22023';
  end if;
  if not exists (select 1 from public.manual_checkout_claims
    where id=p_claim_id and user_id=p_user_id) then
    raise exception 'Payment request not found' using errcode='P0002';
  end if;

  -- The same owner lock protects admin approval, checkout and account deletion.
  perform pg_advisory_xact_lock(hashtextextended('hyperion-checkout-account:'||p_user_id::text,0));
  select * into v_claim from public.manual_checkout_claims
    where id=p_claim_id and user_id=p_user_id for update;
  if not found then raise exception 'Payment request not found' using errcode='P0002'; end if;
  if v_claim.status <> 'awaiting_proof' or v_claim.proof_received_at is not null
     or v_claim.expires_at <= now() then
    raise exception 'Payment request can no longer be cancelled. Contact Hyperion on Messenger.'
      using errcode='23514';
  end if;

  update public.manual_checkout_claims
    set status='cancelled',updated_at=now()
    where id=p_claim_id;
  return jsonb_build_object('ok',true,'status','cancelled','claimId',p_claim_id);
end;
$$;

revoke all on function public.cancel_manual_checkout_claim(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cancel_manual_checkout_claim(uuid,uuid) to service_role;

commit;
