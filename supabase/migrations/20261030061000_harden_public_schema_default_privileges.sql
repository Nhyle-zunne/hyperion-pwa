-- Keep newly created objects in the exposed public schema deny-by-default.
-- Browser roles receive only the explicit grants required by each feature migration.
-- Supabase may create application objects as either postgres or supabase_admin.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Payment instructions are intentionally public, but the table is read-only
-- to browser roles. In Postgres 17, MAINTAIN is a separate table privilege.
REVOKE ALL PRIVILEGES ON TABLE public.payment_settings FROM PUBLIC, anon, authenticated;
REVOKE MAINTAIN ON TABLE public.payment_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.payment_settings TO anon, authenticated;
