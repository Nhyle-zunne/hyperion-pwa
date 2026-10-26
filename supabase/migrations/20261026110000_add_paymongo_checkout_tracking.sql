alter table public.orders add column if not exists paymongo_checkout_session_id text;
alter table public.orders add column if not exists paymongo_payment_id text;

create unique index if not exists orders_paymongo_checkout_session_uidx
  on public.orders (paymongo_checkout_session_id)
  where paymongo_checkout_session_id is not null;

create unique index if not exists orders_paymongo_payment_uidx
  on public.orders (paymongo_payment_id)
  where paymongo_payment_id is not null;
