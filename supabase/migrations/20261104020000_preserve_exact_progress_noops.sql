-- Follow-up: leave pre-existing collection order and absent collections alone on no-ops.
create or replace function public.preserve_learning_progress() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception using errcode='22023',message='Progress ownership cannot be changed.';
  end if;
  -- Existing snapshots need not be reordered/canonicalized on an actual no-op.
  if public.canonical_learning_progress(new.data) = public.canonical_learning_progress(old.data) then
    return new;
  end if;
  new.data := public.prepare_learning_progress(old.data,new.data);
  if public.canonical_learning_progress(new.data) is distinct from public.canonical_learning_progress(old.data) then
    insert into public.user_learning_progress_revisions(user_id,data) values(old.user_id,old.data);
  end if;
  -- Deliberately no pruning: historical cleanup requires a verified backup and
  -- explicit owner approval. Every full recovery point remains independently usable.
  return new;
end $$;
revoke all on function public.preserve_learning_progress() from public, anon, authenticated;
grant execute on function public.preserve_learning_progress() to service_role;

create or replace function public.compare_user_learning_progress(p_user_id uuid,p_expected_updated_at timestamptz,p_data jsonb)
returns text language plpgsql stable security definer set search_path = '' as $$
declare current_row public.user_learning_progress%rowtype;
begin
  select * into current_row from public.user_learning_progress where user_id=p_user_id;
  if not found then return case when p_expected_updated_at is null then 'missing' else 'conflict' end; end if;
  if p_expected_updated_at is null or current_row.updated_at<>p_expected_updated_at then return 'conflict'; end if;
  if public.canonical_learning_progress(p_data) = public.canonical_learning_progress(current_row.data) then return 'unchanged'; end if;
  if public.canonical_learning_progress(public.prepare_learning_progress(current_row.data,p_data)) = public.canonical_learning_progress(current_row.data) then return 'unchanged'; end if;
  return 'changed';
end $$;
revoke all on function public.compare_user_learning_progress(uuid,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.compare_user_learning_progress(uuid,timestamptz,jsonb) to service_role;
