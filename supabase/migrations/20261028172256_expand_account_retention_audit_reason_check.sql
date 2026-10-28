ALTER TABLE public.account_retention_audit
  DROP CONSTRAINT IF EXISTS account_retention_audit_reason_check;

ALTER TABLE public.account_retention_audit
  ADD CONSTRAINT account_retention_audit_reason_check
  CHECK (
    reason IN (
      'free_account_inactive_30_days',
      'license_expired_grace_period_ended',
      'free_account_inactivity_grace_ended',
      'license_expired_and_inactivity_grace_ended'
    )
  );
