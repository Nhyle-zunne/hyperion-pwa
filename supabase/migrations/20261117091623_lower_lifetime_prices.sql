begin;

-- Preserve historical PayMongo checkouts without changing their stored charge,
-- while new lifetime orders use the reduced catalogue prices.
-- The cutover predates this deployment; confirmed historical orders are earlier.
alter table public.lifetime_orders drop constraint lifetime_order_catalog;
alter table public.lifetime_orders add constraint lifetime_order_catalog check (
  (product_code = 'gmdss' and track_id = 'GMDSS_GOC' and amount_php = 599) or
  (product_code = 'oic_nw' and track_id = 'DECK_OIC_NW' and amount_php = 999) or
  (product_code = 'engine_ew' and track_id = 'ENGINE_OIC_EW' and amount_php = 999) or
  (product_code = 'deck_mgt' and track_id = 'DECK_MGT' and amount_php = 1999) or
  (product_code = 'engine_mgt' and track_id = 'ENGINE_MGT' and amount_php = 1999) or
  (
    created_at < timestamptz '2026-11-17 09:00:00+00' and (
      (product_code = 'gmdss' and track_id = 'GMDSS_GOC' and amount_php = 1999) or
      (product_code = 'oic_nw' and track_id = 'DECK_OIC_NW' and amount_php = 2499) or
      (product_code = 'engine_ew' and track_id = 'ENGINE_OIC_EW' and amount_php = 2499) or
      (product_code = 'deck_mgt' and track_id = 'DECK_MGT' and amount_php = 4999) or
      (product_code = 'engine_mgt' and track_id = 'ENGINE_MGT' and amount_php = 4999)
    )
  )
);

commit;
