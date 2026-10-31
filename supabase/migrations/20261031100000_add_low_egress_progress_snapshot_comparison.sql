-- Avoid returning the full JSONB progress snapshot to Edge Functions on every
-- unchanged write. JSONB equality ignores object key order (like the edge
-- canonicalizer), while preserving array order and all meaningful nested data.
CREATE OR REPLACE FUNCTION public.compare_user_learning_progress(
  p_user_id uuid,
  p_expected_updated_at timestamptz,
  p_data jsonb
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_row public.user_learning_progress%ROWTYPE;
BEGIN
  SELECT *
    INTO current_row
    FROM public.user_learning_progress
   WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN CASE WHEN p_expected_updated_at IS NULL THEN 'missing' ELSE 'conflict' END;
  END IF;

  IF p_expected_updated_at IS NULL OR current_row.updated_at <> p_expected_updated_at THEN
    RETURN 'conflict';
  END IF;

  IF pg_catalog.jsonb_typeof(current_row.data) = 'object'
     AND pg_catalog.jsonb_typeof(p_data) = 'object'
     AND (current_row.data - 'savedAt' - 'changedSections')
         = (p_data - 'savedAt' - 'changedSections') THEN
    RETURN 'unchanged';
  END IF;

  RETURN 'changed';
END;
$$;

REVOKE ALL ON FUNCTION public.compare_user_learning_progress(uuid, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compare_user_learning_progress(uuid, timestamptz, jsonb)
  TO service_role;
