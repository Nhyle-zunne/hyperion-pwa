DO $$
DECLARE
  v_definition text;
  v_old text := E' SET search_path TO \'public\', \'pg_temp\'';
  v_new text := E' SET search_path TO \'pg_catalog\', \'public\', \'pg_temp\'';
BEGIN
  SELECT pg_get_functiondef('public.finalize_paymongo_checkout(uuid,text,text,text,text,bigint,text,text,text)'::regprocedure)
    INTO v_definition;
  IF position(v_old in v_definition) = 0 THEN
    RAISE EXCEPTION 'Expected finalizer search_path declaration was not found; no changes applied.';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END $$;
