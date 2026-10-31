-- Expose only question-bank object version metadata to the trusted Edge Function.
-- This avoids downloading full encrypted bank files on routine offline-pack update checks.
create or replace function public.get_question_bank_object_versions(p_names text[])
returns table (
  name text,
  updated_at timestamptz,
  etag text,
  size bigint
)
language sql
stable
security definer
set search_path = pg_catalog, storage, public
as $function$
  select
    objects.name,
    objects.updated_at,
    objects.metadata ->> 'eTag' as etag,
    nullif(objects.metadata ->> 'size', '')::bigint as size
  from storage.objects as objects
  where objects.bucket_id = 'question-banks'
    and objects.name = any (p_names)
  order by objects.name;
$function$;

-- The function reads private Storage metadata under its owner privileges.
-- Never allow browser roles to invoke it; only trusted service_role code may do so.
revoke all on function public.get_question_bank_object_versions(text[]) from public, anon, authenticated;
grant execute on function public.get_question_bank_object_versions(text[]) to service_role;
