-- Keep newly created objects in the exposed public schema deny-by-default.
-- Browser roles receive only the explicit grants required by each feature migration.
-- Current application tables are owned by postgres; migrations create new
-- application objects under that role. Do not alter Supabase's internal role ACLs.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Payment instructions are intentionally public, but the table is read-only
-- to browser roles. In Postgres 17, MAINTAIN is a separate table privilege.
REVOKE ALL PRIVILEGES ON TABLE public.payment_settings FROM PUBLIC, anon, authenticated;
REVOKE MAINTAIN ON TABLE public.payment_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.payment_settings TO anon, authenticated;
