import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import type { Role } from "@prisma/client";
import { requireTenantContext, canManageOrganization } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { createSupabaseUser, SupabaseUserExistsError, isSupabaseAuthConfigured } from "@/lib/supabaseAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Provision a working LOGIN for a staff member (nurse / caregiver / care manager):
// Supabase auth user + first-time password → User (authUserId + bcrypt hash) →
// org + community membership (their role) → Staff record. Mirrors the resident
// /accounts/provision flow. Without this, an Add-Staff that only writes a User row
// has no credential and can't sign in.

// Readable first-time password, e.g. "Care-7K3m-4820" (no ambiguous chars).
function genPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const chunk = (n: number) => Array.from({ length: n }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `Care-${chunk(4)}-${chunk(4)}`;
}

const STAFF_ROLES: Role[] = ["NURSE", "CAREGIVER", "CARE_MANAGER"] as Role[];
const roleLabel = (r: Role) => ({ NURSE: "Nurse", CAREGIVER: "Caregiver", CARE_MANAGER: "Care Manager" } as Record<string, string>)[r] ?? "Staff";

export async function POST(request: NextRequest) {
  // allowPlatform: the "System / Full System Access" Super Admin is a PLATFORM
  // account — without this it resolves to null and every create 401s.
  const context = await requireTenantContext({ allowPlatform: true, requireCommunity: true });
  if (!context?.organizationId || !context.communityId) {
    return NextResponse.json({ error: "No active community — pick a community (top bar) before adding staff." }, { status: 400 });
  }
  if (!canManageOrganization(context) && !["SUPERADMIN", "FACILITY_ADMIN", "CARE_MANAGER"].includes(context.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").toLowerCase().trim();
  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim() || undefined;
  const role = (STAFF_ROLES.includes(body.role) ? body.role : "CAREGIVER") as Role;
  const position = String(body.position || "").trim() || roleLabel(role);
  const department = String(body.department || "").trim() || undefined;
  const experience = String(body.experience || "").trim() || undefined;
  const isActive = body.isActive !== false;
  const isApproved = body.isApproved !== false;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "A valid email is required" }, { status: 400 });

  const organizationId = context.organizationId;
  const communityId = context.communityId;
  const password = genPassword();

  try {
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
          // Auth user already exists — keep their current password (this is an
          // add, not a reset); we still wire up membership + staff record.
          passwordSet = false;
        } else {
          throw error;
        }
      }
    } else {
      passwordSet = true; // dev without Supabase — bcrypt-only login accepted
    }

    const passwordHash = passwordSet ? await bcrypt.hash(password, 10) : undefined;

    const result = await prisma.$transaction(async (tx) => {
      const u = await tx.user.upsert({
        where: { email },
        create: { email, name: name || email.split("@")[0], phone, role, isActive: true, ...(authUserId ? { authUserId } : {}), ...(passwordHash ? { passwordHash } : {}) },
        update: { name: name || undefined, phone, role, isActive: true, ...(authUserId ? { authUserId } : {}), ...(passwordHash ? { passwordHash } : {}) },
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
      const staff = await tx.staff.upsert({
        where: { userId: u.id },
        create: { userId: u.id, position, department, experience, isActive, isApproved, hireDate: new Date(), communityId, organizationId },
        update: { position, department, experience, isActive, isApproved },
        select: { id: true },
      });
      return { userId: u.id, staffId: staff.id };
    });

    return NextResponse.json({
      email,
      staffId: result.staffId,
      password: passwordSet ? password : null,
      status: passwordSet ? "created" : "existing_unchanged",
    }, { status: 200 });
  } catch (error) {
    console.error("[provision-staff] failed:", error);
    const message = error instanceof Error ? error.message : "Staff provisioning failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
