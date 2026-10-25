-- Run in Supabase SQL Editor. Manual payment review schema.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null check (product_code in ('oic_nw','gmdss','engine_ew','deck_mgt','engine_mgt','all_access')),
  track_id text not null check (track_id in ('DECK_OIC_NW','GMDSS_GOC','ENGINE_OIC_EW','DECK_MGT','ENGINE_MGT','ALL')),
  amount_php integer not null check (amount_php > 0),
  currency text not null default 'PHP' check (currency = 'PHP'),
  status text not null default 'pending' check (status in ('pending','submitted','paid','failed','refunded')),
  payment_reference text,
  payment_method text,
  proof_url text,
  customer_note text,
  admin_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
-- Additive migration for projects where the earlier PayMongo schema was already applied.
alter table public.orders add column if not exists payment_reference text;
alter table public.orders add column if not exists payment_method text;
alter table public.orders add column if not exists proof_url text;
alter table public.orders add column if not exists customer_note text;
alter table public.orders add column if not exists admin_note text;
alter table public.orders add column if not exists reviewed_by text;
alter table public.orders add column if not exists reviewed_at timestamptz;
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('pending','submitted','paid','failed','refunded'));

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null check (product_code in ('oic_nw','gmdss','engine_ew','deck_mgt','engine_mgt','all_access')),
  track_id text not null check (track_id in ('DECK_OIC_NW','GMDSS_GOC','ENGINE_OIC_EW','DECK_MGT','ENGINE_MGT','ALL')),
  order_id uuid not null references public.orders(id) on delete restrict,
  status text not null default 'active' check (status in ('active','revoked')),
  granted_at timestamptz not null default now(),
  unique (user_id, product_code)
);
create table if not exists public.payment_settings (
  id integer primary key default 1 check (id = 1),
  instructions text not null default 'Please contact Hyperion support for payment instructions.',
  updated_at timestamptz not null default now()
);
insert into public.payment_settings (id, instructions) values (1, 'Please contact Hyperion support for payment instructions.') on conflict (id) do nothing;
alter table public.orders enable row level security;
alter table public.entitlements enable row level security;
alter table public.payment_settings enable row level security;
drop policy if exists "Users read own orders" on public.orders;
create policy "Users read own orders" on public.orders for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users read own entitlements" on public.entitlements;
create policy "Users read own entitlements" on public.entitlements for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Public read payment instructions" on public.payment_settings;
create policy "Public read payment instructions" on public.payment_settings for select to anon, authenticated using (true);
revoke insert, update, delete on public.orders from anon, authenticated;
revoke insert, update, delete on public.entitlements from anon, authenticated;
revoke insert, update, delete on public.payment_settings from anon, authenticated;
grant select on public.orders, public.entitlements to authenticated;
grant select on public.payment_settings to anon, authenticated;
