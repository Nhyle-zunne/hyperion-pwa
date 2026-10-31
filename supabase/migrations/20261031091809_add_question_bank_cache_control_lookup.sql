CREATE OR REPLACE FUNCTION public.get_question_bank_object_cache_controls(p_names text[])
RETURNS TABLE (
  name text,
  cache_control text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, storage, public
AS $$
  SELECT
    objects.name,
    objects.metadata ->> 'cacheControl' AS cache_control
  FROM storage.objects AS objects
  WHERE objects.bucket_id = 'question-banks'
    AND objects.name = ANY (p_names)
  ORDER BY objects.name;
$$;

REVOKE ALL ON FUNCTION public.get_question_bank_object_cache_controls(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_question_bank_object_cache_controls(text[]) TO service_role;
