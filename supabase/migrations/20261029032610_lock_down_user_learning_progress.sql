begin;

-- All progress reads/writes now go through the JWT-authenticated learning-progress
-- Edge Function, which filters question-bearing snapshots through current server
-- entitlements. Direct browser access would bypass those checks.
alter table public.user_learning_progress enable row level security;

revoke all privileges on table public.user_learning_progress from PUBLIC, anon, authenticated;
grant all privileges on table public.user_learning_progress to service_role;

drop policy if exists "Users can insert their own learning progress" on public.user_learning_progress;
drop policy if exists "Users can read their own learning progress" on public.user_learning_progress;
drop policy if exists "Users can update their own learning progress" on public.user_learning_progress;

commit;
