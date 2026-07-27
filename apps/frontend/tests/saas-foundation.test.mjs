import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

function models(schema) {
  return [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map((match) => ({ name: match[1], body: match[2] }));
}

test("every tenant data model has direct organization and community ownership", () => {
  const controlPlane = new Set(["User", "Organization", "Community", "OrganizationMembership", "CommunityMembership", "ResidentAccess", "Invitation", "Plan", "PlanEntitlement", "Subscription", "UsageSnapshot"]);
  for (const model of models(read("prisma/schema.prisma"))) {
    if (controlPlane.has(model.name)) continue;
    assert.match(model.body, /^\s*organizationId\s/m, `${model.name} lacks organizationId`);
    assert.match(model.body, /^\s*communityId\s/m, `${model.name} lacks communityId`);
  }
});

test("generic CRUD applies server tenant scopes and transaction-local RLS context", () => {
  for (const route of ["src/app/api/db/[model]/route.ts", "src/app/api/db/[model]/[id]/route.ts"]) {
    const source = read(route);
    assert.match(source, /tenantWhere\(/);
    assert.match(source, /withTenantDb\(/);
    assert.match(source, /sanitizeTenantWrite|dedicated administration API/);
    assert.doesNotMatch(source, /Auto-seed audit log entries/);
  }
});

test("RLS migration is deny-by-default across tenant-owned tables", () => {
  const migration = read("prisma/migrations/20260723121000_tenant_rls/migration.sql");
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /app_can_access_tenant/);
  assert.match(migration, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon/);
  assert.match(migration, /app_current_community_id/);
});

test("workspace selection validates organization and community membership", () => {
  const source = read("src/app/api/workspaces/select/route.ts");
  assert.match(source, /organizationMembership\.findFirst/);
  assert.match(source, /communityMembership\.findFirst/);
  assert.match(source, /organizationId, isActive: true/);
  assert.match(source, /updateWorkspaceSession/);
});

test("production auth cannot fall back to local passwords or a default session secret", () => {
  assert.match(read("src/app/api/auth/session/route.ts"), /process\.env\.NODE_ENV === "production"/);
  assert.match(read("src/lib/auth.ts"), /SESSION_SECRET must be configured in production/);
  assert.doesNotMatch(read("../../.env.example"), /GEMINI_API_KEY="AIza/);
});
test("platform customer provisioning is separated from legacy super admin", () => {
  const organizations = read("src/app/api/platform/organizations/route.ts");
  const auth = read("src/lib/auth.ts");
  assert.match(organizations, /context\?\.platformRole !== "PLATFORM_ADMIN"/);
  assert.doesNotMatch(read("src/components/portal/views/SuperAdminDashboard.tsx"), /SaasPlatformConsole/);
  assert.match(read("src/components/portal/views/PlatformAdminPortalContent.tsx"), /Platform Admin Portal/);
  assert.match(read("src/app/api/auth/session/route.ts"), /user\.platformRole === "PLATFORM_ADMIN"[\s\S]*?\? "PLATFORM_ADMIN"/);
  assert.match(auth, /const VALID_ROLES: Role\[\] = \[[\s\S]*?"PLATFORM_ADMIN"/);
  assert.match(read("src/app\/[role\]\/layout.tsx"), /urlRole === "PLATFORM_ADMIN"/);
});

test("facility administrators can invite staff only within their active community", () => {
  const invitations = read("src/app/api/organizations/[id]/invitations/route.ts");
  assert.match(invitations, /context\?\.role === "FACILITY_ADMIN"/);
  assert.match(invitations, /communityId !== context\.communityId/);
  assert.match(invitations, /communityRole === "FACILITY_ADMIN"/);
  assert.match(invitations, /Facility administrators cannot assign organization roles/);
  const facilityPortal = read("src/components/portal/views/FacilityAdminPortalContent.tsx");
  assert.match(facilityPortal, /\/api\/organizations\/\$\{organizationId\}\/invitations/);
  assert.doesNotMatch(facilityPortal, /createRecord\("users"/);
});

test("the sample platform administrator is distinct and keeps its password out of source", () => {
  const seed = read("prisma/seed-auth.mjs");
  assert.match(seed, /platform\.admin@lifecarecms\.test/);
  assert.match(seed, /platformRole: "PLATFORM_ADMIN"/);
  assert.match(seed, /SAMPLE_PLATFORM_ADMIN_PASSWORD/);
  assert.doesNotMatch(seed, /SunriseTestHolding_2026/);
  const session = read("src/app/api/auth/session/route.ts");
  assert.match(session, /user\.platformRole === "PLATFORM_ADMIN"[\s\S]*?\? "PLATFORM_ADMIN"/);
  assert.match(session, /redirectUrl: `\/\$\{String\(role\)\.toLowerCase\(\)\}\/dashboard`/);
});

test("self-serve organization signup provisions a tenant without an SMTP invitation", () => {
  const route = read("src/app/api/register/organization/route.ts");
  // Identity is created directly (confirmed) rather than via an emailed invite.
  assert.match(route, /createSupabaseUser\(/);
  assert.doesNotMatch(route, /createInvitation|sendSupabaseInvitation/);
  // Feature is gated and defaults ON (only an explicit "false" disables it).
  assert.match(route, /ENABLE_PUBLIC_ORG_SIGNUP === "false"/);
  // Duplicate accounts are rejected before any provisioning.
  assert.match(route, /user\.findUnique\(\{ where: \{ email \}[\s\S]*?409/);
  // Owner membership + trial subscription are created for the new organization.
  assert.match(route, /role: "OWNER", status: "ACTIVE"/);
  assert.match(route, /status: "TRIALING"/);
  // Auto sign-in follows the same role/redirect derivation as the login route.
  assert.match(route, /createSession\(role, provisioned\.userId/);
  assert.match(route, /redirectUrl: `\/\$\{role\.toLowerCase\(\)\}\/dashboard`/);
});

test("the confirmed-user helper never triggers Supabase email delivery", () => {
  const helper = read("src/lib/supabaseAuth.ts");
  assert.match(helper, /export async function createSupabaseUser/);
  assert.match(helper, /\/admin\/users/);
  assert.match(helper, /email_confirm: true/);
});
