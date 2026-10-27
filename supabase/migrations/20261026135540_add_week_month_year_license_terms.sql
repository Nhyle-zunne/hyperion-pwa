-- Licenses are fixed-term access: seven days, one calendar month, or one calendar year.
alter table public.orders
  add column if not exists license_term text not null default 'year';
alter table public.orders drop constraint if exists orders_license_term_check;
alter table public.orders add constraint orders_license_term_check
  check (license_term in ('week','month','year'));

alter table public.entitlements
  add column if not exists license_term text not null default 'year';
alter table public.entitlements drop constraint if exists entitlements_license_term_check;
alter table public.entitlements add constraint entitlements_license_term_check
  check (license_term in ('week','month','year'));

update public.entitlements
   set expires_at = granted_at + interval '1 year'
 where expires_at is null;

alter table public.checkout_batches
  add column if not exists license_terms text[];
update public.checkout_batches
   set license_terms = array_fill('year'::text, array[cardinality(product_codes)])
 where license_terms is null;
alter table public.checkout_batches
  alter column license_terms set default '{}',
  alter column license_terms set not null;
alter table public.checkout_batches drop constraint if exists checkout_batches_license_terms_check;
alter table public.checkout_batches add constraint checkout_batches_license_terms_check
  check (
    cardinality(license_terms) = cardinality(product_codes)
    and license_terms <@ array['week','month','year']::text[]
  );
