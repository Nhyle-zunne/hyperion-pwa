-- Read-only security assertions, run after local Supabase migrations.
DO $assert$
DECLARE
  bucket record;
  rls_enabled boolean;
BEGIN
  SELECT public,file_size_limit,allowed_mime_types INTO bucket
  FROM storage.buckets WHERE id='question-bank-media';
  IF NOT FOUND OR bucket.public OR bucket.file_size_limit IS DISTINCT FROM 524288 OR
     bucket.allowed_mime_types IS DISTINCT FROM
       array['image/webp','image/png','image/jpeg']::text[] THEN
    RAISE EXCEPTION 'Licensed question media bucket is not private and bounded';
  END IF;

  SELECT relrowsecurity INTO rls_enabled FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='storage' and c.relname='objects';
  IF NOT coalesce(rls_enabled,false) THEN
    RAISE EXCEPTION 'Supabase Storage objects must enforce RLS';
  END IF;

  -- Media access is mediated by a user-verified Edge Function with service
  -- role Storage access. No client-visible direct Storage policy is installed.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND (roles @> ARRAY['anon']::name[] OR roles @> ARRAY['authenticated']::name[] OR
           roles @> ARRAY['public']::name[])
      AND (
        coalesce(qual,'')='true' OR coalesce(with_check,'')='true' OR
        qual ILIKE '%question-bank-media%' OR with_check ILIKE '%question-bank-media%'
      )
  ) THEN
    RAISE EXCEPTION 'Question-media direct client Storage policy would bypass paid licenses';
  END IF;
END
$assert$;
