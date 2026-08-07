-- ─────────────────────────────────────────────────────────────
-- Security hardening for the tenant-isolation helper functions.
--
-- Clears the Supabase Security Advisor findings:
--   • "Function Search Path Mutable"            — app_current_organization_id,
--                                                 app_current_community_id
--   • "Public Can Execute SECURITY DEFINER…"    — anon / PUBLIC EXECUTE
--   • "Signed-In Users Can Execute SECURITY…"   — authenticated EXECUTE
--
-- Safe because: these functions are only ever evaluated inside RLS policies,
-- the app connects as the owner (postgres) role via server routes, `anon` has
-- no table access (REVOKE ALL … FROM anon in 02_tenant_rls.sql), and the
-- `supabase_realtime` publication is empty (no postgres_changes stream relies
-- on anon/authenticated executing these). `postgres` (owner) and the trusted
-- server-only `service_role` retain EXECUTE.
-- ─────────────────────────────────────────────────────────────

-- 1) Pin a non-mutable search_path on the two context getters. They only call
--    pg_catalog builtins (nullif / current_setting), so an empty search_path is
--    sufficient and closes the search_path-hijacking vector.
ALTER FUNCTION public.app_current_organization_id() SET search_path = '';
ALTER FUNCTION public.app_current_community_id()    SET search_path = '';

-- 2) Drop the broad default EXECUTE grants (PUBLIC + Supabase's anon/authenticated).
REVOKE EXECUTE ON FUNCTION public.app_current_user_id()                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_current_organization_id()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_current_community_id()                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_is_platform()                         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_can_access_tenant(text, text)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()                          FROM PUBLIC, anon, authenticated;
