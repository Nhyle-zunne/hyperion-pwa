-- Isolated PostgreSQL regression tests for the Google Play entitlement migration.
-- Run after creating the minimal local Supabase auth stubs and applying the migration.
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');

DO $tests$
DECLARE
  v_user_one constant uuid := '00000000-0000-4000-8000-000000000001';
  v_user_two constant uuid := '00000000-0000-4000-8000-000000000002';
  v_future constant timestamptz := TIMESTAMPTZ '2099-01-01 00:00:00+00';
  v_past constant timestamptz := TIMESTAMPTZ '2000-01-01 00:00:00+00';
  v_link_one uuid;
  v_replacement_link uuid;
  v_user_two_link uuid;
  v_granted_at timestamptz;
  v_message text;
  v_count integer;
BEGIN
  -- Canceled-but-not-expired subscriptions remain entitled until their verified expiry.
  v_link_one := public.sync_google_play_subscription_atomic(
    v_user_one, 'token-user-one-initial', pg_catalog.repeat('a', 64),
    ARRAY['hyperion_oic_nw_pass']::text[],
    'SUBSCRIPTION_STATE_CANCELED', 'active', v_future,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'product_code', 'oic_nw', 'track_id', 'DECK_OIC_NW',
      'status', 'active', 'expires_at', v_future::text
    )),
    NULL
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.google_play_entitlements
    WHERE purchase_link_id = v_link_one AND track_id = 'DECK_OIC_NW' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Canceled-but-valid subscription was not granted access';
  END IF;
  SELECT granted_at INTO v_granted_at FROM public.google_play_entitlements
  WHERE purchase_link_id = v_link_one AND track_id = 'DECK_OIC_NW';

  -- Reconciliation is idempotent and does not reset the original grant timestamp.
  PERFORM public.sync_google_play_subscription_atomic(
    v_user_one, 'token-user-one-initial', pg_catalog.repeat('a', 64),
    ARRAY['hyperion_oic_nw_pass']::text[],
    'SUBSCRIPTION_STATE_CANCELED', 'active', v_future,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'product_code', 'oic_nw', 'track_id', 'DECK_OIC_NW',
      'status', 'active', 'expires_at', v_future::text
    )),
    NULL
  );
  IF (SELECT granted_at FROM public.google_play_entitlements
      WHERE purchase_link_id = v_link_one AND track_id = 'DECK_OIC_NW') IS DISTINCT FROM v_granted_at THEN
    RAISE EXCEPTION 'Repeated reconciliation changed granted_at';
  END IF;

  -- A product-set change revokes removed tracks and preserves tracks still purchased.
  PERFORM public.sync_google_play_subscription_atomic(
    v_user_one, 'token-user-one-initial', pg_catalog.repeat('a', 64),
    ARRAY['hyperion_oic_nw_pass', 'hyperion_gmdss_pass']::text[],
    'SUBSCRIPTION_STATE_ACTIVE', 'active', v_future,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('product_code', 'oic_nw', 'track_id', 'DECK_OIC_NW', 'status', 'active', 'expires_at', v_future::text),
      pg_catalog.jsonb_build_object('product_code', 'gmdss', 'track_id', 'GMDSS_GOC', 'status', 'active', 'expires_at', v_future::text)
    ),
    NULL
  );
  PERFORM public.sync_google_play_subscription_atomic(
    v_user_one, 'token-user-one-initial', pg_catalog.repeat('a', 64),
    ARRAY['hyperion_gmdss_pass']::text[],
    'SUBSCRIPTION_STATE_ACTIVE', 'active', v_future,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('product_code', 'gmdss', 'track_id', 'GMDSS_GOC', 'status', 'active', 'expires_at', v_future::text)
    ),
    NULL
  );
  IF (SELECT status FROM public.google_play_entitlements
      WHERE purchase_link_id = v_link_one AND track_id = 'DECK_OIC_NW') <> 'revoked' THEN
    RAISE EXCEPTION 'Removed track grant was not revoked';
  END IF;
  IF (SELECT status FROM public.google_play_entitlements
      WHERE purchase_link_id = v_link_one AND track_id = 'GMDSS_GOC') <> 'active' THEN
    RAISE EXCEPTION 'Retained product grant was incorrectly revoked';
  END IF;

  -- A verified replacement token invalidates grants for its same-account predecessor only.
  v_replacement_link := public.sync_google_play_subscription_atomic(
    v_user_one, 'token-user-one-replacement', pg_catalog.repeat('b', 64),
    ARRAY['hyperion_engine_oic_ew_pass']::text[],
    'SUBSCRIPTION_STATE_ACTIVE', 'active', v_future,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('product_code', 'engine_ew', 'track_id', 'ENGINE_OIC_EW', 'status', 'active', 'expires_at', v_future::text)
    ),
    v_link_one
  );
  IF (SELECT status FROM public.google_play_purchase_links WHERE id = v_link_one) <> 'inactive' THEN
    RAISE EXCEPTION 'Replaced subscription link was not marked inactive';
  END IF;
  IF EXISTS (SELECT 1 FROM public.google_play_entitlements WHERE purchase_link_id = v_link_one AND status = 'active') THEN
    RAISE EXCEPTION 'Replaced subscription retained an active entitlement';
  END IF;
  IF (SELECT status FROM public.google_play_entitlements
      WHERE purchase_link_id = v_replacement_link AND track_id = 'ENGINE_OIC_EW') <> 'active' THEN
    RAISE EXCEPTION 'Replacement subscription did not grant the verified track';
  END IF;

  -- A replaced predecessor must not be reactivated by an old token or stale notification.
  BEGIN
    PERFORM public.sync_google_play_subscription_atomic(
      v_user_one, 'token-user-one-initial', pg_catalog.repeat('a', 64),
      ARRAY['hyperion_gmdss_pass']::text[],
      'SUBSCRIPTION_STATE_CANCELED', 'active', v_future,
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('product_code', 'gmdss', 'track_id', 'GMDSS_GOC', 'status', 'active', 'expires_at', v_future::text)
      ),
      NULL
    );
    RAISE EXCEPTION 'Expected replaced predecessor token to be rejected' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE '%replaced Google Play purchase token%' THEN RAISE; END IF;
  END;
  IF (SELECT status FROM public.google_play_purchase_links WHERE id = v_link_one) <> 'inactive' THEN
    RAISE EXCEPTION 'Replaced predecessor link became active again';
  END IF;
  IF EXISTS (SELECT 1 FROM public.google_play_entitlements WHERE purchase_link_id = v_link_one AND status = 'active') THEN
    RAISE EXCEPTION 'Replaced predecessor entitlement was restored';
  END IF;

  -- Inactive/on-hold subscriptions revoke access, even if a stale entitlement array is supplied.
  PERFORM public.sync_google_play_subscription_atomic(
    v_user_one, 'token-user-one-replacement', pg_catalog.repeat('b', 64),
    ARRAY[]::text[], 'SUBSCRIPTION_STATE_ON_HOLD', 'inactive', v_future,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('product_code', 'engine_ew', 'track_id', 'ENGINE_OIC_EW', 'status', 'active', 'expires_at', v_future::text)
    ),
    NULL
  );
  IF EXISTS (SELECT 1 FROM public.google_play_entitlements WHERE purchase_link_id = v_replacement_link AND status = 'active') THEN
    RAISE EXCEPTION 'Inactive subscription retained access';
  END IF;

  -- Expired state/expiry fails closed even if the input status claims active.
  PERFORM public.sync_google_play_subscription_atomic(
    v_user_one, 'token-user-one-expired', pg_catalog.repeat('c', 64),
    ARRAY['hyperion_oic_nw_pass']::text[], 'SUBSCRIPTION_STATE_EXPIRED', 'active', v_past,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('product_code', 'oic_nw', 'track_id', 'DECK_OIC_NW', 'status', 'active', 'expires_at', v_past::text)
    ),
    NULL
  );
  IF EXISTS (
    SELECT 1 FROM public.google_play_entitlements
    WHERE purchase_link_id = (SELECT id FROM public.google_play_purchase_links WHERE purchase_token_sha256 = pg_catalog.repeat('c', 64))
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Expired subscription received an active entitlement';
  END IF;

  -- A duplicate token hash cannot be linked to another Hyperion user.
  BEGIN
    PERFORM public.sync_google_play_subscription_atomic(
      v_user_two, 'attacker-token', pg_catalog.repeat('d', 64),
      ARRAY['hyperion_oic_nw_pass']::text[], 'SUBSCRIPTION_STATE_ACTIVE', 'active', v_future,
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('product_code', 'oic_nw', 'track_id', 'DECK_OIC_NW', 'status', 'active', 'expires_at', v_future::text)
      ),
      NULL
    );
    RAISE EXCEPTION 'Expected duplicate cross-account token to be rejected' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '23505' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE '%already linked to another user%' THEN RAISE; END IF;
  END;

  -- A replacement link belonging to a different account must not be retired.
  v_user_two_link := public.sync_google_play_subscription_atomic(
    v_user_two, 'token-user-two', pg_catalog.repeat('d', 64),
    ARRAY['hyperion_oic_nw_pass']::text[], 'SUBSCRIPTION_STATE_ACTIVE', 'active', v_future,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('product_code', 'oic_nw', 'track_id', 'DECK_OIC_NW', 'status', 'active', 'expires_at', v_future::text)
    ),
    NULL
  );
  BEGIN
    PERFORM public.sync_google_play_subscription_atomic(
      v_user_one, 'cross-account-replacement-attempt', pg_catalog.repeat('e', 64),
      ARRAY['hyperion_gmdss_pass']::text[], 'SUBSCRIPTION_STATE_ACTIVE', 'active', v_future,
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('product_code', 'gmdss', 'track_id', 'GMDSS_GOC', 'status', 'active', 'expires_at', v_future::text)
      ),
      v_user_two_link
    );
    RAISE EXCEPTION 'Expected cross-account replacement to be rejected' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '23503' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE '%not owned by this user%' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.google_play_purchase_links WHERE purchase_token_sha256 = pg_catalog.repeat('e', 64)) THEN
    RAISE EXCEPTION 'Failed cross-account replacement left a partial purchase-link row';
  END IF;
  IF (SELECT status FROM public.google_play_purchase_links WHERE id = v_user_two_link) <> 'active' THEN
    RAISE EXCEPTION 'Cross-account replacement modified the other account link';
  END IF;

  -- Duplicate track rows and malformed token hashes are rejected before writes.
  BEGIN
    PERFORM public.sync_google_play_subscription_atomic(
      v_user_one, 'duplicate-track-token', pg_catalog.repeat('f', 64),
      ARRAY['hyperion_oic_nw_pass']::text[], 'SUBSCRIPTION_STATE_ACTIVE', 'active', v_future,
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('product_code', 'oic_nw', 'track_id', 'DECK_OIC_NW', 'status', 'active', 'expires_at', v_future::text),
        pg_catalog.jsonb_build_object('product_code', 'oic_nw', 'track_id', 'DECK_OIC_NW', 'status', 'active', 'expires_at', v_future::text)
      ),
      NULL
    );
    RAISE EXCEPTION 'Expected duplicate track rows to be rejected' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE '%Duplicate track%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.sync_google_play_subscription_atomic(
      v_user_one, 'malformed-hash-token', 'not-a-sha256',
      ARRAY['hyperion_oic_nw_pass']::text[], 'SUBSCRIPTION_STATE_ACTIVE', 'active', v_future,
      '[]'::jsonb, NULL
    );
    RAISE EXCEPTION 'Expected malformed token hash to be rejected' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE '%Invalid Google Play entitlement reconciliation input%' THEN RAISE; END IF;
  END;
END;
$tests$;

-- The authenticated role can read its own grants, not another account's grants.
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
DO $rls$
DECLARE
  v_count integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_count FROM public.google_play_entitlements;
  IF v_count = 0 THEN RAISE EXCEPTION 'RLS test account unexpectedly sees no entitlements'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.google_play_entitlements
    WHERE user_id <> auth.uid()
  ) THEN
    RAISE EXCEPTION 'Google Play entitlement RLS exposed another account';
  END IF;
END;
$rls$;
RESET ROLE;

DO $privileges$
BEGIN
  IF pg_catalog.has_table_privilege('authenticated', 'public.google_play_purchase_links', 'SELECT') THEN
    RAISE EXCEPTION 'Authenticated users must not read raw Google Play purchase tokens';
  END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.google_play_purchase_links', 'SELECT') THEN
    RAISE EXCEPTION 'Service role must be able to read Google Play purchase links';
  END IF;
END;
$privileges$;
