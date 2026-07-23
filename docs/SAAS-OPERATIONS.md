# Multi-tenant SaaS operations

## Release order

1. Restore the latest production backup into staging and rehearse both migrations with `npx prisma migrate deploy` from `apps/frontend`.
2. Run `prisma/tenant-backfill-report.sql`. Do not proceed if it raises an exception or reports ambiguous ownership.
3. Verify the migrated organization, community, memberships, room identifiers, resident access records, and subscription in the platform console.
4. Create a dedicated PostgreSQL login that does not own tables and does not have `BYPASSRLS`. Grant only schema usage, required table/sequence DML, and execution on `app_current_*`, `app_is_platform`, and `app_can_access_tenant`.
5. Put the migration-owner URL in `DATABASE_URL`/`DIRECT_URL` only for deployment migrations. Put the least-privilege login in `APP_DATABASE_URL` and `ASYNC_DATABASE_URL` for Next.js and FastAPI runtime traffic.
6. Deploy the application, enable `NEXT_PUBLIC_ENABLE_TENANT_REALTIME=true` only after authenticated Realtime policies have been tested, then execute the two-organization isolation suite.
7. Review logs for `401`, `403`, `404`, entitlement denials, invitation failures, and database policy violations before adding the second customer.

Never apply `supabase/migrations/0001_rls_setup.sql`; it is a stale pre-Prisma design.

Demo account seeding is never part of a production deployment. For an isolated staging/demo tenant only, set `SEED_ACCOUNT_PASSWORD` to a strong temporary value before running `npx prisma db seed`. Production additionally requires the deliberate `ALLOW_PRODUCTION_DEMO_SEED=true` override. Do not store the seed password in source control or deployment documentation.

## Applying the Prisma SaaS migrations to Supabase

Perform this procedure against a restored staging or test Supabase project first. Do not begin until a current backup exists and its restoration procedure has been verified.

### 1. Confirm the Prisma connection

The Prisma CLI loads `apps/frontend/.env`. Confirm that `DATABASE_URL` and `DIRECT_URL` point to the intended Supabase project:

```env
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."
```

Use the Supabase direct database connection for `DIRECT_URL`. URL-encode reserved password characters; for example, encode `@` as `%40`. Never print connection strings or commit environment files.

### 2. Validate the schema and inspect migration status

From PowerShell:

```powershell
cd C:\Users\ResolutAI\Documents\assisted-living\apps\frontend

npx prisma validate
npx prisma migrate status
```

The SaaS migrations are:

```text
20260723120000_saas_foundation
20260723121000_tenant_rls
```

The repository also contains the earlier `add_custom_page_fields` migration.

### 3. Baseline databases previously managed with `prisma db push`

If Prisma reports that the database is non-empty but has no migration history, determine whether the old custom-page change is already present. Run this read-only query in the Supabase SQL Editor:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'CustomPage'
  AND column_name IN (
    'description',
    'imageUrl',
    'pagePurpose',
    'parcelType'
  );
