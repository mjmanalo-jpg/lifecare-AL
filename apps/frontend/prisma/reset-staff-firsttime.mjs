// Reset previously-provisioned STAFF accounts to first-time password setup.
//
// Background: staff created by the old Super Admin "Add Staff" flow got a
// generated temporary password (a bcrypt passwordHash), so mobile-login asked
// them to ENTER a password instead of showing the first-time setup screen. This
// clears passwordHash for those staff so their next login prompts them to set
// their own password (company name + mobile -> first-time setup), matching the
// new password-less provisioning.
//
// SAFETY:
//   - Scoped to the named organizations only.
//   - Excludes org OWNER/ADMIN, platform admins, and SUPERADMIN accounts, so
//     leadership logins are never touched.
//   - Only affects accounts that currently HAVE a passwordHash.
//   - Dry-run by default: prints who would be reset. Add --apply to execute.
//
// Run from apps/frontend:
//   node prisma/reset-staff-firsttime.mjs           # dry run (lists accounts)
//   node prisma/reset-staff-firsttime.mjs --apply   # actually clears passwordHash

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ORG_NAMES = ["LifeCare Living Solutions", "LifeCare Living Solutions Inc."];
const ADMIN_ORG_ROLES = new Set(["OWNER", "ADMIN"]);

async function main() {
  const orgs = await prisma.organization.findMany({
    where: { name: { in: ORG_NAMES } },
    select: { id: true, name: true },
  });
  if (!orgs.length) {
    console.log(`No organizations matched: ${ORG_NAMES.join(", ")}`);
    return;
  }
  const orgIds = orgs.map((o) => o.id);
  console.log(`Organizations: ${orgs.map((o) => `${o.name}`).join(", ")}\n`);

  const memberships = await prisma.communityMembership.findMany({
    where: { community: { organizationId: { in: orgIds } }, status: "ACTIVE" },
    select: {
      role: true,
      user: {
        select: {
          id: true, name: true, email: true, role: true, platformRole: true, passwordHash: true,
          organizationMemberships: { where: { organizationId: { in: orgIds } }, select: { role: true } },
        },
      },
    },
  });

  const targets = new Map();
  for (const m of memberships) {
    const u = m.user;
    if (!u) continue;
    if (u.platformRole) continue;                                    // platform admin — skip
    if (u.role === "SUPERADMIN") continue;                           // super admin — skip
    if (u.organizationMemberships.some((om) => ADMIN_ORG_ROLES.has(om.role))) continue; // org owner/admin — skip
    if (!u.passwordHash) continue;                                   // already password-less
    if (!targets.has(u.id)) targets.set(u.id, { name: u.name, email: u.email, role: m.role });
  }

  const list = [...targets.entries()];
  if (!list.length) {
    console.log("No staff accounts need resetting — they're already password-less.");
    return;
  }
  console.log(`${list.length} staff account(s) will be reset to first-time password setup:`);
  for (const [, t] of list) console.log(`  - ${t.name || "(no name)"} <${t.email}> · ${t.role}`);

  if (!APPLY) {
    console.log(`\nDry run only. Re-run with --apply to clear their password so they set a new one on next login.`);
    return;
  }
  const { count } = await prisma.user.updateMany({
    where: { id: { in: list.map(([id]) => id) } },
    data: { passwordHash: null },
  });
  console.log(`\nDone. Cleared the password on ${count} account(s). They will set their own password on next login (company name + mobile).`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
