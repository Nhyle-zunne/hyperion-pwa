begin;
set local lock_timeout = '5s';
-- Restore the prior write behavior without touching any archive or recovery row.
drop trigger if exists skip_unchanged_session_archive on public.user_learning_session_archives;
drop function if exists public.skip_unchanged_session_archive();
commit;
