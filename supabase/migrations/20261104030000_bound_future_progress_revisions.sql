-- Future-only, account-scoped recovery retention.
-- Preserve EVERY revision that already existed when this migration was installed.
-- Only subsequent snapshots are eligible for the bounded 10-revision rolling window.
-- No production progress/revision rows are modified by applying this migration.

-- Capture the watermark while writers are blocked. This must run transactionally.
lock table public.user_learning_progress in share row exclusive mode;
lock table public.user_learning_progress_revisions in share row exclusive mode;

create table if not exists public.user_learning_progress_revision_retention (
  singleton boolean primary key default true check (singleton),
  protected_through_id bigint not null check (protected_through_id >= 0),
  max_future_per_account integer not null default 10
    check (max_future_per_account between 5 and 20),
  enabled boolean not null default true,
  activated_at timestamptz not null default now()
);

insert into public.user_learning_progress_revision_retention
  (singleton, protected_through_id, max_future_per_account)
select true, coalesce(max(id), 0), 10
from public.user_learning_progress_revisions
on conflict (singleton) do nothing;

alter table public.user_learning_progress_revision_retention enable row level security;
revoke all on public.user_learning_progress_revision_retention from public, anon, authenticated;
grant select on public.user_learning_progress_revision_retention to service_role;

-- The existing trigger still canonicalizes updates, preserves missing fields,
-- validates deletion markers and saves OLD.data only for genuine changes.
-- Retention removes only IDs strictly ABOVE the locked migration watermark.
-- A failed transaction rolls back its progress update and any pruning together.
create or replace function public.preserve_learning_progress() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  safe_through bigint;
  keep_future integer;
  pruning_enabled boolean;
begin
  if new.user_id is distinct from old.user_id then
    raise exception using errcode='22023',message='Progress ownership cannot be changed.';
  end if;
  if public.canonical_learning_progress(new.data) = public.canonical_learning_progress(old.data) then
    return new;
  end if;
  new.data := public.prepare_learning_progress(old.data,new.data);
  if public.canonical_learning_progress(new.data) is distinct from public.canonical_learning_progress(old.data) then
    insert into public.user_learning_progress_revisions(user_id,data)
    values(old.user_id,old.data);

    select protected_through_id, max_future_per_account, enabled
      into safe_through, keep_future, pruning_enabled
    from public.user_learning_progress_revision_retention
    where singleton = true;

    -- Missing or invalid policy fails safely for preservation: do not delete.
    if pruning_enabled is true and safe_through is not null and keep_future between 5 and 20 then
      delete from public.user_learning_progress_revisions
      where id in (
        select id
        from public.user_learning_progress_revisions
        where user_id = old.user_id and id > safe_through
        order by id desc
        offset keep_future
      );
    end if;
  end if;
  return new;
end $$;
revoke all on function public.preserve_learning_progress() from public, anon, authenticated;
grant execute on function public.preserve_learning_progress() to service_role;
