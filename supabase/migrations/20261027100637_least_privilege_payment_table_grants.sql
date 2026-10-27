revoke all privileges on table public.orders, public.checkout_batches, public.entitlements from anon, authenticated;
grant select on table public.orders, public.checkout_batches, public.entitlements to authenticated;
