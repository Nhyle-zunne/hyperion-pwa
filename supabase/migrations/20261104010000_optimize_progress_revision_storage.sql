-- Schema-only initial optimization. Do not rewrite or prune any existing records.
create or replace function public.progress_json_or_null(p_text text)
returns jsonb language plpgsql immutable set search_path = '' as $$
begin
  return p_text::jsonb;
exception when data_exception then return null;
end $$;
revoke all on function public.progress_json_or_null(text) from public, anon, authenticated;
grant execute on function public.progress_json_or_null(text) to service_role;

-- Normalize only for equality. Full snapshots, array order and values are retained.
create or replace function public.canonical_learning_progress(p_data jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare result jsonb; k text; parsed jsonb;
begin
  result := p_data - 'savedAt' - 'changedSections';
  if jsonb_typeof(result->'storage') = 'object' then
    foreach k in array array['hyperion-history','hyperion-study-time','hyperion-bookmarks','hyperion-vault','hyperion-saved-practice','hyperion-mock-exam-plan-v1','hyperion-question-attempt-history','hyperion-progress-deletions'] loop
      if jsonb_typeof(result->'storage'->k) = 'string' then
        parsed := public.progress_json_or_null(result->'storage'->>k);
        if jsonb_typeof(parsed) in ('object','array') then
          result := jsonb_set(result,array['storage',k],parsed,true);
        end if;
      end if;
    end loop;
  end if;
  return result;
end $$;
revoke all on function public.canonical_learning_progress(jsonb) from public, anon, authenticated;
grant execute on function public.canonical_learning_progress(jsonb) to service_role;

create or replace function public.merge_learning_progress_deletions(p_previous text,p_incoming text)
returns text language plpgsql immutable set search_path = '' as $$
declare previous jsonb; incoming jsonb; result jsonb; collection text; markers jsonb;
begin
  if p_previous is null and p_incoming is null then return null; end if;
  previous := coalesce(public.progress_json_or_null(p_previous),'{}'::jsonb);
  incoming := coalesce(public.progress_json_or_null(p_incoming),'{}'::jsonb);
  if (p_previous is not null and (public.progress_json_or_null(p_previous) is null or jsonb_typeof(previous)<>'object')) or
     (p_incoming is not null and (public.progress_json_or_null(p_incoming) is null or jsonb_typeof(incoming)<>'object')) then
    raise exception using errcode='22023',message='Invalid progress deletion ledger; previous data is preserved.';
  end if;
  result := previous || incoming;
  foreach collection in array array['bookmarks','vault'] loop
    if not(previous ? collection or incoming ? collection) then continue; end if;
    if (previous ? collection and jsonb_typeof(previous->collection)<>'object') or
       (incoming ? collection and jsonb_typeof(incoming->collection)<>'object') then
      raise exception using errcode='22023',message='Invalid progress deletion collection.';
    end if;
    if exists(select 1 from (
      select value from jsonb_each(coalesce(previous->collection,'{}'::jsonb))
      union all select value from jsonb_each(coalesce(incoming->collection,'{}'::jsonb))
    ) items where jsonb_typeof(value)<>'object' or coalesce(value->>'at','') !~ '^[0-9]+([.][0-9]+)?$' or
      coalesce(value->>'deleted','') not in ('true','false')) then
      raise exception using errcode='22023',message='Invalid progress deletion marker.';
    end if;
    select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into markers from (
      select distinct on(key) key,value from (
        select key,value,0 priority from jsonb_each(coalesce(previous->collection,'{}'::jsonb))
        union all select key,value,1 priority from jsonb_each(coalesce(incoming->collection,'{}'::jsonb))
      ) candidates order by key,(value->>'at')::numeric desc,(value->>'deleted')::boolean desc,priority desc
    ) chosen;
    result := jsonb_set(result,array[collection],markers,true);
  end loop;
  return result::text;
end $$;
revoke all on function public.merge_learning_progress_deletions(text,text) from public, anon, authenticated;
grant execute on function public.merge_learning_progress_deletions(text,text) to service_role;

-- Effective stored data for both equality checks and the preservation trigger.
-- Missing fields are not deletions. Explicit valid nullable/array operations remain.
create or replace function public.prepare_learning_progress(p_previous jsonb,p_incoming jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare result jsonb; storage jsonb; incoming_storage jsonb; previous_storage jsonb;
  k text; field text; parsed jsonb; previous_parsed jsonb; ledger text; merged text;
begin
  if jsonb_typeof(p_incoming) is distinct from 'object' or p_incoming->>'version' is distinct from '1' or
     jsonb_typeof(p_incoming->'storage') is distinct from 'object' then
    raise exception using errcode='22023',message='Invalid progress snapshot; previous data is preserved.';
  end if;
  if p_incoming ? 'activeSessionChangedAt' and coalesce(p_incoming->>'activeSessionChangedAt','') !~ '^[0-9]+([.][0-9]+)?$' then
    raise exception using errcode='22023',message='Invalid active session clock.';
  end if;
  if p_incoming ? 'activeSession' and p_incoming->'activeSession'<>'null'::jsonb and (
    jsonb_typeof(p_incoming->'activeSession')<>'object' or
    jsonb_typeof(p_incoming->'activeSession'->'questions') is distinct from 'array' or
    jsonb_typeof(p_incoming->'activeSession'->'answers') is distinct from 'object'
  ) then
    raise exception using errcode='22023',message='Invalid active session snapshot.';
  end if;
  previous_storage := case when jsonb_typeof(p_previous->'storage')='object' then p_previous->'storage' else '{}'::jsonb end;
  incoming_storage := p_incoming->'storage';
  storage := previous_storage || incoming_storage;
  result := coalesce(p_previous,'{}'::jsonb) || p_incoming;
  -- Preserve state properties unknown to older clients (e.g. daily check-ins).
  foreach k in array array['hyperion-history','hyperion-study-time','hyperion-question-attempt-history'] loop
    if not(incoming_storage ? k) then continue; end if;
    if incoming_storage->k = 'null'::jsonb then
      if previous_storage ? k then storage := jsonb_set(storage,array[k],previous_storage->k,true); end if;
      continue;
    end if;
    if jsonb_typeof(incoming_storage->k)<>'string' then
      raise exception using errcode='22023',message='Invalid structured progress section.';
    end if;
    parsed := public.progress_json_or_null(incoming_storage->>k);
    if jsonb_typeof(parsed) is distinct from 'object' or jsonb_typeof(parsed->'state') is distinct from 'object' then
      raise exception using errcode='22023',message='Invalid structured progress state.';
    end if;
    foreach field in array case when k='hyperion-history' then array['entries','savedSessions'] when k='hyperion-study-time' then array['segments'] else array[]::text[] end loop
      if parsed->'state' ? field and jsonb_typeof(parsed->'state'->field)<>'array' then
        raise exception using errcode='22023',message='Invalid progress state collection.';
      end if;
    end loop;
    if k='hyperion-question-attempt-history' and parsed->'state' ? 'entries' and jsonb_typeof(parsed->'state'->'entries')<>'object' then
      raise exception using errcode='22023',message='Invalid question attempt state.';
    end if;
    foreach field in array case when k='hyperion-history' then array['entries','savedSessions'] when k='hyperion-study-time' then array['segments'] else array[]::text[] end loop
      if exists(select 1 from jsonb_array_elements(coalesce(parsed->'state'->field,'[]'::jsonb)) item
        where jsonb_typeof(item)<>'object' or jsonb_typeof(item->'id') is distinct from 'string' or btrim(item->>'id')='') then
        raise exception using errcode='22023',message='Invalid progress collection member.';
      end if;
    end loop;
    if k='hyperion-question-attempt-history' and exists(select 1 from jsonb_each(coalesce(parsed->'state'->'entries','{}'::jsonb)) item
      where jsonb_typeof(item.value)<>'object' or btrim(item.key)='') then
      raise exception using errcode='22023',message='Invalid question attempt member.';
    end if;
    previous_parsed := public.progress_json_or_null(previous_storage->>k);
    parsed := (case when jsonb_typeof(previous_parsed)='object' then previous_parsed else '{}'::jsonb end) || parsed;
    parsed := jsonb_set(parsed,array['state'],(case when jsonb_typeof(previous_parsed->'state')='object' then previous_parsed->'state' else '{}'::jsonb end) || (parsed->'state'),true);
    storage := jsonb_set(storage,array[k],to_jsonb(parsed::text),true);
  end loop;
  ledger := public.merge_learning_progress_deletions(previous_storage->>'hyperion-progress-deletions',incoming_storage->>'hyperion-progress-deletions');
  if ledger is not null then storage := jsonb_set(storage,array['hyperion-progress-deletions'],to_jsonb(ledger),true); end if;
  foreach k in array array['hyperion-bookmarks','hyperion-vault'] loop
    if incoming_storage ? k and incoming_storage->k <> 'null'::jsonb then
      parsed := public.progress_json_or_null(incoming_storage->>k);
      if jsonb_typeof(parsed) is distinct from 'object' or jsonb_typeof(parsed->'state'->'items') is distinct from 'array' then
        raise exception using errcode='22023',message='Invalid saved question collection.';
      end if;
    end if;
    merged := public.merge_preserved_progress_items(incoming_storage->>k,previous_storage->>k,ledger,case when k='hyperion-bookmarks' then 'bookmarks' else 'vault' end);
    storage := jsonb_set(storage,array[k],coalesce(to_jsonb(merged),'null'::jsonb),true);
  end loop;
  -- Expiry-filtered/older clients cannot silently erase a newer active session.
  if p_incoming ? 'activeSession' and p_incoming->'activeSession'='null'::jsonb and jsonb_typeof(p_previous->'activeSession')='object' and
     coalesce((p_incoming->>'activeSessionChangedAt')::numeric,0)<=coalesce((p_previous->>'activeSessionChangedAt')::numeric,0) then
    result := jsonb_set(result,array['activeSession'],p_previous->'activeSession',true);
    if p_previous ? 'activeSessionChangedAt' then
      result := jsonb_set(result,array['activeSessionChangedAt'],p_previous->'activeSessionChangedAt',true);
    else
      result := result - 'activeSessionChangedAt';
    end if;
    if previous_storage ? 'hyperion-saved-practice' and storage->'hyperion-saved-practice'='null'::jsonb then
      storage := jsonb_set(storage,array['hyperion-saved-practice'],previous_storage->'hyperion-saved-practice',true);
    end if;
  end if;
  return jsonb_set(result,array['storage'],storage,true);
end $$;
revoke all on function public.prepare_learning_progress(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.prepare_learning_progress(jsonb,jsonb) to service_role;

create or replace function public.preserve_learning_progress() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception using errcode='22023',message='Progress ownership cannot be changed.';
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
  if public.canonical_learning_progress(public.prepare_learning_progress(current_row.data,p_data)) = public.canonical_learning_progress(current_row.data) then return 'unchanged'; end if;
  return 'changed';
end $$;
revoke all on function public.compare_user_learning_progress(uuid,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.compare_user_learning_progress(uuid,timestamptz,jsonb) to service_role;
