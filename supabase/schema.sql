-- Manual payment review schema with individual annual track subscriptions.
-- Safe to rerun: creates missing tables and refreshes the relevant check constraints.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null,
  track_id text not null,
  amount_php integer not null check (amount_php > 0),
  currency text not null default 'PHP' check (currency = 'PHP'),
  status text not null default 'pending',
  payment_reference text,
  payment_method text,
  proof_url text,
  customer_note text,
  customer_name text,
  customer_company text,
  customer_school text,
  admin_note text,
  paymongo_checkout_session_id text,
  paymongo_payment_id text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

-- Add missing manual-review fields when upgrading an earlier payment schema.
alter table public.orders add column if not exists payment_reference text;
alter table public.orders add column if not exists payment_method text;
alter table public.orders add column if not exists proof_url text;
alter table public.orders add column if not exists customer_note text;
alter table public.orders add column if not exists customer_name text;
alter table public.orders add column if not exists customer_company text;
alter table public.orders add column if not exists customer_school text;
alter table public.orders add column if not exists admin_note text;
alter table public.orders add column if not exists paymongo_checkout_session_id text;
alter table public.orders add column if not exists paymongo_payment_id text;
create unique index if not exists orders_paymongo_checkout_session_uidx
  on public.orders (paymongo_checkout_session_id) where paymongo_checkout_session_id is not null;
create unique index if not exists orders_paymongo_payment_uidx
  on public.orders (paymongo_payment_id) where paymongo_payment_id is not null;
alter table public.orders add column if not exists reviewed_by text;
alter table public.orders add column if not exists reviewed_at timestamptz;

-- Product catalogue intentionally excludes the discontinued all-access bundle.
alter table public.orders drop constraint if exists orders_product_code_check;
alter table public.orders add constraint orders_product_code_check
  check (product_code in ('oic_nw','gmdss','engine_ew','deck_mgt','engine_mgt'));
alter table public.orders drop constraint if exists orders_track_id_check;
alter table public.orders add constraint orders_track_id_check
  check (track_id in ('DECK_OIC_NW','GMDSS_GOC','ENGINE_OIC_EW','DECK_MGT','ENGINE_MGT'));
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending','submitted','paid','failed','refunded','cancelled'));

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null,
  track_id text not null,
  order_id uuid not null references public.orders(id) on delete restrict,
  status text not null default 'active' check (status in ('active','revoked')),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  renewed_at timestamptz,
  unique (user_id, product_code)
);
alter table public.entitlements add column if not exists expires_at timestamptz;
alter table public.entitlements add column if not exists renewed_at timestamptz;
update public.entitlements set expires_at = granted_at + interval '1 year' where expires_at is null;
create index if not exists entitlements_active_expiry_idx on public.entitlements (user_id, expires_at) where status = 'active';
alter table public.entitlements drop constraint if exists entitlements_product_code_check;
alter table public.entitlements add constraint entitlements_product_code_check
  check (product_code in ('oic_nw','gmdss','engine_ew','deck_mgt','engine_mgt'));
alter table public.entitlements drop constraint if exists entitlements_track_id_check;
alter table public.entitlements add constraint entitlements_track_id_check
  check (track_id in ('DECK_OIC_NW','GMDSS_GOC','ENGINE_OIC_EW','DECK_MGT','ENGINE_MGT'));

create table if not exists public.payment_settings (
  id integer primary key default 1 check (id = 1),
  instructions text not null default 'Please contact Hyperion support for payment instructions.',
  updated_at timestamptz not null default now()
);
insert into public.payment_settings (id, instructions)
values (1, 'Please contact Hyperion support for payment instructions.')
on conflict (id) do nothing;

alter table public.orders enable row level security;
alter table public.entitlements enable row level security;
alter table public.payment_settings enable row level security;

drop policy if exists "Users read own orders" on public.orders;
create policy "Users read own orders" on public.orders
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users read own entitlements" on public.entitlements;
create policy "Users read own entitlements" on public.entitlements
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Public read payment instructions" on public.payment_settings;
create policy "Public read payment instructions" on public.payment_settings
  for select to anon, authenticated using (true);

revoke insert, update, delete on public.orders from anon, authenticated;
revoke insert, update, delete on public.entitlements from anon, authenticated;
revoke insert, update, delete on public.payment_settings from anon, authenticated;
grant select on public.orders, public.entitlements to authenticated;
grant select on public.payment_settings to anon, authenticated;
