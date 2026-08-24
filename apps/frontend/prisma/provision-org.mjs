// Idempotent provisioning for a single SaaS tenant + one Organization Admin login.
// Mirrors seed-auth.mjs (Supabase Auth user + Prisma User + org/community memberships)
// but targets a named organization instead of the first ACTIVE one.
//
//   node prisma/provision-org.mjs
//
// Safe to re-run: organization (by slug), community (by org+code), Supabase
// identity (by email), user (by email), and both memberships are all upserts.
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

nextEnv.loadEnvConfig(process.cwd());

const ORG = { name: "Life Care 360", slug: "life-care-360" };
const COMMUNITY = { name: "Care360", code: "CARE360", city: "Pasig City", state: "Metro Manila", communityType: "ASSISTED_LIVING", bedsTotal: 60, bedsAvailable: 60 };
// Sample credential for the Organization Admin portal. orgRole ADMIN is what
// routes /api/auth/session to role ORGANIZATION_ADMIN → /organization_admin.
const ADMIN = { email: "orgadmin@care360.com", password: "care360@2026", name: "Care360 Organization Admin", firstName: "Organization", lastName: "Admin", phone: "09181000001", role: "FACILITY_ADMIN", orgRole: "ADMIN" };

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Provisioning requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function ensureAuthUser(admin, def) {
  const email = def.email.toLowerCase();
  const authInput = { password: def.password, email_confirm: true, user_metadata: { name: def.name, role: def.role } };
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw listed.error;
  const existing = listed.data.users.find((u) => String(u.email || "").toLowerCase() === email);
  if (existing) {
    const result = await admin.auth.admin.updateUserById(existing.id, authInput);
    if (result.error) throw result.error;
    return result.data.user;
  }
  const result = await admin.auth.admin.createUser({ email, ...authInput });
  if (result.error) throw result.error;
  return result.data.user;
}

async function main() {
  const prisma = new PrismaClient();
  const admin = adminClient();
  try {
    const organization = await prisma.organization.upsert({
      where: { slug: ORG.slug },
      update: { name: ORG.name, status: "ACTIVE" },
      create: { name: ORG.name, slug: ORG.slug, status: "ACTIVE" },
    });
    const community = await prisma.community.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: COMMUNITY.code } },
      update: { name: COMMUNITY.name, city: COMMUNITY.city, state: COMMUNITY.state, communityType: COMMUNITY.communityType, bedsTotal: COMMUNITY.bedsTotal, bedsAvailable: COMMUNITY.bedsAvailable, isActive: true },
      create: { organizationId: organization.id, name: COMMUNITY.name, code: COMMUNITY.code, city: COMMUNITY.city, state: COMMUNITY.state, communityType: COMMUNITY.communityType, bedsTotal: COMMUNITY.bedsTotal, bedsAvailable: COMMUNITY.bedsAvailable },
    });

    const email = ADMIN.email.toLowerCase();
    const authUser = await ensureAuthUser(admin, ADMIN);
    const passwordHash = await bcrypt.hash(ADMIN.password, 10);
    const user = await prisma.user.upsert({
      where: { email },
      update: { name: ADMIN.name, firstName: ADMIN.firstName, lastName: ADMIN.lastName, phone: ADMIN.phone, role: ADMIN.role, passwordHash, authUserId: authUser.id, isActive: true },
      create: { email, name: ADMIN.name, firstName: ADMIN.firstName, lastName: ADMIN.lastName, phone: ADMIN.phone, role: ADMIN.role, passwordHash, authUserId: authUser.id, isActive: true },
    });
    await prisma.organizationMembership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
      update: { role: ADMIN.orgRole, status: "ACTIVE" },
      create: { userId: user.id, organizationId: organization.id, role: ADMIN.orgRole, status: "ACTIVE" },
    });
    await prisma.communityMembership.upsert({
      where: { userId_communityId: { userId: user.id, communityId: community.id } },
      update: { role: ADMIN.role, status: "ACTIVE" },
      create: { userId: user.id, communityId: community.id, role: ADMIN.role, status: "ACTIVE" },
    });

    console.log(JSON.stringify({ ok: true, organization: { id: organization.id, name: organization.name, slug: organization.slug }, community: { id: community.id, name: community.name, code: community.code }, login: { email: ADMIN.email, password: ADMIN.password, portal: "/organization_admin/dashboard" } }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
