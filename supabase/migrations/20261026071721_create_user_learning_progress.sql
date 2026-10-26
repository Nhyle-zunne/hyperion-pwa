-- Account-owned learning progress. Only the authenticated owner can read or update their row.
create table if not exists public.user_learning_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb
    constraint user_learning_progress_data_is_object check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_learning_progress enable row level security;

revoke all on table public.user_learning_progress from anon, authenticated;
grant select, insert, update on table public.user_learning_progress to authenticated;
grant all on table public.user_learning_progress to service_role;

drop policy if exists "Users can read their own learning progress" on public.user_learning_progress;
create policy "Users can read their own learning progress"
  on public.user_learning_progress
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own learning progress" on public.user_learning_progress;
create policy "Users can insert their own learning progress"
  on public.user_learning_progress
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own learning progress" on public.user_learning_progress;
create policy "Users can update their own learning progress"
  on public.user_learning_progress
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.set_user_learning_progress_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_learning_progress_updated_at on public.user_learning_progress;
create trigger set_user_learning_progress_updated_at
  before update on public.user_learning_progress
  for each row
  execute function public.set_user_learning_progress_updated_at();
