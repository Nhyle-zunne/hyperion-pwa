begin;

-- One READ-ONLY query for the historical union of paid website and Play
-- ownership. This is for saving an existing student's work, not for granting
-- current access to premium questions. Current-access checks remain unchanged.
--
-- SECURITY INVOKER means this never gains definer privileges. It is executable
-- only through the server-side service role after verified JWT ownership.
create or replace function public.get_learning_progress_owned_tracks(
  p_user_id uuid
)
returns table(track_id text)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.track_id::text
  from public.entitlements as e
  where e.user_id = p_user_id
  union
  select g.track_id::text
  from public.google_play_entitlements as g
  where g.user_id = p_user_id
$$;

revoke all on function public.get_learning_progress_owned_tracks(uuid)
  from public, anon, authenticated;
grant execute on function public.get_learning_progress_owned_tracks(uuid)
  to service_role;

commit;
