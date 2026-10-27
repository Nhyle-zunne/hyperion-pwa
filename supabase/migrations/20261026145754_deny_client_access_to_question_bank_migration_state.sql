alter table public.question_bank_migration_state enable row level security;

revoke all privileges on table public.question_bank_migration_state from public, anon, authenticated;
grant all privileges on table public.question_bank_migration_state to service_role;

drop policy if exists "No client access to question bank migration state"
  on public.question_bank_migration_state;
create policy "No client access to question bank migration state"
  on public.question_bank_migration_state
  for all to anon, authenticated
  using (false)
  with check (false);
