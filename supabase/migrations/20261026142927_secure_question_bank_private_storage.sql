-- Private question assets are served only by the authenticated/authorized question-bank Edge Function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('question-banks', 'question-banks', false, 1048576, array['application/octet-stream'])
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.question_bank_migration_state (
  id integer primary key check (id = 1),
  status text not null default 'pending' check (status in ('pending','running','complete','failed')),
  asset_count integer not null default 0 check (asset_count >= 0),
  error_summary text,
  updated_at timestamptz not null default now()
);
insert into public.question_bank_migration_state (id, status, asset_count)
values (1, 'pending', 0)
on conflict (id) do nothing;

alter table public.question_bank_migration_state enable row level security;
revoke all privileges on table public.question_bank_migration_state from public, anon, authenticated;
grant all privileges on table public.question_bank_migration_state to service_role;
