import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageOrganization, requireTenantContext, invalidateWorkspaces } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { invalidatePortalDataPrefix } from "@/lib/dataCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Assign an EXISTING staff member to an ADDITIONAL community so they can switch
// between communities on their one login (same company + mobile sign-in). The
// role is REUSED from the person's account — same functions in every community,
// only the community's data changes. Adds a communityMembership + a Staff row for
// the target community; the org membership (VIEWER) already exists from creation.
export async function POST(request: NextRequest) {
  const context = await requireTenantContext();
  // Org owners/admins manage staff org-wide; the app-level SUPERADMIN (a community
  // role, not an org-admin one) may also assign across their org's communities.
  if (!context || !context.organizationId || !(canManageOrganization(context) || context.role === "SUPERADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const staffId = String(body.staffId || "");
  const communityId = String(body.communityId || "");
  if (!staffId || !communityId) {
    return NextResponse.json({ error: "Staff and target community are required" }, { status: 400 });
  }

  // Source staff must belong to this org — gives us the person + their role/position.
  const staff = await prisma.staff.findFirst({
    where: { id: staffId, organizationId: context.organizationId },
    include: { user: true },
  });
  if (!staff) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });

  const community = await prisma.community.findFirst({ where: { id: communityId, organizationId: context.organizationId, isActive: true } });
  if (!community) return NextResponse.json({ error: "Community not found" }, { status: 404 });

  const role = staff.user.role; // same role in every community — only the data differs

  // Idempotent: already assigned → nothing to do.
  const existingMembership = await prisma.communityMembership.findUnique({
    where: { userId_communityId: { userId: staff.userId, communityId } },
    select: { id: true, status: true },
  });
  const existingStaff = await prisma.staff.findFirst({ where: { userId: staff.userId, communityId }, select: { id: true } });
  if (existingMembership && existingStaff) {
    return NextResponse.json({ success: true, alreadyAssigned: true });
  }

  // Enforce the plan's staff-seat entitlement (a second community = a second Staff row).
  const subscription = await prisma.subscription.findUnique({ where: { organizationId: context.organizationId }, include: { plan: true } });
  const activeStaff = await prisma.staff.count({ where: { organizationId: context.organizationId, isActive: true } });
  if (subscription?.plan.maxStaffSeats && activeStaff >= subscription.plan.maxStaffSeats) {
    return NextResponse.json({ error: `Staff seat limit reached (${subscription.plan.maxStaffSeats})`, code: "STAFF_LIMIT" }, { status: 403 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.communityMembership.upsert({
        where: { userId_communityId: { userId: staff.userId, communityId } },
        update: { role: role as never, status: "ACTIVE" },
        create: { userId: staff.userId, communityId, role: role as never, status: "ACTIVE" },
      });
      if (!existingStaff) {
        await tx.staff.create({
          data: { userId: staff.userId, organizationId: context.organizationId!, communityId, position: staff.position, department: staff.department, hireDate: new Date(), isActive: true, isApproved: true },
        });
      }
    });
  } catch (error) {
    console.error("Assign-community failed", error);
    return NextResponse.json({ error: "Could not assign the staff member to that community", detail: error instanceof Error ? error.message : "unknown" }, { status: 400 });
  }

  logAudit({ actorId: context.userId, actorRole: context.role, action: "CREATE", entityType: "staff-community-assignment", entityId: staff.userId, organizationId: context.organizationId, communityId, after: { role, community: community.name } });
  invalidatePortalDataPrefix(`org-admin:${context.organizationId}:`);
  invalidateWorkspaces(staff.userId);
  return NextResponse.json({ success: true });
}
