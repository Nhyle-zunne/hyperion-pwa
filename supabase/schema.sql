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

-- Keep the consolidated development schema aligned with the production migration.
CREATE OR REPLACE FUNCTION public.revoke_google_play_entitlements_on_inactive_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  allowed_tracks text[] := ARRAY[]::text[];
BEGIN
  IF NEW.status <> 'active' OR NEW.expires_at <= pg_catalog.now() THEN
    UPDATE public.google_play_entitlements
       SET status = 'revoked',
           updated_at = pg_catalog.now()
     WHERE purchase_link_id = NEW.id
       AND status <> 'revoked';
  ELSE
    IF 'hyperion_all_access_pass' = ANY(COALESCE(NEW.product_ids, ARRAY[]::text[])) THEN
      allowed_tracks := ARRAY['DECK_OIC_NW', 'GMDSS_GOC', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT']::text[];
    ELSE
      IF 'hyperion_oic_nw_pass' = ANY(COALESCE(NEW.product_ids, ARRAY[]::text[])) THEN
        allowed_tracks := allowed_tracks || ARRAY['DECK_OIC_NW']::text[];
      END IF;
      IF 'hyperion_gmdss_pass' = ANY(COALESCE(NEW.product_ids, ARRAY[]::text[])) THEN
        allowed_tracks := allowed_tracks || ARRAY['GMDSS_GOC']::text[];
      END IF;
      IF 'hyperion_engine_oic_ew_pass' = ANY(COALESCE(NEW.product_ids, ARRAY[]::text[])) THEN
        allowed_tracks := allowed_tracks || ARRAY['ENGINE_OIC_EW']::text[];
      END IF;
      IF 'hyperion_deck_mgt_pass' = ANY(COALESCE(NEW.product_ids, ARRAY[]::text[])) THEN
        allowed_tracks := allowed_tracks || ARRAY['DECK_MGT']::text[];
      END IF;
      IF 'hyperion_engine_mgt_pass' = ANY(COALESCE(NEW.product_ids, ARRAY[]::text[])) THEN
        allowed_tracks := allowed_tracks || ARRAY['ENGINE_MGT']::text[];
      END IF;
    END IF;

    -- Immediately retire grants that no longer correspond to this token's verified products.
    UPDATE public.google_play_entitlements
       SET status = 'revoked',
           updated_at = pg_catalog.now()
     WHERE purchase_link_id = NEW.id
       AND status <> 'revoked'
       AND NOT (track_id = ANY(allowed_tracks));
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_google_play_entitlements_on_inactive_link() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS google_play_link_inactive_revoke_entitlements ON public.google_play_purchase_links;
CREATE TRIGGER google_play_link_inactive_revoke_entitlements
AFTER UPDATE OF status, expires_at, product_ids ON public.google_play_purchase_links
FOR EACH ROW
EXECUTE FUNCTION public.revoke_google_play_entitlements_on_inactive_link();

-- Keep subscription-link state and per-track grants in one database transaction.
-- Only service_role may invoke this RPC. The Edge Function must verify the Google
-- purchase first and pass the user ID from the authenticated session or existing
-- token ownership record, never from an RTDN message.
CREATE OR REPLACE FUNCTION public.sync_google_play_subscription_atomic(
  p_user_id uuid,
  p_purchase_token text,
  p_purchase_token_sha256 text,
  p_product_ids text[],
  p_subscription_state text,
  p_status text,
  p_expires_at timestamptz,
  p_entitlements jsonb,
  p_prior_purchase_link_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_link_id uuid;
  v_now timestamptz := pg_catalog.now();
  v_status text;
  v_product_ids text[];
BEGIN
  IF p_user_id IS NULL
     OR p_purchase_token IS NULL
     OR pg_catalog.btrim(p_purchase_token) = ''
     OR pg_catalog.char_length(p_purchase_token) > 4096
     OR p_purchase_token_sha256 !~ '^[0-9a-f]{64}$'
     OR p_expires_at IS NULL
     OR p_status IS NULL
     OR p_status NOT IN ('active', 'inactive')
     OR p_entitlements IS NULL
     OR pg_catalog.jsonb_typeof(p_entitlements) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid Google Play entitlement reconciliation input';
  END IF;

  IF NOT COALESCE(
    p_product_ids <@ ARRAY[
      'hyperion_oic_nw_pass',
      'hyperion_gmdss_pass',
      'hyperion_engine_oic_ew_pass',
      'hyperion_deck_mgt_pass',
      'hyperion_engine_mgt_pass',
      'hyperion_all_access_pass'
    ]::text[],
    false
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unrecognized Google Play product in reconciliation input';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_entitlements) AS entry(value)
     WHERE pg_catalog.jsonb_typeof(entry.value) IS DISTINCT FROM 'object'
        OR COALESCE(entry.value ->> 'product_code', '') NOT IN ('oic_nw', 'gmdss', 'engine_ew', 'deck_mgt', 'engine_mgt')
        OR COALESCE(entry.value ->> 'track_id', '') NOT IN ('DECK_OIC_NW', 'GMDSS_GOC', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT')
        OR COALESCE(entry.value ->> 'status', '') NOT IN ('active', 'revoked')
        OR pg_catalog.jsonb_typeof(entry.value -> 'expires_at') IS DISTINCT FROM 'string'
        OR COALESCE(entry.value ->> 'expires_at', '') = ''
        OR NOT (
          (entry.value ->> 'product_code' = 'oic_nw' AND entry.value ->> 'track_id' = 'DECK_OIC_NW')
          OR (entry.value ->> 'product_code' = 'gmdss' AND entry.value ->> 'track_id' = 'GMDSS_GOC')
          OR (entry.value ->> 'product_code' = 'engine_ew' AND entry.value ->> 'track_id' = 'ENGINE_OIC_EW')
          OR (entry.value ->> 'product_code' = 'deck_mgt' AND entry.value ->> 'track_id' = 'DECK_MGT')
          OR (entry.value ->> 'product_code' = 'engine_mgt' AND entry.value ->> 'track_id' = 'ENGINE_MGT')
        )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid track entitlement in Google Play reconciliation input';
  END IF;

  IF EXISTS (
    SELECT entry.value ->> 'track_id'
      FROM pg_catalog.jsonb_array_elements(p_entitlements) AS entry(value)
     GROUP BY entry.value ->> 'track_id'
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Duplicate track in Google Play reconciliation input';
  END IF;

  v_status := CASE
    WHEN p_status = 'active' AND p_expires_at > v_now THEN 'active'
    ELSE 'inactive'
  END;
  v_product_ids := CASE WHEN v_status = 'active' THEN COALESCE(p_product_ids, ARRAY[]::text[]) ELSE ARRAY[]::text[] END;

  INSERT INTO public.google_play_purchase_links AS existing_link (
    user_id, purchase_token, purchase_token_sha256, product_ids,
    subscription_state, status, expires_at, last_verified_at, updated_at
  )
  VALUES (
    p_user_id, p_purchase_token, p_purchase_token_sha256, v_product_ids,
    COALESCE(NULLIF(p_subscription_state, ''), 'SUBSCRIPTION_STATE_UNSPECIFIED'),
    v_status, p_expires_at, v_now, v_now
  )
  ON CONFLICT (purchase_token_sha256) DO UPDATE
    SET purchase_token = EXCLUDED.purchase_token,
        product_ids = EXCLUDED.product_ids,
        subscription_state = EXCLUDED.subscription_state,
        status = EXCLUDED.status,
        expires_at = EXCLUDED.expires_at,
        last_verified_at = EXCLUDED.last_verified_at,
        updated_at = EXCLUDED.updated_at
    WHERE existing_link.user_id = EXCLUDED.user_id
  RETURNING id INTO v_link_id;

  IF v_link_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Google Play purchase token is already linked to another user';
  END IF;

  IF p_prior_purchase_link_id IS NOT NULL AND p_prior_purchase_link_id <> v_link_id THEN
    UPDATE public.google_play_purchase_links
       SET status = 'inactive',
           product_ids = ARRAY[]::text[],
           subscription_state = 'SUBSCRIPTION_STATE_REPLACED',
           expires_at = v_now,
           last_verified_at = v_now,
           updated_at = v_now
     WHERE id = p_prior_purchase_link_id
       AND user_id = p_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Previous Google Play subscription link is not owned by this user';
    END IF;
  END IF;

  INSERT INTO public.google_play_entitlements (
    user_id, purchase_link_id, product_code, track_id, status, expires_at, updated_at
  )
  SELECT
    p_user_id,
    v_link_id,
    entry.value ->> 'product_code',
    entry.value ->> 'track_id',
    CASE
      WHEN v_status = 'active'
       AND entry.value ->> 'status' = 'active'
       AND (entry.value ->> 'expires_at')::timestamptz > v_now THEN 'active'
      ELSE 'revoked'
    END,
    (entry.value ->> 'expires_at')::timestamptz,
    v_now
  FROM pg_catalog.jsonb_array_elements(p_entitlements) AS entry(value)
  ON CONFLICT (purchase_link_id, track_id) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        product_code = EXCLUDED.product_code,
        status = EXCLUDED.status,
        expires_at = EXCLUDED.expires_at,
        updated_at = EXCLUDED.updated_at;

  UPDATE public.google_play_entitlements AS current_entitlement
     SET status = 'revoked',
         updated_at = v_now
   WHERE current_entitlement.purchase_link_id = v_link_id
     AND current_entitlement.user_id = p_user_id
     AND current_entitlement.status <> 'revoked'
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.jsonb_array_elements(p_entitlements) AS entry(value)
        WHERE entry.value ->> 'track_id' = current_entitlement.track_id
     );

  RETURN v_link_id;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_google_play_subscription_atomic(uuid, text, text, text[], text, text, timestamptz, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_google_play_subscription_atomic(uuid, text, text, text[], text, text, timestamptz, jsonb, uuid) TO service_role;
