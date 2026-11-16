-- Preserve pre-increase PayMongo orders while accepting the new server prices.
-- Payment, currency, provider session and product/track checks remain unchanged.
DO $pricing$
DECLARE
  v_function text;
  v_old_guard text := 'v_order.amount_php is distinct from v_expected_price';
  v_new_guard text := $new_guard$
    (v_order.amount_php is distinct from v_expected_price
      and v_order.amount_php is distinct from (
        case v_order.product_code
              when 'oic_nw' then case v_order.license_term when 'week' then 29 when 'month' then 79 when 'year' then 499 else null end
              when 'gmdss' then case v_order.license_term when 'week' then 25 when 'month' then 59 when 'year' then 399 else null end
              when 'engine_ew' then case v_order.license_term when 'week' then 29 when 'month' then 79 when 'year' then 499 else null end
              when 'deck_mgt' then case v_order.license_term when 'week' then 59 when 'month' then 149 when 'year' then 999 else null end
              when 'engine_mgt' then case v_order.license_term when 'week' then 59 when 'month' then 149 when 'year' then 999 else null end
          else null end
      ))
  $new_guard$;
  v_occurrences integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.finalize_paymongo_checkout(uuid,text,text,text,text,bigint,text,text,text)'::regprocedure
  ) INTO v_function;
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'PayMongo finalizer is missing. Refusing pricing migration.';
  END IF;
  v_occurrences := (
    length(v_function) - length(replace(v_function, v_old_guard, ''))
  ) / length(v_old_guard);
  IF v_occurrences <> 2 THEN
    RAISE EXCEPTION 'Expected two canonical price checks in PayMongo finalizer, found %', v_occurrences;
  END IF;
  EXECUTE replace(v_function, v_old_guard, v_new_guard);
END
$pricing$;
