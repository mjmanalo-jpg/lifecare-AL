// Backfill real PH 11-digit mobile numbers onto existing accounts so they can
// use the huma-style company + mobile sign-in. Auto-generates unique numbers
// (0917 XXX XXXX) for anyone missing a valid one; the seeded @lifecare.com
// credentials get their fixed number from seed-auth.mjs.
//
// Passwords are NOT touched — existing accounts keep lifecare@2026.
//
// Run from apps/frontend:  node prisma/backfill-ph-phones.mjs
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { ACCOUNT_DEFINITIONS } from "./account-definitions.mjs";

nextEnv.loadEnvConfig(process.cwd());

// Scripts use the direct connection — the transaction pooler (6543) times out.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

/** Canonical mobile: digits only, last 10 (mirrors src/lib/mobileAuth.ts). */
const normalize = (raw) => String(raw ?? "").replace(/\D/g, "").slice(-10);
/** A valid PH mobile normalizes to 10 digits beginning with 9. */
const isValidPH = (raw) => { const n = normalize(raw); return n.length === 10 && n[0] === "9"; };

async function main() {
  // Fixed numbers for the seeded credentials (email → phone).
  const seedByEmail = new Map(
    ACCOUNT_DEFINITIONS.filter((d) => d.phone).map((d) => [d.email.toLowerCase(), d.phone]),
  );

  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, phone: true, role: true },
    orderBy: { createdAt: "asc" },
  });

  // Reserve every mobile already in use so generated numbers never collide.
  const used = new Set();
  for (const u of users) if (isValidPH(u.phone)) used.add(normalize(u.phone));
  for (const phone of seedByEmail.values()) used.add(normalize(phone));

  // Auto-generator: 0917 100 00NN, starting just past the seeded block.
  let seq = 17;
  const nextGenerated = () => {
    for (;;) {
      const phone = `0917100${String(seq).padStart(4, "0")}`;
      seq += 1;
      if (!used.has(normalize(phone))) { used.add(normalize(phone)); return phone; }
    }
  };

  const changes = [];
  for (const u of users) {
    const email = String(u.email || "").toLowerCase();
    let desired;
    if (seedByEmail.has(email)) desired = seedByEmail.get(email); // fixed credential number
    else if (isValidPH(u.phone)) continue;                        // already a good PH mobile — keep
    else desired = nextGenerated();                               // auto-generate a unique one

    if (normalize(u.phone) === normalize(desired)) continue;       // already correct
    await prisma.user.update({ where: { id: u.id }, data: { phone: desired } });
    changes.push({ email, name: u.name, role: u.role, phone: desired });
  }

  console.log(`\nUpdated ${changes.length} account(s) with PH mobile numbers. Password unchanged (lifecare@2026).\n`);
  for (const c of changes) {
    console.log(`  ${c.phone}  ${c.email.padEnd(32)} ${String(c.role).padEnd(16)} ${c.name || ""}`);
  }
  console.log("");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
