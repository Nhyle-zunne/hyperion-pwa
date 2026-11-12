begin;

-- Question images are protected licensed question-bank assets. They are NEVER
-- publicly served by Supabase Storage and cannot be downloaded directly via
-- the client anon/authenticated roles. The question-media Edge Function checks
-- the user's current paid entitlement on every cache miss.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'question-bank-media',
  'question-bank-media',
  false,
  524288,
  array['image/webp','image/png','image/jpeg']::text[]
)
on conflict (id) do nothing;

do $$
declare b record;
begin
  select public, file_size_limit, allowed_mime_types into b
  from storage.buckets where id='question-bank-media';
  if not found or b.public or b.file_size_limit is distinct from 524288 or
    b.allowed_mime_types is distinct from array['image/webp','image/png','image/jpeg']::text[] then
    raise exception 'Protected question media bucket configuration is not safe';
  end if;
end
$$;

-- No storage.objects public/anon/authenticated policies are created. Only
-- service-role requests made AFTER Edge authentication may upload/download.
-- This migration changes no existing question banks, existing buckets,
-- entitlement tables, user progress, or historic question IDs.
commit;
