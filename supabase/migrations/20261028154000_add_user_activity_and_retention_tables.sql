create table if not exists public.user_activity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_accessed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_activity_last_accessed_at_idx
  on public.user_activity (last_accessed_at desc);

alter table public.user_activity enable row level security;
revoke all on table public.user_activity from anon, authenticated;
grant all on table public.user_activity to service_role;

create table if not exists public.account_retention_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  action text not null check (action in ('deletion_attempted', 'deleted', 'delete_failed')),
  reason text not null check (reason in ('free_account_inactive_30_days', 'license_expired_grace_period_ended')),
  last_accessed_at timestamptz,
  retention_due_at timestamptz not null,
  created_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object')
);

create index if not exists account_retention_audit_created_at_idx
  on public.account_retention_audit (created_at desc);
create index if not exists account_retention_audit_user_id_idx
  on public.account_retention_audit (user_id, created_at desc);

alter table public.account_retention_audit enable row level security;
revoke all on table public.account_retention_audit from anon, authenticated;
grant all on table public.account_retention_audit to service_role;

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'hyperion_account_retention_cron_token'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'hyperion_account_retention_cron_token',
      'Private bearer token for scheduled inactive account retention'
    );
  end if;
end;
$$;

create or replace function public.verify_account_retention_cron_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'vault'
as $function$
  select p_token is not null and exists (
    select 1
      from vault.decrypted_secrets
     where name = 'hyperion_account_retention_cron_token'
       and decrypted_secret = p_token
  );
$function$;

revoke all on function public.verify_account_retention_cron_token(text) from public, anon, authenticated;
grant execute on function public.verify_account_retention_cron_token(text) to service_role;
