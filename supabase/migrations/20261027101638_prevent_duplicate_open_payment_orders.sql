create unique index if not exists orders_one_open_per_user_product_uq
on public.orders (user_id, product_code)
where status in ('pending', 'submitted');
