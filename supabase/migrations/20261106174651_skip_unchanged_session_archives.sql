begin;
set local lock_timeout = '5s';

-- Schema-only: keep all current archives and historical recovery points intact.
create or replace function public.skip_unchanged_session_archive()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.user_id is not distinct from old.user_id
     and new.session_id is not distinct from old.session_id
     and new.data is not distinct from old.data then
    return null;
  end if;
  return new;
end $$;
revoke all on function public.skip_unchanged_session_archive() from public, anon, authenticated;
grant execute on function public.skip_unchanged_session_archive() to service_role;

-- Same-kind triggers run alphabetically. Run AFTER preserve_completed_session_audit
-- has restored any immutable completed data, then skip the effective no-op entirely.
drop trigger if exists skip_unchanged_session_archive on public.user_learning_session_archives;
create trigger skip_unchanged_session_archive
before update on public.user_learning_session_archives
for each row execute function public.skip_unchanged_session_archive();
commit;
