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
