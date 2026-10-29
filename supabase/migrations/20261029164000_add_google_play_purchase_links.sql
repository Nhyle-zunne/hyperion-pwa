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

-- Revocation and product-set reconciliation must not depend on a series of separate
-- Edge Function REST writes succeeding one at a time. Inactive/expired links revoke all
-- grants; active links revoke tracks not present in the latest verified product set.
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
    user_id,
    purchase_token,
    purchase_token_sha256,
    product_ids,
    subscription_state,
    status,
    expires_at,
    last_verified_at,
    updated_at
  )
  VALUES (
    p_user_id,
    p_purchase_token,
    p_purchase_token_sha256,
    v_product_ids,
    COALESCE(NULLIF(p_subscription_state, ''), 'SUBSCRIPTION_STATE_UNSPECIFIED'),
    v_status,
    p_expires_at,
    v_now,
    v_now
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
    user_id,
    purchase_link_id,
    product_code,
    track_id,
    status,
    expires_at,
    updated_at
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

  -- Retire any old tracks omitted by the freshly verified product set.
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
$;


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
    user_id,
    purchase_token,
    purchase_token_sha256,
    product_ids,
    subscription_state,
    status,
    expires_at,
    last_verified_at,
    updated_at
  )
  VALUES (
    p_user_id,
    p_purchase_token,
    p_purchase_token_sha256,
    v_product_ids,
    COALESCE(NULLIF(p_subscription_state, ''), 'SUBSCRIPTION_STATE_UNSPECIFIED'),
    v_status,
    p_expires_at,
    v_now,
    v_now
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
    user_id,
    purchase_link_id,
    product_code,
    track_id,
    status,
    expires_at,
    updated_at
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

  -- Retire any old tracks omitted by the freshly verified product set.
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
