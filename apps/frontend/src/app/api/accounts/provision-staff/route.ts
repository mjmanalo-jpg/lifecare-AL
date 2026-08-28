import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { requireTenantContext, canManageOrganization } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { normalizeMobile } from "@/lib/mobileAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Provision a working LOGIN for a staff member (nurse / caregiver / care manager):
// a password-less User → org + community membership (their role) → Staff record.
// The staff set their OWN password on first login (company + mobile → first-time
// setup), matching the Org Admin add-staff flow. Mirrors the resident
// /accounts/provision flow. Without this, an Add-Staff that only writes a User row
// has no membership/Staff record and can't sign in.

// Every staff role a Super Admin / org admin can appoint (mirrors the org-admin
// staff-accounts allow-list). Mobile/clinical/facility/support roles all provision
// the same way — a real login + membership + Staff record.
const STAFF_ROLES: Role[] = ["CARE_MANAGER", "RESIDENT_COORDINATOR", "NURSE", "CAREGIVER", "PHYSICIAN", "FACILITY_ADMIN", "BILLING_ADMIN", "NUTRITIONIST", "KITCHEN", "HOUSEKEEPING", "MAINTENANCE", "SECURITY", "FLEET_MANAGEMENT", "DRIVER", "SUPERADMIN"] as Role[];
const roleLabel = (r: Role) => ({ CARE_MANAGER: "Care Manager", RESIDENT_COORDINATOR: "Resident Coordinator", NURSE: "Nurse", CAREGIVER: "Caregiver", PHYSICIAN: "Physician", FACILITY_ADMIN: "Facility Admin", BILLING_ADMIN: "Billing Admin", NUTRITIONIST: "Nutritionist", KITCHEN: "Kitchen", HOUSEKEEPING: "Housekeeping", MAINTENANCE: "Maintenance", SECURITY: "Security", FLEET_MANAGEMENT: "Fleet Manager", DRIVER: "Driver", SUPERADMIN: "Super Admin" } as Record<string, string>)[r] ?? "Staff";

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

  try {
    // Never overwrite an existing account. Adding a staff whose email (or mobile)
    // already belongs to someone must be REJECTED — an upsert here would silently
    // clobber the existing account's role/identity (e.g. demote a Super Admin).
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ error: "An account with this email already exists. Edit that staff member instead of adding a new one." }, { status: 409 });
    }
    if (phone) {
      const mobile = normalizeMobile(phone);
      if (mobile.length >= 7) {
        const orgMembers = await prisma.communityMembership.findMany({ where: { community: { organizationId } }, select: { user: { select: { phone: true } } } });
        if (orgMembers.some((m) => normalizeMobile(m.user?.phone || "") === mobile)) {
          return NextResponse.json({ error: "A staff member with this mobile number already exists." }, { status: 409 });
        }
      }
    }
    const result = await prisma.$transaction(async (tx) => {
      // create (not upsert): the email is guaranteed new by the checks above, and the
      // unique constraint is the final guard against a race — it must never overwrite.
      // Password-less: no authUserId / passwordHash, so the first login prompts the
      // staff to set their own password (mobile-login → needsFirstPassword).
      const u = await tx.user.create({
        data: { email, name: name || email.split("@")[0], phone, role, isActive: true },
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
      password: null, // password-less — staff sets it on first login
      status: "created",
    }, { status: 200 });
  } catch (error) {
    console.error("[provision-staff] failed:", error);
    const message = error instanceof Error ? error.message : "Staff provisioning failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
