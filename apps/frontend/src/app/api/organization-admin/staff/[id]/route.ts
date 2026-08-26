import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { invalidatePortalDataPrefix } from "@/lib/dataCache";
import { normalizeMobile } from "@/lib/mobileAuth";

// Same leadership roles an org admin may appoint (mirrors staff-accounts POST).
const ALLOWED_ROLES = new Set(["FACILITY_ADMIN", "CARE_MANAGER", "RESIDENT_COORDINATOR", "SUPERADMIN", "NURSE", "CAREGIVER", "PHYSICIAN", "BILLING_ADMIN", "NUTRITIONIST", "KITCHEN", "HOUSEKEEPING", "MAINTENANCE", "SECURITY", "FLEET_MANAGEMENT", "DRIVER"]);

async function guard(context: Awaited<ReturnType<typeof requireTenantContext>>) {
  if (!context?.organizationId || !["OWNER", "ADMIN"].includes(context.organizationRole || "")) return "Forbidden";
  if (requiresPrivilegedMfa(context)) return "MFA required";
  return null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireTenantContext();
  const denied = await guard(context);
  if (denied) return NextResponse.json({ error: denied, ...(denied === "MFA required" ? { code: "MFA_REQUIRED" } : {}) }, { status: 403 });
  const organizationId = context!.organizationId!;
  const { id } = await params;

  const staff = await prisma.staff.findFirst({ where: { id, organizationId }, include: { user: true } });
  if (!staff) return NextResponse.json({ error: "Staff record not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const name = body.name !== undefined ? String(body.name).trim() : staff.user.name;
  const position = body.position !== undefined ? String(body.position).trim() : staff.position;
  const department = body.department !== undefined ? (String(body.department).trim() || null) : staff.department;
  const role = body.role !== undefined ? String(body.role) : staff.user.role;
  const isActive = body.isActive !== undefined ? Boolean(body.isActive) : staff.isActive;
  const communityId = body.communityId !== undefined ? String(body.communityId) : staff.communityId;
  const phoneRaw = body.phone !== undefined ? String(body.phone).trim() : staff.user.phone || "";
  const mobile = normalizeMobile(phoneRaw);
  const emailInput = body.email !== undefined ? String(body.email).toLowerCase().trim() : "";

  if (!name || !position || !communityId) return NextResponse.json({ error: "Full name, position, and community are required" }, { status: 400 });
  if (mobile.length < 7) return NextResponse.json({ error: "Enter a valid mobile number" }, { status: 400 });
  if (!ALLOWED_ROLES.has(role)) return NextResponse.json({ error: "Choose a valid staff role" }, { status: 422 });
  if (emailInput && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailInput)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  // Only change the stored email when a real one is given. A blank field keeps
  // the existing address (which may be the internal synthetic placeholder).
  if (emailInput && emailInput !== staff.user.email) {
    const dup = await prisma.user.findUnique({ where: { email: emailInput }, select: { id: true } });
    if (dup && dup.id !== staff.userId) return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  const community = await prisma.community.findFirst({ where: { id: communityId, organizationId, isActive: true }, select: { id: true } });
  if (!community) return NextResponse.json({ error: "Community not found" }, { status: 404 });

  // Mobile stays the unique org-wide sign-in key; check only when it changed.
  if (mobile !== normalizeMobile(staff.user.phone || "")) {
    const orgMembers = await prisma.communityMembership.findMany({ where: { community: { organizationId }, userId: { not: staff.userId } }, select: { user: { select: { phone: true } } } });
    if (orgMembers.some((m) => normalizeMobile(m.user?.phone || "") === mobile)) return NextResponse.json({ error: "A staff member with this mobile number already exists" }, { status: 409 });
  }

  const membershipStatus = isActive ? "ACTIVE" : "REVOKED";
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: staff.userId }, data: { name, phone: phoneRaw, role: role as never, isActive, ...(emailInput ? { email: emailInput } : {}) } });
    await tx.staff.update({ where: { id }, data: { position, department, communityId, isActive } });
    // Move/refresh the community membership that carries the real leadership role.
    if (staff.communityId && staff.communityId !== communityId) {
      await tx.communityMembership.updateMany({ where: { userId: staff.userId, communityId: staff.communityId }, data: { status: "REVOKED" } });
    }
    const existing = await tx.communityMembership.findFirst({ where: { userId: staff.userId, communityId }, select: { id: true } });
    if (existing) await tx.communityMembership.update({ where: { id: existing.id }, data: { role: role as never, status: membershipStatus } });
    else await tx.communityMembership.create({ data: { userId: staff.userId, communityId, role: role as never, status: membershipStatus } });
  });

  logAudit({ actorId: context!.userId, actorRole: context!.role, action: "UPDATE", entityType: "staff-account", entityId: staff.userId, organizationId, communityId, after: { name, role, position, isActive } });
  invalidatePortalDataPrefix(`org-admin:${organizationId}:`);
  return NextResponse.json({ success: true });
}
