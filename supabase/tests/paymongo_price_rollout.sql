-- Isolated regression for the price increase and historical PayMongo checkouts.
-- Run only against disposable local Supabase. This transaction intentionally rolls back.
BEGIN;

INSERT INTO auth.users (id)
VALUES ('77777777-7777-4777-8777-777777777777')
ON CONFLICT DO NOTHING;

DO $price_checks$
DECLARE
  v_user uuid := '77777777-7777-4777-8777-777777777777';
  v_case record;
  v_variant text;
  v_price integer;
  v_index integer := 0;
  v_order_id uuid;
  v_batch_id uuid;
  v_result jsonb;
  v_amount_oic integer;
  v_amount_gmdss integer;
  v_session text;
  v_payment text;
BEGIN
  -- Every track and term must accept both a legacy recorded amount and the
  -- updated amount. The finalizer is called only after provider verification.
  FOR v_case IN
    SELECT * FROM (VALUES
      ('oic_nw', 'DECK_OIC_NW', 'week', 20, 29),
      ('oic_nw', 'DECK_OIC_NW', 'month', 50, 79),
      ('oic_nw', 'DECK_OIC_NW', 'year', 350, 499),
      ('engine_ew', 'ENGINE_OIC_EW', 'week', 20, 29),
      ('engine_ew', 'ENGINE_OIC_EW', 'month', 50, 79),
      ('engine_ew', 'ENGINE_OIC_EW', 'year', 350, 499),
      ('gmdss', 'GMDSS_GOC', 'week', 15, 25),
      ('gmdss', 'GMDSS_GOC', 'month', 40, 59),
      ('gmdss', 'GMDSS_GOC', 'year', 250, 399),
      ('deck_mgt', 'DECK_MGT', 'week', 40, 59),
      ('deck_mgt', 'DECK_MGT', 'month', 100, 149),
      ('deck_mgt', 'DECK_MGT', 'year', 700, 999),
      ('engine_mgt', 'ENGINE_MGT', 'week', 40, 59),
      ('engine_mgt', 'ENGINE_MGT', 'month', 100, 149),
      ('engine_mgt', 'ENGINE_MGT', 'year', 700, 999)
    ) AS prices(product_code, track_id, license_term, old_price, new_price)
  LOOP
    FOREACH v_price IN ARRAY ARRAY[v_case.old_price, v_case.new_price]
    LOOP
      v_index := v_index + 1;
      v_session := 'cs_price_test_' || v_index;
      v_payment := 'pay_price_test_' || v_index;
      INSERT INTO public.orders (
        user_id, product_code, track_id, license_term, amount_php,
        currency, status, payment_method, paymongo_checkout_session_id
      ) VALUES (
        v_user, v_case.product_code, v_case.track_id,
        v_case.license_term, v_price, 'PHP', 'pending',
        'PayMongo Checkout', v_session
      ) RETURNING id INTO v_order_id;

      v_result := public.finalize_paymongo_checkout(
        v_order_id, v_session, v_payment, 'PayMongo · QR Ph',
        'PHP', v_price::bigint * 100
      );
      IF v_result->>'status' <> 'paid'
         OR (v_result->>'totalPhp')::integer <> v_price
         OR (SELECT status FROM public.orders WHERE id = v_order_id) <> 'paid'
         OR NOT EXISTS (
           SELECT 1 FROM public.entitlements
            WHERE user_id = v_user AND product_code = v_case.product_code
              AND order_id = v_order_id AND status = 'active'
         ) THEN
        RAISE EXCEPTION 'PayMongo finalizer did not grant expected %/% price %', v_case.product_code, v_case.license_term, v_price;
      END IF;
      v_result := public.finalize_paymongo_checkout(
        v_order_id, v_session, v_payment, 'PayMongo · QR Ph',
        'PHP', v_price::bigint * 100
      );
      IF v_result->>'duplicate' <> 'true' THEN
        RAISE EXCEPTION 'Repeated payment must be idempotent: %', v_payment;
      END IF;
    END LOOP;
  END LOOP;

  -- Finalize full two-track baskets under both price schedules.
  FOREACH v_variant IN ARRAY ARRAY['legacy', 'new']
  LOOP
    v_index := v_index + 1;
    v_amount_oic := CASE WHEN v_variant = 'legacy' THEN 350 ELSE 499 END;
    v_amount_gmdss := CASE WHEN v_variant = 'legacy' THEN 40 ELSE 59 END;
    v_session := 'cs_price_basket_' || v_index;
    v_payment := 'pay_price_basket_' || v_index;
    INSERT INTO public.checkout_batches (
      user_id, product_codes, license_terms, amount_php,
      currency, status, payment_method, paymongo_checkout_session_id
    ) VALUES (
      v_user, ARRAY['oic_nw','gmdss'], ARRAY['year','month'],
      v_amount_oic + v_amount_gmdss, 'PHP', 'pending',
      'PayMongo Checkout', v_session
    ) RETURNING id INTO v_batch_id;
    INSERT INTO public.orders (
      user_id, product_code, track_id, license_term, amount_php,
      currency, status, payment_method, checkout_batch_id
    ) VALUES
      (v_user, 'oic_nw', 'DECK_OIC_NW', 'year', v_amount_oic,
       'PHP', 'pending', 'PayMongo Checkout', v_batch_id),
      (v_user, 'gmdss', 'GMDSS_GOC', 'month', v_amount_gmdss,
       'PHP', 'pending', 'PayMongo Checkout', v_batch_id);
    v_result := public.finalize_paymongo_checkout(
      v_batch_id, v_session, v_payment, 'PayMongo · QR Ph',
      'PHP', (v_amount_oic + v_amount_gmdss)::bigint * 100
    );
    IF v_result->>'status' <> 'paid'
       OR (v_result->>'totalPhp')::integer <> (v_amount_oic + v_amount_gmdss)
       OR (SELECT count(*) FROM public.orders
            WHERE checkout_batch_id = v_batch_id AND status = 'paid') <> 2 THEN
      RAISE EXCEPTION '% basket was not finalized correctly', v_variant;
    END IF;
    v_result := public.finalize_paymongo_checkout(
      v_batch_id, v_session, v_payment, 'PayMongo · QR Ph',
      'PHP', (v_amount_oic + v_amount_gmdss)::bigint * 100
    );
    IF v_result->>'duplicate' <> 'true' THEN
      RAISE EXCEPTION '% basket was not idempotent', v_variant;
    END IF;
  END LOOP;

  -- A provider-paid amount matching an arbitrary altered order price is NOT
  -- sufficient: the canonical price guard must reject that recorded price.
  INSERT INTO public.orders (
    user_id, product_code, track_id, license_term, amount_php,
    currency, status, payment_method, paymongo_checkout_session_id
  ) VALUES (
    v_user, 'oic_nw', 'DECK_OIC_NW', 'week', 999,
    'PHP', 'pending', 'PayMongo Checkout', 'cs_tampered_price'
  ) RETURNING id INTO v_order_id;
  BEGIN
    PERFORM public.finalize_paymongo_checkout(
      v_order_id, 'cs_tampered_price', 'pay_tampered_price',
      'PayMongo · QR Ph', 'PHP', 99900
    );
    RAISE EXCEPTION 'Arbitrary tampered checkout price was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    NULL;
  END;
  IF (SELECT status FROM public.orders WHERE id = v_order_id) <> 'pending' THEN
    RAISE EXCEPTION 'Rejected tampered checkout changed the order status';
  END IF;

  -- Still reject a provider amount that does not match an otherwise valid order.
  INSERT INTO public.orders (
    user_id, product_code, track_id, license_term, amount_php,
    currency, status, payment_method, paymongo_checkout_session_id
  ) VALUES (
    v_user, 'engine_ew', 'ENGINE_OIC_EW', 'week', 29,
    'PHP', 'pending', 'PayMongo Checkout', 'cs_wrong_minor_units'
  ) RETURNING id INTO v_order_id;
  BEGIN
    PERFORM public.finalize_paymongo_checkout(
      v_order_id, 'cs_wrong_minor_units', 'pay_wrong_minor_units',
      'PayMongo · QR Ph', 'PHP', 2800
    );
    RAISE EXCEPTION 'Incorrect provider amount was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    NULL;
  END;
  BEGIN
    PERFORM public.finalize_paymongo_checkout(
      v_order_id, 'cs_other_session', 'pay_other_session',
      'PayMongo · QR Ph', 'PHP', 2900
    );
    RAISE EXCEPTION 'Wrong checkout session was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    NULL;
  END;
  BEGIN
    PERFORM public.finalize_paymongo_checkout(
      v_order_id, 'cs_wrong_minor_units', 'pay_wrong_currency',
      'PayMongo · QR Ph', 'USD', 2900
    );
    RAISE EXCEPTION 'Wrong currency was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
END
$price_checks$;

ROLLBACK;
