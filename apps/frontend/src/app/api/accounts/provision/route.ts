import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import type { Role } from "@prisma/client";
import { requireTenantContext, canManageOrganization, type TenantContext } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { createSupabaseUser, updateSupabaseUserPassword, SupabaseUserExistsError, isSupabaseAuthConfigured } from "@/lib/supabaseAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Readable, strong first-time password, e.g. "Care-7K3m-4820". Ambiguous
// characters (0/O, 1/l/I) are omitted so it's easy to read aloud / type.
function genPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const chunk = (n: number) => Array.from({ length: n }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `Care-${chunk(4)}-${chunk(4)}`;
}

type ProvisionResult = { email: string; password: string | null; status: "created" | "reset" | "existing_unchanged" };

// Create (or reset) a working login for one email and wire up the tenant links,
// mirroring the invitation-accept path: Supabase auth user → User → org+community
// membership → resident link (ResidentAccess+userId for RESIDENT, sponsorId for FAMILY).
async function provision(opts: { context: TenantContext; email: string; name: string; role: Role; residentId: string; reset: boolean; password?: string }): Promise<ProvisionResult> {
  const { context, email, name, role, residentId, reset } = opts;
  const organizationId = context.organizationId!;
  const communityId = context.communityId!;
  // Use the staff-entered password when given (min 6 chars enforced by the
  // caller), otherwise fall back to an auto-generated one.
  const password = opts.password && opts.password.length >= 6 ? opts.password : genPassword();

  const existingUser = await prisma.user.findUnique({ where: { email } });
  let authUserId: string | undefined = existingUser?.authUserId ?? undefined;
  let passwordSet = false;

  if (isSupabaseAuthConfigured()) {
    try {
      const created = await createSupabaseUser(email, password);
      authUserId = created.id;
      passwordSet = true;
    } catch (error) {
      if (error instanceof SupabaseUserExistsError) {
        // The auth user already exists. Only replace the password on an explicit reset.
        if (reset && authUserId) { await updateSupabaseUserPassword(authUserId, password); passwordSet = true; }
      } else {
        throw error;
      }
    }
  } else {
    // Dev without Supabase — bcrypt-only login is accepted.
    passwordSet = true;
  }

  const passwordHash = passwordSet ? await bcrypt.hash(password, 10) : undefined;

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.upsert({
      where: { email },
      create: { email, name: name || email.split("@")[0], role, isActive: true, ...(authUserId ? { authUserId } : {}), ...(passwordHash ? { passwordHash } : {}) },
      update: { isActive: true, ...(authUserId ? { authUserId } : {}), ...(passwordHash ? { passwordHash } : {}) },
    });
    await tx.organizationMembership.upsert({
      where: { userId_organizationId: { userId: u.id, organizationId } },
      create: { userId: u.id, organizationId, role: "VIEWER", status: "ACTIVE" },
      update: { status: "ACTIVE" },
    });
    await tx.communityMembership.upsert({
      where: { userId_communityId: { userId: u.id, communityId } },
      create: { userId: u.id, communityId, role, status: "ACTIVE" },
      update: { role, status: "ACTIVE" },
    });
    if (role === "RESIDENT") {
      await tx.residentAccess.upsert({
        where: { userId_residentId: { userId: u.id, residentId } },
        create: { userId: u.id, residentId, accessRole: "RESIDENT", isActive: true },
        update: { isActive: true },
      });
      await tx.resident.update({ where: { id: residentId }, data: { userId: u.id } });
    } else if (role === "FAMILY") {
      await tx.resident.update({ where: { id: residentId }, data: { sponsorId: u.id } });
    }
    return u;
  });

  const status: ProvisionResult["status"] = passwordSet ? (reset && existingUser ? "reset" : "created") : "existing_unchanged";
  return { email: user.email, password: passwordSet ? password : null, status };
}

export async function POST(request: NextRequest) {
  const context = await requireTenantContext({ requireCommunity: true });
  if (!context?.organizationId || !context.communityId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageOrganization(context) && !["FACILITY_ADMIN", "SUPERADMIN", "CARE_MANAGER"].includes(context.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const residentId = String(body.residentId || "").trim();
  if (!residentId) return NextResponse.json({ error: "residentId is required" }, { status: 400 });

  const resident = await prisma.resident.findFirst({ where: { id: residentId, communityId: context.communityId }, select: { id: true, firstName: true, lastName: true } });
  if (!resident) return NextResponse.json({ error: "Resident not found" }, { status: 404 });

  const reset = Boolean(body.reset);
  const residentEmail = String(body.residentEmail || "").toLowerCase().trim();
  const sponsorEmail = String(body.sponsorEmail || "").toLowerCase().trim();
  const sponsorName = String(body.sponsorName || "").trim();
  const residentPassword = String(body.residentPassword || "");
  const sponsorPassword = String(body.sponsorPassword || "");
  if (!residentEmail && !sponsorEmail) return NextResponse.json({ error: "Provide a resident and/or sponsor email" }, { status: 400 });

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (residentEmail && !emailRe.test(residentEmail)) return NextResponse.json({ error: "Invalid resident email" }, { status: 400 });
  if (sponsorEmail && !emailRe.test(sponsorEmail)) return NextResponse.json({ error: "Invalid sponsor email" }, { status: 400 });
  if (residentPassword && residentPassword.length < 6) return NextResponse.json({ error: "Resident password must be at least 6 characters" }, { status: 400 });
  if (sponsorPassword && sponsorPassword.length < 6) return NextResponse.json({ error: "Sponsor password must be at least 6 characters" }, { status: 400 });

  try {
    const out: { resident: ProvisionResult | null; sponsor: ProvisionResult | null } = { resident: null, sponsor: null };
    const fullName = `${resident.firstName} ${resident.lastName}`.trim();
    if (residentEmail) {
      out.resident = await provision({ context, email: residentEmail, name: fullName, role: "RESIDENT", residentId, reset, password: residentPassword || undefined });
      await prisma.resident.update({ where: { id: residentId }, data: { email: residentEmail } });
    }
    if (sponsorEmail) {
      out.sponsor = await provision({ context, email: sponsorEmail, name: sponsorName || `${fullName} (Family)`, role: "FAMILY", residentId, reset, password: sponsorPassword || undefined });
    }
    return NextResponse.json(out, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Account provisioning failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
