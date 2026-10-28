-- Server-side private key for short-lived offline entitlement signatures.
-- Clients can read only the signed token through the question-bank Edge Function;
-- anon/authenticated cannot read or write this table directly.
CREATE TABLE IF NOT EXISTS public.offline_entitlement_signing_keys (
  id smallint PRIMARY KEY CHECK (id = 1),
  private_jwk jsonb NOT NULL,
  public_jwk jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.offline_entitlement_signing_keys ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.offline_entitlement_signing_keys FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.offline_entitlement_signing_keys TO service_role;
