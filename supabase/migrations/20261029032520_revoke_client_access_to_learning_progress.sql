begin;

-- Learning progress contains question-bearing snapshots. All access must use the
-- JWT-authenticated Edge Function so entitlement filtering cannot be bypassed.
alter table public.user_learning_progress enable row level security;

revoke all privileges on table public.user_learning_progress from PUBLIC, anon, authenticated;
grant all privileges on table public.user_learning_progress to service_role;

drop policy if exists "Users can insert their own learning progress" on public.user_learning_progress;
drop policy if exists "Users can read their own learning progress" on public.user_learning_progress;
drop policy if exists "Users can update their own learning progress" on public.user_learning_progress;

comment on table public.user_learning_progress is
  'Private learning-progress snapshots. Client access must go through the authenticated learning-progress Edge Function so saved question entitlements are verified.';

commit;
