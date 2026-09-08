/**
 * One-off: reset the Super Admin "Myla Reyes" password to SEED_PASSWORD.
 *   • Finds the User by email (myla.reyes@gritxl.com), falling back to mobile 09175843059.
 *   • Resets Supabase Auth password (update if the auth user exists, else create) + bcrypt hash.
 *   • Links User.authUserId if it wasn't set (password-less account activating for the first time).
 *
 * Idempotent — re-running just re-asserts the same password. Run from apps/frontend:
 *   SEED_PASSWORD='<strong-secret>' node prisma/reset-myla.mjs
 */
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

nextEnv.loadEnvConfig(process.cwd());

const NEW_PASSWORD = process.env.SEED_PASSWORD;
if (!NEW_PASSWORD) {
  console.error("Refusing to run: set SEED_PASSWORD to a strong, non-committed password first.");
  process.exit(1);
}
const EMAIL = "myla.reyes@gritxl.com";
const MOBILE_DIGITS = "09175843059".replace(/\D/g, "");

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Reset requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function main() {
  const admin = adminClient();
  const passwordHash = await bcrypt.hash(NEW_PASSWORD, 10);

  // 1) Locate the user — email is unique; mobile is the fallback (login key for staff).
  let dbUser = await prisma.user.findUnique({ where: { email: EMAIL.toLowerCase() } });
  if (!dbUser) {
    const candidates = await prisma.user.findMany({ where: { phone: { contains: MOBILE_DIGITS.slice(-9) } } });
    dbUser = candidates.find((u) => (u.phone || "").replace(/\D/g, "").endsWith(MOBILE_DIGITS.slice(-10))) || null;
  }
  if (!dbUser) throw new Error(`No User found for ${EMAIL} / ${MOBILE_DIGITS}`);
  console.log(`User: ${dbUser.name} <${dbUser.email}> role=${dbUser.role} phone=${dbUser.phone ?? "—"}`);

  // 2) Supabase Auth: update the existing auth user, or create one (password-less account).
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw listed.error;
  const authUser =
    listed.data.users.find((u) => u.id === dbUser.authUserId) ||
    listed.data.users.find((u) => String(u.email || "").toLowerCase() === dbUser.email.toLowerCase());

  let authUserId = dbUser.authUserId ?? undefined;
  if (authUser) {
    const res = await admin.auth.admin.updateUserById(authUser.id, { password: NEW_PASSWORD, email_confirm: true });
    if (res.error) throw new Error(`Auth update failed: ${res.error.message}`);
    authUserId = authUser.id;
    console.log(`  Supabase Auth password updated (${authUser.id})`);
  } else {
    const res = await admin.auth.admin.createUser({ email: dbUser.email, password: NEW_PASSWORD, email_confirm: true, user_metadata: { name: dbUser.name, role: dbUser.role } });
    if (res.error) throw new Error(`Auth create failed: ${res.error.message}`);
    authUserId = res.data.user.id;
    console.log(`  Supabase Auth user created (${authUserId})`);
  }

  // 3) Persist bcrypt hash + link authUserId (dev bcrypt path + prod Supabase path both work).
  await prisma.user.update({ where: { id: dbUser.id }, data: { passwordHash, authUserId } });
  console.log(`\nDone. Login: mobile ${MOBILE_DIGITS} (or ${dbUser.email})  pw set from SEED_PASSWORD`);
}

main()
  .catch((e) => { console.error("Reset failed:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
