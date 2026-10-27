ALTER TABLE public.entitlements
  ALTER COLUMN order_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.license_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_code text NOT NULL CHECK (product_code = ANY (ARRAY['oic_nw','gmdss','engine_ew','deck_mgt','engine_mgt'])),
  track_id text NOT NULL CHECK (track_id = ANY (ARRAY['DECK_OIC_NW','GMDSS_GOC','ENGINE_OIC_EW','DECK_MGT','ENGINE_MGT'])),
  action text NOT NULL CHECK (action = ANY (ARRAY['grant','extend','revoke'])),
  prior_status text,
  new_status text NOT NULL CHECK (new_status = ANY (ARRAY['active','revoked'])),
  prior_expires_at timestamptz,
  new_expires_at timestamptz,
  license_term text CHECK (license_term IS NULL OR license_term = ANY (ARRAY['week','month','year'])),
  admin_user_id uuid NOT NULL REFERENCES auth.users(id),
  admin_email text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.license_admin_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.license_admin_audit FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS license_admin_audit_user_created_idx
  ON public.license_admin_audit (user_id, created_at DESC);
