-- Isolated renewal regression. This transaction rolls back all synthetic data.
BEGIN;

INSERT INTO auth.users (id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222')
ON CONFLICT DO NOTHING;

DO $renewal_tests$
DECLARE
  v_user uuid := '11111111-1111-4111-8111-111111111111';
  v_other uuid := '22222222-2222-4222-8222-222222222222';
  v_paid uuid;
  v_renewal uuid;
  v_followup uuid;
  v_provider uuid;
  v_other_order uuid;
  v_initial timestamptz := now() + interval '5 days';
  v_current timestamptz;
  v_result jsonb;
  v_payment_id text := 'pay_license_renewal_test';
BEGIN
  INSERT INTO public.orders (
    user_id, product_code, track_id, license_term, amount_php,
    status, payment_method, paid_at
  ) VALUES (
    v_user, 'oic_nw', 'DECK_OIC_NW', 'week', 20,
    'paid', 'QR Ph (MariBank / InstaPay)', now()
  ) RETURNING id INTO v_paid;

  INSERT INTO public.entitlements (
    user_id, product_code, track_id, order_id, license_term,
    status, granted_at, renewed_at, expires_at
  ) VALUES (
    v_user, 'oic_nw', 'DECK_OIC_NW', v_paid, 'week',
    'active', now() - interval '2 days', now() - interval '2 days', v_initial
  );

  INSERT INTO public.orders (
    user_id, product_code, track_id, license_term, amount_php,
    status, payment_method
  ) VALUES (
    v_user, 'oic_nw', 'DECK_OIC_NW', 'week', 20,
    'submitted', 'QR Ph (MariBank / InstaPay)'
  ) RETURNING id INTO v_renewal;

  v_result := public.review_manual_payment(v_renewal, 'approve', 'admin@fixture.invalid');
  SELECT expires_at INTO v_current FROM public.entitlements
   WHERE user_id = v_user AND product_code = 'oic_nw';
  IF v_result->>'status' <> 'paid'
     OR v_current IS DISTINCT FROM v_initial + interval '7 days'
     OR (SELECT order_id FROM public.entitlements
          WHERE user_id = v_user AND product_code = 'oic_nw') <> v_renewal THEN
    RAISE EXCEPTION 'Manual renewal did not preserve remaining days';
  END IF;

  BEGIN
    PERFORM public.review_manual_payment(v_renewal, 'approve', 'admin@fixture.invalid');
    RAISE EXCEPTION 'Duplicate manual approval was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    NULL;
  END;
  IF (SELECT expires_at FROM public.entitlements
       WHERE user_id = v_user AND product_code = 'oic_nw') IS DISTINCT FROM v_current THEN
    RAISE EXCEPTION 'Duplicate manual approval changed expiry';
  END IF;

  INSERT INTO public.orders (
    user_id, product_code, track_id, license_term, amount_php,
    status, payment_method
  ) VALUES (
    v_user, 'oic_nw', 'DECK_OIC_NW', 'month', 50,
    'submitted', 'QR Ph (MariBank / InstaPay)'
  ) RETURNING id INTO v_followup;
  v_result := public.review_manual_payment(v_followup, 'approve', 'admin@fixture.invalid');
  IF (SELECT expires_at FROM public.entitlements
      WHERE user_id = v_user AND product_code = 'oic_nw') IS DISTINCT FROM
      (timezone('UTC', v_current) + interval '1 month') AT TIME ZONE 'UTC' THEN
    RAISE EXCEPTION 'Month renewal lost the already-paid term';
  END IF;
  SELECT expires_at INTO v_current FROM public.entitlements
    WHERE user_id = v_user AND product_code = 'oic_nw';

  INSERT INTO public.orders (
    user_id, product_code, track_id, license_term, amount_php,
    status, payment_method, paymongo_checkout_session_id
  ) VALUES (
    v_user, 'oic_nw', 'DECK_OIC_NW', 'week', 20,
    'pending', 'PayMongo Checkout', 'cs_license_renewal_test'
  ) RETURNING id INTO v_provider;

  v_result := public.finalize_paymongo_checkout(
    v_provider, 'cs_license_renewal_test', v_payment_id,
    'PayMongo · QR Ph', 'PHP', 2000
  );
  IF v_result->>'status' <> 'paid'
     OR (SELECT expires_at FROM public.entitlements
         WHERE user_id = v_user AND product_code = 'oic_nw') IS DISTINCT FROM v_current + interval '7 days' THEN
    RAISE EXCEPTION 'Verified provider renewal did not preserve remaining days';
  END IF;
  v_result := public.finalize_paymongo_checkout(
    v_provider, 'cs_license_renewal_test', v_payment_id,
    'PayMongo · QR Ph', 'PHP', 2000
  );
  IF v_result->>'duplicate' <> 'true'
    OR (SELECT expires_at FROM public.entitlements
        WHERE user_id = v_user AND product_code = 'oic_nw') IS DISTINCT FROM v_current + interval '7 days' THEN
    RAISE EXCEPTION 'Repeated provider payment extended the license twice';
  END IF;

  INSERT INTO public.orders (
    user_id, product_code, track_id, license_term, amount_php,
    status, payment_method, paid_at
  ) VALUES (
    v_other, 'oic_nw', 'DECK_OIC_NW', 'week', 20,
    'paid', 'QR Ph (MariBank / InstaPay)', now()
  ) RETURNING id INTO v_other_order;
  INSERT INTO public.entitlements (
    user_id, product_code, track_id, order_id, license_term,
    status, expires_at
  ) VALUES (
    v_other, 'oic_nw', 'DECK_OIC_NW', v_other_order, 'week',
    'active', v_initial
  );
  IF (SELECT expires_at FROM public.entitlements
      WHERE user_id = v_other AND product_code = 'oic_nw') IS DISTINCT FROM v_initial THEN
    RAISE EXCEPTION 'Renewal changed another account';
  END IF;
END
$renewal_tests$;

DO $private_grants$
BEGIN
  IF pg_catalog.has_function_privilege('anon',
       'public.review_manual_payment(uuid,text,text,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',
       'public.review_manual_payment(uuid,text,text,text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role',
       'public.review_manual_payment(uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Manual review function privilege regression';
  END IF;
END
$private_grants$;

ROLLBACK;
