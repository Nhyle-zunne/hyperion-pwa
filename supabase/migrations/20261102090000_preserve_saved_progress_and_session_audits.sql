-- Recovery records stay service-role-only. No client table access is introduced.
create table if not exists public.user_learning_progress_revisions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  captured_at timestamptz not null default now()
);
create index if not exists learning_progress_revisions_owner on public.user_learning_progress_revisions(user_id, captured_at desc);
alter table public.user_learning_progress_revisions enable row level security;
revoke all on public.user_learning_progress_revisions from public, anon, authenticated;
grant all on public.user_learning_progress_revisions to service_role;
grant usage, select on sequence public.user_learning_progress_revisions_id_seq to service_role;

create table if not exists public.user_learning_session_archives (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null check (length(session_id) between 1 and 180),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, session_id)
);
alter table public.user_learning_session_archives enable row level security;
revoke all on public.user_learning_session_archives from public, anon, authenticated;
grant all on public.user_learning_session_archives to service_role;

-- Collection omission is not deletion. Only an explicit per-item tombstone may
-- remove a previously saved record. This also protects against older clients.
create or replace function public.merge_preserved_progress_items(
  p_incoming text, p_previous text, p_ledger text, p_collection text
) returns text language plpgsql set search_path = '' as $$
declare
  incoming jsonb; previous jsonb; ledger jsonb; merged jsonb;
begin
  incoming := coalesce(p_incoming::jsonb, '{"version":0,"state":{"items":[]}}'::jsonb);
  previous := coalesce(p_previous::jsonb, '{"version":0,"state":{"items":[]}}'::jsonb);
  ledger := coalesce(p_ledger::jsonb, '{}'::jsonb);
  select coalesce(jsonb_agg(item order by stamp desc), '[]'::jsonb) into merged
  from (
    select distinct on (item->>'id') item,
      coalesce((item->>case when p_collection = 'bookmarks' then 'savedAt' else 'lastWrongAt' end)::numeric,0) stamp
    from (
      select value item, 0 priority from jsonb_array_elements(coalesce(previous->'state'->'items','[]'::jsonb))
      union all
      select value item, 1 priority from jsonb_array_elements(coalesce(incoming->'state'->'items','[]'::jsonb))
    ) all_items
    where jsonb_typeof(item) = 'object' and item->>'id' is not null
    order by item->>'id', coalesce((item->>case when p_collection = 'bookmarks' then 'savedAt' else 'lastWrongAt' end)::numeric,0) desc, priority desc
  ) unique_items
  where not (
    coalesce((ledger->p_collection->(item->>'id')->>'deleted')::boolean,false)
    and coalesce((ledger->p_collection->(item->>'id')->>'at')::numeric,0) >= stamp
  );
  return jsonb_set(incoming, '{state}', coalesce(incoming->'state','{}'::jsonb) || jsonb_build_object('items',merged))::text;
exception when invalid_text_representation or invalid_parameter_value then
  -- A malformed incoming collection must not replace the last recoverable copy.
  return coalesce(p_previous, p_incoming);
end $$;
revoke all on function public.merge_preserved_progress_items(text,text,text,text) from public, anon, authenticated;
grant execute on function public.merge_preserved_progress_items(text,text,text,text) to service_role;

create or replace function public.preserve_learning_progress() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text; collection text; merged text;
begin
  insert into public.user_learning_progress_revisions(user_id,data) values(old.user_id,old.data);
  foreach k in array array['hyperion-bookmarks','hyperion-vault'] loop
    collection := case when k = 'hyperion-bookmarks' then 'bookmarks' else 'vault' end;
    merged := public.merge_preserved_progress_items(new.data->'storage'->>k,old.data->'storage'->>k,new.data->'storage'->>'hyperion-progress-deletions',collection);
    new.data := jsonb_set(new.data, array['storage',k], coalesce(to_jsonb(merged),'null'::jsonb),true);
  end loop;
  delete from public.user_learning_progress_revisions where id in (
    select id from public.user_learning_progress_revisions where user_id=old.user_id order by captured_at desc,id desc offset 20
  );
  return new;
end $$;
revoke all on function public.preserve_learning_progress() from public, anon, authenticated;
drop trigger if exists preserve_learning_progress on public.user_learning_progress;
create trigger preserve_learning_progress before update on public.user_learning_progress for each row execute function public.preserve_learning_progress();

-- Preserve the currently recoverable row before the first new client writes.
insert into public.user_learning_progress_revisions(user_id,data)
select p.user_id,p.data from public.user_learning_progress p
where not exists(select 1 from public.user_learning_progress_revisions r where r.user_id=p.user_id);

-- Admin recovery is account-scoped, honors explicit deletion tombstones and can
-- be run in dry-run mode before changing any live row.
create or replace function public.recover_learning_progress_collections(p_user_id uuid, p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_data jsonb; recovered jsonb; revision record; k text; collection text; merged text; before_count integer; after_count integer; result jsonb := '{}'::jsonb;
begin
  select data into current_data from public.user_learning_progress where user_id=p_user_id for update;
  if current_data is null then return jsonb_build_object('found',false); end if;
  recovered := current_data;
  foreach k in array array['hyperion-bookmarks','hyperion-vault'] loop
    collection := case when k = 'hyperion-bookmarks' then 'bookmarks' else 'vault' end;
    before_count := jsonb_array_length(coalesce((current_data->'storage'->>k)::jsonb->'state'->'items','[]'::jsonb));
    for revision in select data from public.user_learning_progress_revisions where user_id=p_user_id order by captured_at loop
      merged := public.merge_preserved_progress_items(recovered->'storage'->>k,revision.data->'storage'->>k,current_data->'storage'->>'hyperion-progress-deletions',collection);
      recovered := jsonb_set(recovered,array['storage',k],coalesce(to_jsonb(merged),'null'::jsonb),true);
    end loop;
    after_count := jsonb_array_length(coalesce((recovered->'storage'->>k)::jsonb->'state'->'items','[]'::jsonb));
    result := result || jsonb_build_object(collection,jsonb_build_object('before',before_count,'after',after_count));
  end loop;
  if p_apply and recovered is distinct from current_data then update public.user_learning_progress set data=recovered where user_id=p_user_id; end if;
  return result || jsonb_build_object('found',true,'applied',p_apply);
end $$;
revoke all on function public.recover_learning_progress_collections(uuid,boolean) from public, anon, authenticated;
grant execute on function public.recover_learning_progress_collections(uuid,boolean) to service_role;

-- A delayed autosave from another tab/device cannot replace a completed audit.
create or replace function public.preserve_completed_session_audit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.data->>'finished' = 'true' then new.data := old.data; end if;
  return new;
end $$;
revoke all on function public.preserve_completed_session_audit() from public, anon, authenticated;
drop trigger if exists preserve_completed_session_audit on public.user_learning_session_archives;
create trigger preserve_completed_session_audit before update on public.user_learning_session_archives for each row execute function public.preserve_completed_session_audit();
