-- Initial server-side comparison helper for no-op progress writes.
-- Superseded by compare_user_learning_progress() in the following migration.
CREATE OR REPLACE FUNCTION public.user_learning_progress_matches(
  p_user_id uuid,
  p_expected_updated_at timestamptz,
  p_data jsonb
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_learning_progress AS progress
     WHERE progress.user_id = p_user_id
       AND progress.updated_at = p_expected_updated_at
       AND pg_catalog.jsonb_typeof(progress.data) = 'object'
       AND pg_catalog.jsonb_typeof(p_data) = 'object'
       AND (progress.data - 'savedAt' - 'changedSections')
           = (p_data - 'savedAt' - 'changedSections')
  );
$$;

REVOKE ALL ON FUNCTION public.user_learning_progress_matches(uuid, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_learning_progress_matches(uuid, timestamptz, jsonb)
  TO service_role;
