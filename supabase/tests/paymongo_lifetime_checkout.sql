-- Synthetic PayMongo lifetime order/replay tests. No real money, no user data.
begin;

insert into auth.users(id) values
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222')
on conflict do nothing;

do $lifetime_paymongo$
declare
  v_owner uuid := '11111111-1111-4111-8111-111111111111';
  v_other uuid := '22222222-2222-4222-8222-222222222222';
  v_order uuid;
  v_duplicate_order uuid;
  v_result jsonb;
  v_granted int;
  v_ref1 text := repeat('a',64);
  v_ref2 text := repeat('b',64);
begin
  insert into public.lifetime_orders(
    user_id,product_code,track_id,amount_php,status,paymongo_livemode,
    paymongo_checkout_session_id
  ) values (
    v_owner,'gmdss','GMDSS_GOC',599,'pending',false,'cs_lifetime_test_1'
  ) returning id into v_order;

  -- The provider amount/mode/session is never sourced from browser inputs.
  begin
    perform public.finalize_paymongo_lifetime_checkout(
      v_order,'cs_lifetime_test_1','pay_lifetime_test_1',v_ref1,59800,'PHP',false
    );
    raise exception 'Wrong PHP amount was accepted';
  exception when sqlstate '23514' then null; end;
  begin
    perform public.finalize_paymongo_lifetime_checkout(
      v_order,'cs_wrong','pay_lifetime_test_1',v_ref1,59900,'PHP',false
    );
    raise exception 'Wrong session was accepted';
  exception when sqlstate '23514' then null; end;
  begin
    perform public.finalize_paymongo_lifetime_checkout(
      v_order,'cs_lifetime_test_1','pay_lifetime_test_1',v_ref1,59900,'USD',false
    );
    raise exception 'Wrong currency was accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.finalize_paymongo_lifetime_checkout(
      v_order,'cs_lifetime_test_1','pay_lifetime_test_1',v_ref1,59900,'PHP',true
    );
    raise exception 'Wrong live/test mode was accepted';
  exception when sqlstate '23514' then null; end;

  if exists(select 1 from public.lifetime_entitlements
    where user_id=v_owner and product_code='gmdss') then
    raise exception 'Bad payment accidentally created Lifetime Access';
  end if;

  v_result := public.finalize_paymongo_lifetime_checkout(
    v_order,'cs_lifetime_test_1','pay_lifetime_test_1',v_ref1,59900,'PHP',false
  );
  if v_result->>'status' <> 'paid' or v_result->>'duplicate' <> 'false'
    or (select status from public.lifetime_orders where id=v_order) <> 'paid'
    or not exists (
      select 1 from public.get_active_paid_track_entitlements(v_owner,'GMDSS_GOC')
    ) then
    raise exception 'Verified paid Lifetime Access was not granted atomically';
  end if;

  v_result := public.finalize_paymongo_lifetime_checkout(
    v_order,'cs_lifetime_test_1','pay_lifetime_test_1',v_ref1,59900,'PHP',false
  );
  if v_result->>'duplicate' <> 'true' then
    raise exception 'Duplicate webhook was not recognized';
  end if;

  begin
    perform public.finalize_paymongo_lifetime_checkout(
      v_order,'cs_lifetime_test_1','pay_second_different',v_ref2,59900,'PHP',false
    );
    raise exception 'Second paid receipt was accepted on same checkout';
  exception when sqlstate '23505' then null; end;

  -- An unrelated signed refund must not mark the already-paid original
  -- receipt refunded during replay of a second payment ID.
  if public.revoke_paymongo_lifetime_checkout('pay_second_different') then
    raise exception 'An unknown second payment refund matched the original order';
  end if;
  begin
    perform public.finalize_paymongo_lifetime_checkout(
      v_order,'cs_lifetime_test_1','pay_second_different',v_ref2,59900,'PHP',false
    );
    raise exception 'A refunded second payment overwrote the original receipt';
  exception when sqlstate '23505' then null; end;
  if not exists (
    select 1 from public.get_active_paid_track_entitlements(v_owner,'GMDSS_GOC')
  ) or (select status from public.lifetime_orders where id=v_order) <> 'paid' then
    raise exception 'Refund of a different receipt revoked the valid paid purchase';
  end if;

  -- Another checkout that got paid despite a previously fulfilled lifetime
  -- purchase must be flagged for customer support; never unlock twice.
  insert into public.lifetime_orders(
    user_id,product_code,track_id,amount_php,status,paymongo_livemode,
    paymongo_checkout_session_id
  ) values(
    v_owner,'gmdss','GMDSS_GOC',599,'pending',false,'cs_lifetime_test_2'
  ) returning id into v_duplicate_order;

  begin
    insert into public.lifetime_orders(
      user_id,product_code,track_id,amount_php,status,paymongo_livemode
    ) values (v_owner,'gmdss','GMDSS_GOC',599,'pending',false);
    raise exception 'Concurrent duplicate pending checkout accepted';
  exception when sqlstate '23505' then null; end;

  v_result := public.finalize_paymongo_lifetime_checkout(
    v_duplicate_order,'cs_lifetime_test_2','pay_lifetime_test_2',v_ref2,59900,'PHP',false
  );
  if v_result->>'status'<>'reconciliation_required' then
    raise exception 'Double charge was not marked for reconciliation';
  end if;

  if not public.revoke_paymongo_lifetime_checkout('pay_lifetime_test_2') then
    raise exception 'Duplicate payment refund failed';
  end if;
  if not exists(
    select 1 from public.get_active_paid_track_entitlements(v_owner,'GMDSS_GOC')
  ) then
    raise exception 'Refunding a duplicate payment revoked the original purchase';
  end if;

  if not public.revoke_paymongo_lifetime_checkout('pay_lifetime_test_1') then
    raise exception 'Original payment refund failed';
  end if;
  if exists(
    select 1 from public.get_active_paid_track_entitlements(v_owner,'GMDSS_GOC')
  ) or not exists(
    select 1 from public.get_learning_progress_owned_tracks(v_owner) where track_id='GMDSS_GOC'
  ) then
    raise exception 'Refund failed to revoke access or erased historical progress rights';
  end if;
  if not public.revoke_paymongo_lifetime_checkout('pay_lifetime_test_1') then
    raise exception 'Repeat refund was not idempotent';
  end if;
  v_result := public.finalize_paymongo_lifetime_checkout(
    v_order,'cs_lifetime_test_1','pay_lifetime_test_1',v_ref1,59900,'PHP',false
  );
  if v_result->>'status' <> 'refunded' or exists(
    select 1 from public.get_active_paid_track_entitlements(v_owner,'GMDSS_GOC')
  ) then
    raise exception 'Delayed paid webhook resurrected a refunded purchase';
  end if;

  -- The signed refund may be delivered BEFORE a delayed paid webhook.
  -- Record it, then verify the paid event cannot ever activate the receipt.
  if public.revoke_paymongo_lifetime_checkout('pay_refund_before_paid') then
    raise exception 'Unknown refund was falsely matched to an existing order';
  end if;
  insert into public.lifetime_orders (
    user_id,product_code,track_id,amount_php,status,paymongo_livemode,
    paymongo_checkout_session_id
  ) values (
    v_other,'engine_ew','ENGINE_OIC_EW',999,'pending',false,'cs_refund_before_paid'
  ) returning id into v_duplicate_order;
  v_result := public.finalize_paymongo_lifetime_checkout(
    v_duplicate_order,'cs_refund_before_paid','pay_refund_before_paid',
    repeat('c',64),99900,'PHP',false
  );
  if v_result->>'status' <> 'refunded'
     or (select status from public.lifetime_orders where id=v_duplicate_order) <> 'refunded'
     or exists(select 1 from public.get_active_paid_track_entitlements(v_other,'ENGINE_OIC_EW')) then
    raise exception 'Refund preceding paid webhook activated permanent access';
  end if;
  v_result := public.finalize_paymongo_lifetime_checkout(
    v_duplicate_order,'cs_refund_before_paid','pay_refund_before_paid',
    repeat('c',64),99900,'PHP',false
  );
  if v_result->>'status' <> 'refunded' then
    raise exception 'Replayed paid webhook resurrected pre-refunded receipt';
  end if;

  if exists(select 1 from public.get_active_paid_track_entitlements(v_other)) then
    raise exception 'Another account inherited lifetime access';
  end if;
  select count(*) into v_granted from public.lifetime_entitlements
   where user_id=v_owner and product_code='gmdss';
  if v_granted <> 1 then raise exception 'Payment retries created duplicate ownership rows'; end if;

  -- Server price/track checks reject unsupported SKUs even if a buggy Edge
  -- caller attempts to insert them.
  begin
    insert into public.lifetime_orders(
      user_id,product_code,track_id,amount_php,status,paymongo_livemode
    ) values(v_other,'gmdss','GMDSS_GOC',25,'pending',false);
    raise exception 'Subscription price was accepted as lifetime';
  exception when sqlstate '23514' then null; end;
end $lifetime_paymongo$;

do $lifetime_permissions$
begin
  if pg_catalog.has_function_privilege('authenticated',
       'public.finalize_paymongo_lifetime_checkout(uuid,text,text,text,bigint,text,boolean)','EXECUTE')
    or pg_catalog.has_function_privilege('anon',
       'public.finalize_paymongo_lifetime_checkout(uuid,text,text,text,bigint,text,boolean)','EXECUTE')
    or pg_catalog.has_function_privilege('authenticated',
       'public.revoke_paymongo_lifetime_checkout(text)','EXECUTE')
    or pg_catalog.has_table_privilege('authenticated','public.lifetime_orders','INSERT')
    or pg_catalog.has_table_privilege('authenticated','public.lifetime_orders','UPDATE')
    or pg_catalog.has_table_privilege('authenticated','public.lifetime_paymongo_refunds','INSERT')
    or pg_catalog.has_table_privilege('authenticated','public.lifetime_paymongo_refunds','SELECT')
    or not pg_catalog.has_table_privilege('authenticated','public.lifetime_orders','SELECT')
  then raise exception 'Lifetime checkout exposed service-only write privileges';
  end if;
end $lifetime_permissions$;

rollback;
