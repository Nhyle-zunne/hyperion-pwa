begin;
set local lock_timeout = '5s';

-- Future-only optimization: do not rewrite, delete or recode any existing
-- study progress, completed session archives or protected recovery snapshots.
-- Per-user revision checkpoints are spaced out, but remain independently
-- restorable full JSONB snapshots. The existing ten-newest-future policy is
-- unchanged. Zero disables spacing immediately without a migration rollback.
alter table public.user_learning_progress_revision_retention
  add column if not exists min_checkpoint_seconds integer
  not null default 300
  check (min_checkpoint_seconds between 0 and 3600);

create or replace function public.preserve_learning_progress() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  safe_through bigint;
  keep_future integer;
  pruning_enabled boolean;
  checkpoint_interval integer;
  should_capture boolean := true;
begin
  if new.user_id is distinct from old.user_id then
    raise exception using errcode='22023',message='Progress ownership cannot be changed.';
  end if;
  -- Never canonicalize or save backups for formatting-only changes.
  if public.canonical_learning_progress(new.data) = public.canonical_learning_progress(old.data) then
    return new;
  end if;
  new.data := public.prepare_learning_progress(old.data,new.data);
  if public.canonical_learning_progress(new.data) is distinct from public.canonical_learning_progress(old.data) then
    select protected_through_id, max_future_per_account, enabled, min_checkpoint_seconds
      into safe_through, keep_future, pruning_enabled, checkpoint_interval
    from public.user_learning_progress_revision_retention where singleton = true;

    -- Fail safe: a missing/invalid policy preserves a full recovery revision on
    -- EVERY meaningful change. Never skip a recovery point when no recent future backup exists.
    if safe_through is not null
       and checkpoint_interval between 1 and 3600
       and exists (
         select 1 from public.user_learning_progress_revisions
         where user_id = old.user_id
           and id > safe_through
           and captured_at > pg_catalog.now() - pg_catalog.make_interval(secs => checkpoint_interval)
         limit 1
       ) then
      should_capture := false;
    end if;

    -- Always capture a boundary before explicit bookmark/mistake deletion or
    -- completed-exam transition, regardless of checkpoint frequency.
    if public.progress_json_or_null(old.data->'storage'->>'hyperion-progress-deletions')
       is distinct from public.progress_json_or_null(new.data->'storage'->>'hyperion-progress-deletions')
       or (
         pg_catalog.jsonb_typeof(new.data->'activeSession') = 'object'
         and new.data->'activeSession'->>'finished' = 'true'
         and old.data->'activeSession'->>'finished' is distinct from 'true'
       ) then
      should_capture := true;
    end if;

    if should_capture then
      insert into public.user_learning_progress_revisions(user_id,data)
      values(old.user_id,old.data);
      -- Only prune revisions above the immutable historical watermark; never
      -- prune an existing record <= protected_through_id.
      if pruning_enabled is true and safe_through is not null and keep_future between 5 and 20 then
        delete from public.user_learning_progress_revisions
        where id in (
          select id from public.user_learning_progress_revisions
          where user_id = old.user_id and id > safe_through
          order by id desc offset keep_future
        );
      end if;
    end if;
  end if;
  return new;
end $$;

revoke all on function public.preserve_learning_progress() from public, anon, authenticated;
grant execute on function public.preserve_learning_progress() to service_role;
commit;
