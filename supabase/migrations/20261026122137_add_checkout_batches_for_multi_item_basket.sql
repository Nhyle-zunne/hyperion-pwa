-- One provider checkout can contain multiple track-specific child orders.
create table if not exists public.checkout_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_codes text[] not null,
  amount_php integer not null check (amount_php > 0),
  currency text not null default 'PHP' check (currency = 'PHP'),
  status text not null default 'pending' check (status in ('pending','paid','failed','cancelled')),
  payment_method text not null default 'PayMongo Checkout',
  payment_reference text,
  paymongo_checkout_session_id text unique,
  paymongo_payment_id text unique,
  customer_name text,
  customer_company text,
  customer_school text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

alter table public.orders add column if not exists checkout_batch_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_checkout_batch_id_fkey'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders add constraint orders_checkout_batch_id_fkey
      foreign key (checkout_batch_id) references public.checkout_batches(id) on delete set null;
  end if;
end $$;

create index if not exists checkout_batches_user_status_idx
  on public.checkout_batches(user_id, status, created_at desc);
create index if not exists orders_checkout_batch_id_idx
  on public.orders(checkout_batch_id) where checkout_batch_id is not null;

alter table public.checkout_batches enable row level security;
drop policy if exists "Users read own checkout batches" on public.checkout_batches;
create policy "Users read own checkout batches" on public.checkout_batches
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all privileges on table public.checkout_batches from public, anon, authenticated;
grant select on table public.checkout_batches to authenticated;
grant all privileges on table public.checkout_batches to service_role;
