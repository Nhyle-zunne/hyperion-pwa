-- Manual payment review schema with individual annual track subscriptions.
-- Safe to rerun: creates missing tables and refreshes the relevant check constraints.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null,
  track_id text not null,
  license_term text not null default 'year' check (license_term in ('week','month','year')),
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
alter table public.orders add column if not exists checkout_batch_id uuid;
create unique index if not exists orders_paymongo_checkout_session_uidx
  on public.orders (paymongo_checkout_session_id) where paymongo_checkout_session_id is not null;
create unique index if not exists orders_paymongo_payment_uidx
  on public.orders (paymongo_payment_id) where paymongo_payment_id is not null;
alter table public.orders add column if not exists reviewed_by text;
alter table public.orders add column if not exists reviewed_at timestamptz;
alter table public.orders add column if not exists license_term text not null default 'year';
alter table public.orders drop constraint if exists orders_license_term_check;
alter table public.orders add constraint orders_license_term_check check (license_term in ('week','month','year'));

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
  license_term text not null default 'year' check (license_term in ('week','month','year')),
  order_id uuid not null references public.orders(id) on delete restrict,
  status text not null default 'active' check (status in ('active','revoked')),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  renewed_at timestamptz,
  unique (user_id, product_code)
);
alter table public.entitlements add column if not exists expires_at timestamptz;
alter table public.entitlements add column if not exists renewed_at timestamptz;
alter table public.entitlements add column if not exists license_term text not null default 'year';
alter table public.entitlements drop constraint if exists entitlements_license_term_check;
alter table public.entitlements add constraint entitlements_license_term_check check (license_term in ('week','month','year'));
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


-- Multi-item PayMongo cart: one provider checkout, one order and entitlement per product.
create table if not exists public.checkout_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_codes text[] not null,
  license_terms text[] not null default '{}',
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
alter table public.checkout_batches add column if not exists license_terms text[];
update public.checkout_batches set license_terms = array_fill('year'::text, array[cardinality(product_codes)]) where license_terms is null;
alter table public.checkout_batches alter column license_terms set default '{}', alter column license_terms set not null;
alter table public.checkout_batches drop constraint if exists checkout_batches_license_terms_check;
alter table public.checkout_batches add constraint checkout_batches_license_terms_check check (cardinality(license_terms) = cardinality(product_codes) and license_terms <@ array['week','month','year']::text[]);
do $
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
  for select to authenticated using (auth.uid() = user_id);
revoke insert, update, delete on public.checkout_batches from anon, authenticated;
grant select on public.checkout_batches to authenticated;


-- Link verified Google Play subscriptions to a Hyperion account without overwriting website/admin licenses.
CREATE TABLE IF NOT EXISTS public.google_play_purchase_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purchase_token text NOT NULL,
  purchase_token_sha256 text NOT NULL UNIQUE,
  product_ids text[] NOT NULL DEFAULT '{}',
  subscription_state text NOT NULL DEFAULT 'SUBSCRIPTION_STATE_UNSPECIFIED',
  status text NOT NULL DEFAULT 'inactive' CHECK (status IN ('active','inactive')),
  expires_at timestamptz NOT NULL,
  last_verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.google_play_purchase_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.google_play_purchase_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.google_play_purchase_links TO service_role;
CREATE INDEX IF NOT EXISTS google_play_purchase_links_user_status_idx
  ON public.google_play_purchase_links (user_id, status, expires_at DESC);

CREATE TABLE IF NOT EXISTS public.google_play_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purchase_link_id uuid NOT NULL REFERENCES public.google_play_purchase_links(id) ON DELETE CASCADE,
  product_code text NOT NULL CHECK (product_code IN ('oic_nw','gmdss','engine_ew','deck_mgt','engine_mgt')),
  track_id text NOT NULL CHECK (track_id IN ('DECK_OIC_NW','GMDSS_GOC','ENGINE_OIC_EW','DECK_MGT','ENGINE_MGT')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purchase_link_id, track_id)
);

ALTER TABLE public.google_play_entitlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.google_play_entitlements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.google_play_entitlements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.google_play_entitlements TO service_role;

DROP POLICY IF EXISTS "Users read own Google Play entitlements" ON public.google_play_entitlements;
CREATE POLICY "Users read own Google Play entitlements" ON public.google_play_entitlements
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE INDEX IF NOT EXISTS google_play_entitlements_user_track_expiry_idx
  ON public.google_play_entitlements (user_id, track_id, expires_at DESC)
  WHERE status = 'active';
