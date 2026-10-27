create index if not exists orders_user_id_idx
  on public.orders (user_id);
create index if not exists entitlements_active_expiry_idx
  on public.entitlements (user_id, expires_at)
  where status = 'active';
create index if not exists entitlements_order_id_idx
  on public.entitlements (order_id);
