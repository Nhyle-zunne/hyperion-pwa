-- Run this in Supabase SQL Editor before deploying Edge Functions.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null check (product_code in ('oic_nw','gmdss','engine_ew','deck_mgt','engine_mgt','all_access')),
  track_id text not null check (track_id in ('DECK_OIC_NW','GMDSS_GOC','ENGINE_OIC_EW','DECK_MGT','ENGINE_MGT','ALL')),
  amount_php integer not null check (amount_php > 0),
  currency text not null default 'PHP' check (currency = 'PHP'),
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  paymongo_checkout_session_id text unique,
  paymongo_payment_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

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

alter table public.orders enable row level security;
alter table public.entitlements enable row level security;

-- Users can view only their own orders and entitlements. Writes are service-role only.
drop policy if exists "Users read own orders" on public.orders;
create policy "Users read own orders" on public.orders for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users read own entitlements" on public.entitlements;
create policy "Users read own entitlements" on public.entitlements for select to authenticated using (auth.uid() = user_id);
revoke insert, update, delete on public.orders from anon, authenticated;
revoke insert, update, delete on public.entitlements from anon, authenticated;
grant select on public.orders, public.entitlements to authenticated;
