-- Store the customer's submitted profile with each manual-payment order.
-- Existing historical orders remain valid; newly submitted orders validate the name in the Edge Function.
alter table public.orders add column if not exists customer_name text;
alter table public.orders add column if not exists customer_company text;
alter table public.orders add column if not exists customer_school text;
