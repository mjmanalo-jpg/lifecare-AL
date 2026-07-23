-- Read-only preflight after the SaaS foundation migration.
DO $$
DECLARE row_record record; missing_count bigint;
BEGIN
  FOR row_record IN
    SELECT c1.table_name
    FROM information_schema.columns c1
    JOIN information_schema.columns c2 ON c2.table_schema = c1.table_schema AND c2.table_name = c1.table_name
    WHERE c1.table_schema = 'public' AND c1.column_name = 'organizationId' AND c2.column_name = 'communityId'
      AND c1.table_name NOT IN ('Invitation', 'UsageSnapshot', 'AuditLog', 'BlogPost', 'SiteContent', 'CustomPage')
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE "organizationId" IS NULL OR "communityId" IS NULL', row_record.table_name) INTO missing_count;
    IF missing_count > 0 THEN RAISE EXCEPTION 'Tenant backfill incomplete: % has % unscoped rows', row_record.table_name, missing_count; END IF;
  END LOOP;
END $$;

SELECT r."id" AS resident_id, r."organizationId", r."communityId", c."organizationId" AS community_organization
FROM "Resident" r JOIN "Community" c ON c."id" = r."communityId"
WHERE r."organizationId" <> c."organizationId";

SELECT s."id" AS staff_id, s."organizationId", s."communityId", c."organizationId" AS community_organization
FROM "Staff" s JOIN "Community" c ON c."id" = s."communityId"
WHERE s."organizationId" <> c."organizationId";

SELECT "communityId", "roomNumber", count(*)
FROM "Room" GROUP BY "communityId", "roomNumber" HAVING count(*) > 1;

SELECT "communityId", "roomNumber", count(*)
FROM "Resident" GROUP BY "communityId", "roomNumber" HAVING count(*) > 1;