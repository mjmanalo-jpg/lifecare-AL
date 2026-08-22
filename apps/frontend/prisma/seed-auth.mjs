import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { ACCOUNT_DEFINITIONS } from "./account-definitions.mjs";

nextEnv.loadEnvConfig(process.cwd());

export const SEEDED_PASSWORD = process.env.SEED_ACCOUNT_PASSWORD;
if (!SEEDED_PASSWORD) throw new Error("Set SEED_ACCOUNT_PASSWORD explicitly before running the demo account seed");
if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_DEMO_SEED !== "true") {
  throw new Error("Production demo seeding is disabled. Set ALLOW_PRODUCTION_DEMO_SEED=true only for an isolated demo tenant.");
}

async function ensureTenant(prisma) {
  let organization = await prisma.organization.findFirst({ where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  if (!organization) {
    organization = await prisma.organization.create({ data: { name: "LifeCare Living Solutions", slug: "lifecare-living-solutions", status: "ACTIVE" } });
  }
  let community = await prisma.community.findFirst({ where: { organizationId: organization.id, isActive: true }, orderBy: { createdAt: "asc" } });
  if (!community) {
    community = await prisma.community.create({ data: { organizationId: organization.id, name: "LifeCare", code: "LIFECARE", city: "Pasig City", state: "Metro Manila", communityType: "ASSISTED_LIVING", bedsTotal: 60, bedsAvailable: 8 } });
  }
  return { organization, community };
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase account seeding requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function seedSaasAccounts(prisma) {
  const tenant = await ensureTenant(prisma);
  const admin = adminClient();
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw listed.error;
  const authByEmail = new Map(listed.data.users.map((user) => [String(user.email || "").toLowerCase(), user]));
  const users = {};

  for (const definition of ACCOUNT_DEFINITIONS) {
    const email = definition.email.toLowerCase();
    const accountPassword = definition.password || SEEDED_PASSWORD;
    const passwordHash = await bcrypt.hash(accountPassword, 10);
    let authUser = authByEmail.get(email);
    const authInput = { password: accountPassword, email_confirm: true, user_metadata: { name: definition.name, role: definition.platformRole || definition.role } };
    if (authUser) {
      const result = await admin.auth.admin.updateUserById(authUser.id, authInput);
      if (result.error) throw result.error;
      authUser = result.data.user;
    } else {
      const result = await admin.auth.admin.createUser({ email, ...authInput });
      if (result.error) throw result.error;
      authUser = result.data.user;
      authByEmail.set(email, authUser);
    }

    const isActive = definition.active !== false;
    const user = await prisma.user.upsert({
      where: { email },
      update: { name: definition.name, firstName: definition.firstName, lastName: definition.lastName, phone: definition.phone, role: definition.role, passwordHash, authUserId: authUser.id, platformRole: definition.platformRole || null, isActive },
      create: { email, name: definition.name, firstName: definition.firstName, lastName: definition.lastName, phone: definition.phone, role: definition.role, passwordHash, authUserId: authUser.id, platformRole: definition.platformRole || null, isActive },
    });
    users[email] = user;

    // Every non-platform account (including the facility SUPERADMIN) gets a
    // tenant membership so it has an active community — the portal layout
    // redirects community-less tenant roles back to the landing page.
    if (!definition.platformRole) {
      const membershipStatus = !isActive ? "SUSPENDED" : definition.approved === false ? "INVITED" : "ACTIVE";
      // Explicit orgRole override wins; otherwise Facility Admin defaults to org ADMIN.
      const orgRole = definition.orgRole || (definition.role === "FACILITY_ADMIN" ? "ADMIN" : "VIEWER");
      await prisma.organizationMembership.upsert({
        where: { userId_organizationId: { userId: user.id, organizationId: tenant.organization.id } },
        update: { role: orgRole, status: membershipStatus },
        create: { userId: user.id, organizationId: tenant.organization.id, role: orgRole, status: membershipStatus },
      });
      await prisma.communityMembership.upsert({
        where: { userId_communityId: { userId: user.id, communityId: tenant.community.id } },
        update: { role: definition.role, status: membershipStatus },
        create: { userId: user.id, communityId: tenant.community.id, role: definition.role, status: membershipStatus },
      });
    }
  }

  return { users, tenant, definitions: ACCOUNT_DEFINITIONS };
}

export async function linkSeedResidentAccess(prisma, users, resident, tenant) {
  if (!resident) return;
  const family = users["family@lifecare.com"];
  const residentUser = users["resident@lifecare.com"];
  await prisma.resident.update({ where: { id: resident.id }, data: { organizationId: tenant.organization.id, communityId: tenant.community.id, sponsorId: family?.id, userId: residentUser?.id } });
  if (family) await prisma.residentAccess.upsert({ where: { userId_residentId: { userId: family.id, residentId: resident.id } }, update: { accessRole: "FAMILY", isActive: true }, create: { userId: family.id, residentId: resident.id, accessRole: "FAMILY", isActive: true } });
  if (residentUser) await prisma.residentAccess.upsert({ where: { userId_residentId: { userId: residentUser.id, residentId: resident.id } }, update: { accessRole: "RESIDENT", isActive: true }, create: { userId: residentUser.id, residentId: resident.id, accessRole: "RESIDENT", isActive: true } });
}
