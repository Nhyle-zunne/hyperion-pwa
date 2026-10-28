
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
     where name = 'hyperion_supabase_project_url'
  ) then
    perform vault.create_secret(
      'https://evnjoezffghtrzqacwcj.supabase.co',
      'hyperion_supabase_project_url',
      'Project URL for the scheduled Hyperion abandoned-checkout cleanup'
    );
  end if;

  if not exists (
    select 1 from vault.decrypted_secrets
     where name = 'hyperion_abandoned_checkout_cron_token'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'hyperion_abandoned_checkout_cron_token',
      'Private bearer token for scheduled abandoned-checkout cleanup'
    );
  end if;
end;
$$;

create or replace function public.verify_abandoned_checkout_cron_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'vault'
as $function$
  select p_token is not null and exists (
    select 1
      from vault.decrypted_secrets
     where name = 'hyperion_abandoned_checkout_cron_token'
       and decrypted_secret = p_token
  );
$function$;

revoke all on function public.verify_abandoned_checkout_cron_token(text) from public, anon, authenticated;
grant execute on function public.verify_abandoned_checkout_cron_token(text) to service_role;

create or replace function public.mark_abandoned_paymongo_checkout_failed(
  p_checkout_reference uuid,
  p_checkout_session_id text,
  p_is_batch boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
set "TimeZone" to 'UTC'
as $function$
declare
  v_batch public.checkout_batches%rowtype;
  v_order public.orders%rowtype;
  v_updated_id uuid;
begin
  if p_checkout_reference is null
     or nullif(trim(p_checkout_session_id), '') is null
     or p_is_batch is null then
    raise exception 'Invalid abandoned-checkout cleanup request' using errcode = '22023';
  end if;

  if p_is_batch then
    select * into v_batch
      from public.checkout_batches
     where id = p_checkout_reference
     for update;

    if not found then
      return jsonb_build_object('status', 'not_found');
    end if;
    if v_batch.paymongo_checkout_session_id is distinct from p_checkout_session_id
       or v_batch.payment_method is distinct from 'PayMongo Checkout' then
      return jsonb_build_object('status', 'session_mismatch');
    end if;
    if v_batch.status = 'paid' then
      return jsonb_build_object('status', 'already_paid');
    end if;
    if v_batch.status <> 'pending' then
      return jsonb_build_object('status', 'not_pending', 'currentStatus', v_batch.status);
    end if;
    if v_batch.created_at > now() - interval '12 hours' then
      return jsonb_build_object('status', 'too_young');
    end if;

    update public.checkout_batches
       set status = 'failed'
     where id = v_batch.id
       and status = 'pending'
       and created_at <= now() - interval '12 hours'
       and paymongo_checkout_session_id = p_checkout_session_id
     returning id into v_updated_id;

    if v_updated_id is null then
      return jsonb_build_object('status', 'state_changed');
    end if;

    update public.orders
       set status = 'failed'
     where checkout_batch_id = v_batch.id
       and user_id = v_batch.user_id
       and payment_method = 'PayMongo Checkout'
       and status = 'pending';

    return jsonb_build_object('status', 'failed', 'orderId', v_batch.id, 'isBatch', true);
  end if;

  select * into v_order
    from public.orders
   where id = p_checkout_reference
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_order.checkout_batch_id is not null
     or v_order.paymongo_checkout_session_id is distinct from p_checkout_session_id
     or v_order.payment_method is distinct from 'PayMongo Checkout' then
    return jsonb_build_object('status', 'session_mismatch');
  end if;
  if v_order.status = 'paid' then
    return jsonb_build_object('status', 'already_paid');
  end if;
  if v_order.status <> 'pending' then
    return jsonb_build_object('status', 'not_pending', 'currentStatus', v_order.status);
  end if;
  if v_order.created_at > now() - interval '12 hours' then
    return jsonb_build_object('status', 'too_young');
  end if;

  update public.orders
     set status = 'failed'
   where id = v_order.id
     and status = 'pending'
     and created_at <= now() - interval '12 hours'
     and paymongo_checkout_session_id = p_checkout_session_id
     and checkout_batch_id is null
   returning id into v_updated_id;

  if v_updated_id is null then
    return jsonb_build_object('status', 'state_changed');
  end if;

  return jsonb_build_object('status', 'failed', 'orderId', v_order.id, 'isBatch', false);
end;
$function$;

revoke all on function public.mark_abandoned_paymongo_checkout_failed(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.mark_abandoned_paymongo_checkout_failed(uuid, text, boolean) to service_role;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job
     where jobname = 'hyperion-expire-abandoned-paymongo-checkouts'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'hyperion-expire-abandoned-paymongo-checkouts',
    '*/5 * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'hyperion_supabase_project_url')
          || '/functions/v1/expire-abandoned-checkouts',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-hyperion-cron-token',
          (select decrypted_secret from vault.decrypted_secrets where name = 'hyperion_abandoned_checkout_cron_token')
        ),
        body := jsonb_build_object('source', 'pg_cron', 'requested_at', now()),
        timeout_milliseconds := 5000
      ) as request_id;
    $job$
  );
end;
$$;
