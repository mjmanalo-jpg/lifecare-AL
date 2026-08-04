-- Defense-in-depth tenant isolation. Server requests set transaction-local
-- context; Supabase Realtime falls back to auth.uid() plus membership tables.
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT COALESCE(
    nullif(current_setting('app.user_id', true), ''),
    (SELECT u."id" FROM public."User" u WHERE u."authUserId" = auth.uid()::text)
  )
$$;

CREATE OR REPLACE FUNCTION app_current_organization_id() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.organization_id', true), '') $$;
CREATE OR REPLACE FUNCTION app_current_community_id() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.community_id', true), '') $$;

CREATE OR REPLACE FUNCTION app_is_platform() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT COALESCE(nullif(current_setting('app.is_platform', true), '')::boolean, false)
    OR EXISTS (SELECT 1 FROM public."User" u WHERE u."id" = app_current_user_id() AND u."platformRole" IS NOT NULL)
$$;

CREATE OR REPLACE FUNCTION app_can_access_tenant(target_org text, target_community text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT app_is_platform()
    OR (
      (app_current_organization_id() IS NULL OR target_org = app_current_organization_id())
      AND (app_current_community_id() IS NULL OR target_community IS NULL OR target_community = app_current_community_id())
      AND (
        EXISTS (
          SELECT 1 FROM public."CommunityMembership" cm
          JOIN public."Community" c ON c."id" = cm."communityId"
          WHERE cm."userId" = app_current_user_id() AND cm."status" = 'ACTIVE'
            AND cm."communityId" = target_community AND c."organizationId" = target_org
        )
        OR EXISTS (
          SELECT 1 FROM public."OrganizationMembership" om
          WHERE om."userId" = app_current_user_id() AND om."status" = 'ACTIVE'
            AND om."organizationId" = target_org
            AND (target_community IS NULL OR om."role" IN ('OWNER', 'ADMIN'))
        )
      )
    )
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOR table_name IN
    SELECT c1.table_name
    FROM information_schema.columns c1
    JOIN information_schema.columns c2
      ON c2.table_schema = c1.table_schema AND c2.table_name = c1.table_name
    WHERE c1.table_schema = 'public' AND c1.column_name = 'organizationId' AND c2.column_name = 'communityId'
      AND c1.table_name NOT IN ('Invitation')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (app_can_access_tenant("organizationId", "communityId")) WITH CHECK (app_can_access_tenant("organizationId", "communityId"))',
      table_name
    );
  END LOOP;
END $$;

-- Audit records are append-only: authorized reads and inserts, never updates or deletes.
DROP POLICY IF EXISTS tenant_isolation ON "AuditLog";
CREATE POLICY audit_read ON "AuditLog" FOR SELECT
USING (app_is_platform() OR app_can_access_tenant("organizationId", "communityId"));
CREATE POLICY audit_insert ON "AuditLog" FOR INSERT
WITH CHECK (
  app_is_platform()
  OR app_can_access_tenant("organizationId", "communityId")
  OR ("organizationId" IS NULL AND "actorId" = app_current_user_id())
);
-- Messages and notifications are narrower than ordinary community data.
DROP POLICY IF EXISTS tenant_isolation ON "Message";
CREATE POLICY tenant_isolation ON "Message" FOR ALL
USING (app_is_platform() OR (("senderId" = app_current_user_id() OR "recipientId" = app_current_user_id()) AND app_can_access_tenant("organizationId", "communityId")))
WITH CHECK (app_is_platform() OR ("senderId" = app_current_user_id() AND app_can_access_tenant("organizationId", "communityId")));

DROP POLICY IF EXISTS tenant_isolation ON "Notification";
CREATE POLICY tenant_isolation ON "Notification" FOR ALL
USING (app_is_platform() OR ("userId" = app_current_user_id() AND app_can_access_tenant("organizationId", "communityId")))
WITH CHECK (app_is_platform() OR ("userId" = app_current_user_id() AND app_can_access_tenant("organizationId", "communityId")));

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
-- Grant the minimum table/sequence privileges to a separately provisioned
-- non-BYPASSRLS runtime role. Never use the migration owner for APP_DATABASE_URL.
CREATE POLICY platform_public_read ON "BlogPost" FOR SELECT USING ("organizationId" IS NULL AND "communityId" IS NULL);
CREATE POLICY platform_public_read ON "SiteContent" FOR SELECT USING ("organizationId" IS NULL AND "communityId" IS NULL);
CREATE POLICY platform_public_read ON "CustomPage" FOR SELECT USING ("organizationId" IS NULL AND "communityId" IS NULL);