-- Checkout starts disabled until an authenticated Hyperion administrator enables it.
-- The existing payment_settings SELECT policy allows public reads; writes remain
-- restricted to the service role through admin-payment-review.
alter table public.payment_settings
  add column if not exists website_checkout_enabled boolean not null default false;
