begin;
set local lock_timeout = '5s';

-- Private Edge-only alternative to PostgREST upsert. The server already has
-- BEFORE UPDATE no-op triggers; this filters identical JSONB rows *before*
-- invoking any UPDATE trigger. Completed exam audits retain their existing
-- immutable-row protection. No existing rows are modified by this migration.
create or replace function public.upsert_learning_session_archives_if_changed(
  p_user_id uuid,
  p_sessions jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_count integer := 0;
  count_entries integer;
begin
  if p_user_id is null or pg_catalog.jsonb_typeof(p_sessions) is distinct from 'array' then
    raise exception using errcode='22023',message='Invalid owner or session batch.';
  end if;
  count_entries := pg_catalog.jsonb_array_length(p_sessions);
  if count_entries < 1 or count_entries > 10 or
     pg_catalog.octet_length(p_sessions::text) > 1258291 then
    raise exception using errcode='22023',message='Invalid session archive batch size.';
  end if;
  if exists(
    select 1
    from pg_catalog.jsonb_array_elements(p_sessions) as item(value)
    where pg_catalog.jsonb_typeof(item.value) is distinct from 'object'
       or pg_catalog.jsonb_typeof(item.value->'data') is distinct from 'object'
       or pg_catalog.jsonb_typeof(item.value->'session_id') is distinct from 'string'
       or pg_catalog.length(item.value->>'session_id') not between 1 and 180
       or item.value->'data'->>'sessionId' is distinct from item.value->>'session_id'
  ) or (
    select pg_catalog.count(distinct item.value->>'session_id')
    from pg_catalog.jsonb_array_elements(p_sessions) as item(value)
  ) <> count_entries then
    raise exception using errcode='22023',message='Malformed or repeated archive session IDs.';
  end if;

  insert into public.user_learning_session_archives as existing
    (user_id, session_id, data, updated_at)
  select p_user_id, item.session_id, item.data, pg_catalog.now()
  from pg_catalog.jsonb_to_recordset(p_sessions) as item(session_id text, data jsonb)
  on conflict (user_id, session_id)
  do update set data = excluded.data, updated_at = excluded.updated_at
  where existing.data is distinct from excluded.data;

  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

revoke all on function public.upsert_learning_session_archives_if_changed(uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_learning_session_archives_if_changed(uuid,jsonb)
  to service_role;
commit;
