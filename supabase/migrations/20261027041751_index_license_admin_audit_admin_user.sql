CREATE INDEX IF NOT EXISTS license_admin_audit_admin_user_idx
  ON public.license_admin_audit (admin_user_id, created_at DESC);
