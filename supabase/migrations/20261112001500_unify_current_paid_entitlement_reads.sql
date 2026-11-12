begin;

-- Return only CURRENT active website or Google Play grants, in one indexed
-- server-side query/REST RPC instead of two separate REST round trips.
-- Historical ownership stays in get_learning_progress_owned_tracks; this RPC
-- must NEVER resurrect a revoked, expired, or other-account subscription.
create or replace function public.get_active_paid_track_entitlements(
  p_user_id uuid,
  p_track_id text default null
)
returns table(user_id uuid, track_id text, expires_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select p_user_id, grants.track_id, max(grants.expires_at) as expires_at
  from (
    select e.track_id::text as track_id, e.expires_at
    from public.entitlements as e
    where e.user_id = p_user_id
      and e.status = 'active'
      and e.expires_at > pg_catalog.now()
      and (p_track_id is null or e.track_id = p_track_id)
    union all
    select g.track_id::text as track_id, g.expires_at
    from public.google_play_entitlements as g
    where g.user_id = p_user_id
      and g.status = 'active'
      and g.expires_at > pg_catalog.now()
      and (p_track_id is null or g.track_id = p_track_id)
  ) as grants
  where grants.track_id in (
    'DECK_OIC_NW', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT', 'GMDSS_GOC'
  )
  group by grants.track_id
$$;

-- Postgres grants EXECUTE to PUBLIC by default. Revoke it atomically,
-- including both REST client roles. SECURITY INVOKER and service-only grants
-- ensure this does not become a user-enumeration or license-exposure endpoint.
revoke all on function public.get_active_paid_track_entitlements(uuid,text)
  from public, anon, authenticated;
grant execute on function public.get_active_paid_track_entitlements(uuid,text)
  to service_role;

commit;