```

Only when all four columns already exist, record the old migration as applied:

```powershell
npx prisma migrate resolve --applied add_custom_page_fields
```

Do not mark a migration as applied when its schema changes are missing. Stop and reconcile the baseline instead. Never resolve the two SaaS migrations as applied without actually executing them.

Check the status again:

```powershell
npx prisma migrate status
```

Confirm that only the intended SaaS migrations remain pending.

### 4. Deploy the migrations

```powershell
npx prisma migrate deploy
```

Do not use `prisma db push` for staging or production. A successful deployment should apply the foundation migration followed by the RLS migration.

If deployment fails, stop application rollout, preserve the error output, and restore the rehearsed staging backup before retrying. Do not manually edit `_prisma_migrations` or repeatedly rerun a partially diagnosed failure.

### 5. Validate the tenant backfill

Run `apps/frontend/prisma/tenant-backfill-report.sql` in the Supabase SQL Editor. Do not proceed when it reports or raises an error for:

- Missing organization or community ownership
- Cross-community or cross-organization relationships
- Orphaned or ambiguous resident records
- Missing user memberships or resident-access mappings
- Duplicate tenant-scoped business identifiers
- Record-count reconciliation failures

After the report is clean:

```powershell
npx prisma migrate status
npx prisma generate
```

The migration status must report that the database schema is up to date.

### 6. Configure the runtime database role

Create the non-owner, non-`BYPASSRLS` runtime role described in the Runtime database role section below. Keep the migration-owner connection in deployment secrets and use the runtime role for application traffic:

```env
APP_DATABASE_URL="postgresql://app_runtime:...@.../postgres"
ASYNC_DATABASE_URL="postgresql+asyncpg://app_runtime:...@.../postgres"
```

Verify the role:

```sql
SELECT rolname, rolsuper, rolbypassrls
FROM pg_roles
WHERE rolname = 'app_runtime';
```

Both `rolsuper` and `rolbypassrls` must be `false`.

### 7. Provision the first platform administrator

Create the user in Supabase Authentication, use a unique email and strong temporary password, mark the email as confirmed, and copy the immutable Supabase Auth user UUID. Then link it to the application identity:

```sql
INSERT INTO "User" (
  "id",
  "authUserId",
  "role",
  "platformRole",
  "email",
  "name",
  "isActive",
  "createdAt",
  "updatedAt"
)
VALUES (
  gen_random_uuid()::text,
  '<supabase-auth-user-uuid>',
  'SUPERADMIN',
  'PLATFORM_ADMIN',
  '<platform-admin-email>',
  'Platform Administrator',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("email") DO UPDATE SET
  "authUserId" = EXCLUDED."authUserId",
  "role" = 'SUPERADMIN',
  "platformRole" = 'PLATFORM_ADMIN',
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;
```

Sign in through `/login`, enroll TOTP MFA immediately, verify access to the platform console, and replace the temporary password. Never store production credentials in documentation or source-controlled files.

### 8. Run the staging acceptance checks

Create two organizations and multiple communities, then test workspace switching, roles, spoofed tenant IDs, guessed resource IDs, plan limits, suspension, invitations, FastAPI, exports, and Realtime isolation. Keep `NEXT_PUBLIC_ENABLE_TENANT_REALTIME=false` until ordinary API and direct RLS tests pass.

Production rollout is blocked until the tenant-backfill report is clean, the complete isolation matrix passes, and a staging backup has been successfully restored.
## Supabase Auth

- Configure the application and `/invite/*` redirect URLs in Supabase Auth.
- Disable open public sign-up. Accounts enter through platform or organization invitations.
- Require verified email and MFA for platform administrators and organization owners/admins. Periodically review privileged membership and MFA reports.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only. Rotate it and all previously exposed API keys before production.
- Set a strong `SESSION_SECRET`; production startup intentionally fails when the development value remains.

## Runtime database role

Example structure (supply the password through your secret manager, never source control):

```sql
CREATE ROLE app_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT CONNECT ON DATABASE postgres TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
GRANT EXECUTE ON FUNCTION app_current_user_id() TO app_runtime;
GRANT EXECUTE ON FUNCTION app_current_organization_id() TO app_runtime;
GRANT EXECUTE ON FUNCTION app_current_community_id() TO app_runtime;
GRANT EXECUTE ON FUNCTION app_is_platform() TO app_runtime;
GRANT EXECUTE ON FUNCTION app_can_access_tenant(text, text) TO app_runtime;
```

Use narrower per-table grants when the module inventory stabilizes. Confirm `SELECT rolbypassrls FROM pg_roles WHERE rolname='app_runtime'` is false.

## HIPAA-ready operating controls

- Obtain appropriate BAAs before sending PHI to Supabase, hosting, email, AI, monitoring, storage, or support vendors.
- Enable encrypted backups and point-in-time recovery, then test restoration at least quarterly.
- Do not log request bodies, clinical text, names, room numbers, media, access tokens, or invitation tokens. Audit snapshots intentionally contain identifiers and state only.
- Define access review, termination, incident response, breach notification, retention, legal hold, data export, and secure deletion procedures.
- Keep production, staging, and demo tenants separate. Never copy production PHI into development.
- The local `public/uploads` implementation is for development only. Production PHI files require private object storage, tenant-prefixed keys, malware scanning, signed URLs, retention controls, and audit events.

## Deferred cutover

Tenant ownership columns are nullable for the compatibility release. After the backfill report is clean and all writers have run tenant-aware for a full release window, create a separate migration that makes tenant columns `NOT NULL` on tenant-owned tables. Do not combine that constraint cutover with initial backfill.
