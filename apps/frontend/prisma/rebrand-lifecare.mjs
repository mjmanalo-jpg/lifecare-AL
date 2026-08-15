/**
 * One-off rebrand: Golden Hearth → LifeCare Living Solutions.
 *   • Renames the active organization + community (community located in Pasig City).
 *   • Migrates every role login to a clean role-based @lifecare.com email.
 *   • Resets every migrated account's password to "lifecare@2026" (Supabase Auth + bcrypt hash).
 *
 * Idempotent: re-running finds accounts by their NEW email if already migrated
 * and simply re-asserts the password. Run from apps/frontend:
 *   node prisma/rebrand-lifecare.mjs
 */
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

nextEnv.loadEnvConfig(process.cwd());

const NEW_PASSWORD = "lifecare@2026";

// Old login → new role-based login. Roles with more than one person keep every
// account (they are referenced by tasks/assignments) and get numbered suffixes.
const EMAIL_MAP = [
  ["admin@goldenhearth.com", "superadmin@lifecare.com"],
  ["facility.admin@goldenhearth.com", "facilityadmin@lifecare.com"],
  ["org.admin@goldenhearth.com", "orgadmin@lifecare.com"],
  ["billing.admin@goldenhearth.com", "billing@lifecare.com"],
  ["caremanager@goldenhearth.com", "caremanager@lifecare.com"],
  ["alan.reyes@goldenhearth.com", "physician@lifecare.com"],
  ["nutritionist@goldenhearth.com", "nutritionist@lifecare.com"],
  ["housekeeping@goldenhearth.com", "housekeeping@lifecare.com"],
  ["kitchen@goldenhearth.com", "kitchen@lifecare.com"],
  ["maintenance@goldenhearth.com", "maintenance@lifecare.com"],
  ["sarah.jenkins@goldenhearth.com", "nurse@lifecare.com"],
  ["rebecca.wilson@goldenhearth.com", "nurse2@lifecare.com"],
  ["caleb.randall@goldenhearth.com", "caregiver@lifecare.com"],
  ["james.mitchell@goldenhearth.com", "caregiver2@lifecare.com"],
  ["maria.santos@goldenhearth.com", "caregiver3@lifecare.com"],
  ["fleet.manager@goldenhearth.com", "fleet@lifecare.com"],
  ["james.miguel@goldenhearth.com", "driver@lifecare.com"],
  ["security.guard@goldenhearth.com", "security@lifecare.com"],
  ["john.pendelton@family.com", "family@lifecare.com"],
  ["arthur.pendelton@resident.com", "resident@lifecare.com"],
  // Test artifacts created via the app's invite/registration flows — rebrand the
  // domain so nothing @goldenhearth lingers (timestamped local parts are exact to this DB).
  ["fa.viewer.1785156752@goldenhearth.com", "facilityviewer@lifecare.com"],
  ["nurse.new1785158150@goldenhearth.com", "nurse3@lifecare.com"],
];

const prisma = new PrismaClient({
  // Use the direct (non-pooled) connection for scripts — the transaction pooler
  // ECHECKOUTTIMEOUTs on long-running batch work.
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Rebrand requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function main() {
  const admin = adminClient();
  const passwordHash = await bcrypt.hash(NEW_PASSWORD, 10);

  // 1) Rename organization ------------------------------------------------------
  const org = await prisma.organization.findFirst({ where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("No active organization found to rename");
  await prisma.organization.update({
    where: { id: org.id },
    data: { name: "LifeCare Living Solutions", slug: "lifecare-living-solutions" },
  });
  console.log(`Organization → LifeCare Living Solutions (${org.id})`);

  // 2) Rename community + relocate to Pasig City --------------------------------
  const community = await prisma.community.findFirst({ where: { organizationId: org.id, isActive: true }, orderBy: { createdAt: "asc" } });
  if (community) {
    await prisma.community.update({
      where: { id: community.id },
      data: { name: "LifeCare", code: "LIFECARE", city: "Pasig City", state: "Metro Manila" },
    });
    console.log(`Community → LifeCare · Pasig City (${community.id})`);
  } else {
    console.warn("No active community found — skipped community rename");
  }

  // 3) Migrate every role login + reset password --------------------------------
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw listed.error;
  const authByEmail = new Map(listed.data.users.map((u) => [String(u.email || "").toLowerCase(), u]));

  for (const [oldEmailRaw, newEmailRaw] of EMAIL_MAP) {
    const oldEmail = oldEmailRaw.toLowerCase();
    const newEmail = newEmailRaw.toLowerCase();

    // Prisma user may already be under the new email (re-run) — look up both.
    const dbUser = (await prisma.user.findUnique({ where: { email: oldEmail } }))
      || (await prisma.user.findUnique({ where: { email: newEmail } }));
    if (!dbUser) { console.warn(`  skip ${oldEmail} — no User row`); continue; }

    // Supabase Auth: update email + password (auth user is keyed by the old email
    // on first run, or by the new email on a re-run).
    const authUser = authByEmail.get(oldEmail) || authByEmail.get(newEmail);
    if (authUser) {
      const res = await admin.auth.admin.updateUserById(authUser.id, { email: newEmail, password: NEW_PASSWORD, email_confirm: true });
      if (res.error) throw new Error(`Auth update failed for ${oldEmail}: ${res.error.message}`);
    } else {
      const res = await admin.auth.admin.createUser({ email: newEmail, password: NEW_PASSWORD, email_confirm: true, user_metadata: { name: dbUser.name, role: dbUser.role } });
      if (res.error) throw new Error(`Auth create failed for ${newEmail}: ${res.error.message}`);
    }

    await prisma.user.update({
      where: { id: dbUser.id },
      data: { email: newEmail, passwordHash },
    });
    console.log(`  ${oldEmail} → ${newEmail}  (pw: ${NEW_PASSWORD})`);
  }

  console.log("\nRebrand complete.");
}

main()
  .catch((e) => { console.error("Rebrand failed:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
