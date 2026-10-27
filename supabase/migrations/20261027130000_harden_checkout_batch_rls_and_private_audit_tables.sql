-- Keep the checkout ownership predicate index-friendly under concurrent reads.
DROP POLICY IF EXISTS "Users read own checkout batches" ON public.checkout_batches;
CREATE POLICY "Users read own checkout batches"
  ON public.checkout_batches
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- These tables are backend-only audit/reconciliation records. No browser role
-- should have direct privileges; service_role and postgres retain operational access.
REVOKE ALL ON TABLE public.license_admin_audit FROM anon, authenticated;
REVOKE ALL ON TABLE public.paymongo_reconciliation_alerts FROM anon, authenticated;
