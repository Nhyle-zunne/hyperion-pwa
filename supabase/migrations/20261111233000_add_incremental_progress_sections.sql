begin;
set local lock_timeout = '5s';

-- Incremental operations are an additive protocol. Existing progress rows,
-- revisions, session archives and the full snapshot write contract are intact.
-- All access is through the JWT-validated learning-progress Edge Function.
create table if not exists public.user_learning_progress_section_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  request_hash text not null check (length(request_hash)=32),
  response jsonb not null check (jsonb_typeof(response)='object'),
  acknowledged_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);
alter table public.user_learning_progress_section_operations enable row level security;
revoke all on public.user_learning_progress_section_operations from public, anon, authenticated;
grant all on public.user_learning_progress_section_operations to service_role;

-- Section versions are opaque owner-bound content hashes, not access tokens.
-- They naturally change after an older full-snapshot client writes that key,
-- and never change after a different section is updated.
create or replace function public.learning_progress_section_version(
  p_user_id uuid, p_key text, p_section jsonb
) returns text
language sql immutable set search_path = ''
as $section_version$
  -- Old native/PWA full writes can reformat JSON strings even when a section's
  -- actual objects and arrays did not change. Use parsed, canonical jsonb for
  -- section fingerprints, retaining array order and every real value change.
  select md5(p_user_id::text || '|' || p_key || '|' || coalesce(
    case when jsonb_typeof(p_section)='string'
      then coalesce(public.progress_json_or_null(p_section #>> '{}')::text,p_section::text)
      else p_section::text end, '<ABSENT>'));
$section_version$;
revoke all on function public.learning_progress_section_version(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.learning_progress_section_version(uuid,text,jsonb) to service_role;

create or replace function public.read_learning_progress_sections(
  p_user_id uuid, p_keys text[]
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  progress_data jsonb;
  progress_updated timestamptz;
  requested_key text;
  values_by_key jsonb := '{}'::jsonb;
  versions jsonb := '{}'::jsonb;
  previous_value jsonb;
  allowed text[] := array[
    'hyperion-history', 'hyperion-study-time', 'hyperion-vault',
    'hyperion-bookmarks', 'hyperion-saved-practice',
    'hyperion-mock-exam-plan-v1', 'hyperion-question-attempt-history',
    'hyperion-progress-deletions'
  ];
begin
  if p_user_id is null or p_keys is null or
    array_length(p_keys,1) is null or array_length(p_keys,1)>8 or
    exists(select 1 from unnest(p_keys) k where k is null or not (k=any(allowed))) or
    (select count(distinct k) from unnest(p_keys) k) <> array_length(p_keys,1)
  then
    raise exception using errcode='22023',message='Invalid incremental progress section request.';
  end if;
  select data,updated_at into progress_data,progress_updated
  from public.user_learning_progress where user_id=p_user_id;
  foreach requested_key in array p_keys loop
    previous_value := progress_data->'storage'->requested_key;
    values_by_key := jsonb_set(values_by_key,array[requested_key],coalesce(previous_value,'null'::jsonb),true);
    versions := jsonb_set(versions,array[requested_key],
      to_jsonb(public.learning_progress_section_version(p_user_id,requested_key,previous_value)),true);
  end loop;
  return jsonb_build_object('storage',values_by_key,'versions',versions,'updated_at',progress_updated);
end $$;
revoke all on function public.read_learning_progress_sections(uuid,text[]) from public,anon,authenticated;
grant execute on function public.read_learning_progress_sections(uuid,text[]) to service_role;

create or replace function public.write_learning_progress_sections(
  p_user_id uuid, p_operation_id uuid, p_updates jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  allowed text[] := array[
    'hyperion-history', 'hyperion-study-time', 'hyperion-vault',
    'hyperion-bookmarks', 'hyperion-saved-practice',
    'hyperion-mock-exam-plan-v1', 'hyperion-question-attempt-history',
    'hyperion-progress-deletions'
  ];
  operation_hash text;
  cached_hash text;
  cached_ack jsonb;
  current_data jsonb;
  next_data jsonb;
  next_storage jsonb;
  previous_section jsonb;
  element jsonb;
  k text;
  expected text;
  new_value jsonb;
  collisions text[] := array[]::text[];
  changed_keys text[] := array[]::text[];
  return_versions jsonb := '{}'::jsonb;
  result jsonb;
  updated timestamptz;
begin
  if p_user_id is null or p_operation_id is null or
     p_updates is null or jsonb_typeof(p_updates)<>'array' or
     jsonb_array_length(p_updates) not between 1 and 8 then
    return jsonb_build_object('invalid_operation',true);
  end if;
  -- Validate the complete batch before writing even the first section.
  for element in select value from jsonb_array_elements(p_updates) loop
    if jsonb_typeof(element)<>'object' or
       element->>'key' is null or not(element->>'key'=any(allowed)) or
       not(element ? 'value') or
       jsonb_typeof(element->'value') not in ('string','null') or
       not(element ? 'expected_version') or
       jsonb_typeof(element->'expected_version')<>'string' or
       length(element->>'expected_version')<>32 or
       (jsonb_typeof(element->'value')='string' and
         octet_length(element->>'value')>524288) or
       element->>'key'=any(changed_keys) then
      return jsonb_build_object('invalid_operation',true);
    end if;
    changed_keys := array_append(changed_keys,element->>'key');
  end loop;

  operation_hash := md5(p_updates::text);
  -- Do not create even an empty progress row for an invalid/stale first write.
  -- The canonical user row is also the serialization point for old full writers.
  select data,updated_at into current_data,updated from public.user_learning_progress
    where user_id=p_user_id for update;
  if not found then
    foreach element in array array(select value from jsonb_array_elements(p_updates)) loop
      k := element->>'key';
      if public.learning_progress_section_version(p_user_id,k,null) is distinct from
        element->>'expected_version' then
        collisions := array_append(collisions,k);
      end if;
    end loop;
    if array_length(collisions,1)>0 then
      return jsonb_build_object('conflicts',to_jsonb(collisions));
    end if;
    insert into public.user_learning_progress(user_id,data)
      values(p_user_id,jsonb_build_object('version',1,'savedAt',0,
        'changedSections','[]'::jsonb,'activeSessionChangedAt',0,
        'activeSession','null'::jsonb,'storage','{}'::jsonb))
      on conflict (user_id) do nothing;
    select data,updated_at into current_data,updated from public.user_learning_progress
      where user_id=p_user_id for update;
  end if;
  if not found then
    raise exception using errcode='22023',message='Progress owner is not available.';
  end if;

  select request_hash,response into cached_hash,cached_ack
  from public.user_learning_progress_section_operations
  where user_id=p_user_id and operation_id=p_operation_id;
  if found then
    if cached_hash<>operation_hash then return jsonb_build_object('invalid_operation',true); end if;
    return cached_ack;
  end if;

  foreach element in array array(select value from jsonb_array_elements(p_updates)) loop
    k := element->>'key';
    previous_section := current_data->'storage'->k;
    expected := public.learning_progress_section_version(p_user_id,k,previous_section);
    if expected is distinct from element->>'expected_version' then
      collisions := array_append(collisions,k);
    end if;
  end loop;
  if array_length(collisions,1)>0 then
    -- No receipts on conflict: the caller must rebase and retry with a fresh
    -- operation ID. No part of a conflicting batch is applied.
    return jsonb_build_object('conflicts',to_jsonb(collisions));
  end if;

  next_storage := coalesce(current_data->'storage','{}'::jsonb);
  foreach element in array array(select value from jsonb_array_elements(p_updates)) loop
    k := element->>'key';
    new_value := element->'value';
    next_storage := jsonb_set(next_storage,array[k],new_value,true);
  end loop;
  next_data := jsonb_set(current_data,array['storage'],next_storage,true);

  if next_data is distinct from current_data then
    -- The existing BEFORE UPDATE preserve_learning_progress trigger validates
    -- and merges bookmark/mistake records, deletion markers and audit history,
    -- and retains old full recovery points.
    update public.user_learning_progress set data=next_data
      where user_id=p_user_id returning data,updated_at into current_data,updated;
  end if;

  foreach k in array changed_keys loop
    return_versions := jsonb_set(return_versions,array[k],to_jsonb(
      public.learning_progress_section_version(p_user_id,k,current_data->'storage'->k)),true);
  end loop;
  result := jsonb_build_object('ok',true,'operation_id',p_operation_id,
    'versions',return_versions,'updated_at',updated);
  insert into public.user_learning_progress_section_operations
    (user_id,operation_id,request_hash,response)
    values(p_user_id,p_operation_id,operation_hash,result);
  return result;
end $$;
revoke all on function public.write_learning_progress_sections(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.write_learning_progress_sections(uuid,uuid,jsonb) to service_role;
commit;
