import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashInvitationToken } from "@/lib/invitations";

const STAFF_COMMUNITY_ROLES = new Set(["FACILITY_ADMIN", "CARE_MANAGER", "RESIDENT_COORDINATOR", "BILLING_ADMIN", "PHYSICIAN", "NURSE", "CAREGIVER", "FLEET_MANAGEMENT", "DRIVER"]);
const POSITION_BY_ROLE: Record<string, string> = {
  FACILITY_ADMIN: "Facility Admin",
  CARE_MANAGER: "Care Manager",
  RESIDENT_COORDINATOR: "Resident Coordinator",
  BILLING_ADMIN: "Billing Admin",
  PHYSICIAN: "Physician",
  NURSE: "Registered Nurse",
  CAREGIVER: "Caregiver",
  FLEET_MANAGEMENT: "Fleet Manager",
  DRIVER: "Driver",
};

export async function POST(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const session = await getSession();
  if (!session?.userId) return NextResponse.json({ error: "Sign in before accepting this invitation" }, { status: 401 });
  const { token } = await params;
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashInvitationToken(token) }, include: { organization: true, community: true } });
  if (!invitation || invitation.status !== "PENDING") return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  if (invitation.expiresAt <= new Date()) {
    await prisma.invitation.update({ where: { id: invitation.id }, data: { status: "EXPIRED" } });
    return NextResponse.json({ error: "Invitation expired" }, { status: 410 });
  }
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { email: true } });
  if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) return NextResponse.json({ error: "Invitation was issued to a different email" }, { status: 403 });
  if (invitation.organization.status !== "ACTIVE") return NextResponse.json({ error: "Organization is not active" }, { status: 403 });

  const existingStaff = invitation.communityId && invitation.communityRole && STAFF_COMMUNITY_ROLES.has(invitation.communityRole)
    ? await prisma.staff.findUnique({ where: { userId: session.userId! } })
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${session.userId!}, true)`;
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${invitation.organizationId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.community_id', ${invitation.communityId || ""}, true)`;
    await tx.$executeRaw`SELECT set_config('app.is_platform', 'false', true)`;
    if (invitation.organizationRole) {
      await tx.organizationMembership.upsert({
        where: { userId_organizationId: { userId: session.userId!, organizationId: invitation.organizationId } },
        create: { userId: session.userId!, organizationId: invitation.organizationId, role: invitation.organizationRole, status: "ACTIVE" },
        update: { role: invitation.organizationRole, status: "ACTIVE" },
      });
    } else {
      await tx.organizationMembership.upsert({
        where: { userId_organizationId: { userId: session.userId!, organizationId: invitation.organizationId } },
        create: { userId: session.userId!, organizationId: invitation.organizationId, role: "VIEWER", status: "ACTIVE" },
        update: { status: "ACTIVE" },
      });
    }
    if (invitation.communityId && invitation.communityRole) {
      await tx.communityMembership.upsert({
        where: { userId_communityId: { userId: session.userId!, communityId: invitation.communityId } },
        create: { userId: session.userId!, communityId: invitation.communityId, role: invitation.communityRole, status: "ACTIVE" },
        update: { role: invitation.communityRole, status: "ACTIVE" },
      });
    }
    if (invitation.communityId && invitation.communityRole && STAFF_COMMUNITY_ROLES.has(invitation.communityRole) && (!existingStaff || existingStaff.organizationId === invitation.organizationId)) {
      const communityConnector = invitation.communityId ? { community: { connect: { id: invitation.communityId } } } : {};
      const staffCreate = {
        position: POSITION_BY_ROLE[invitation.communityRole] || invitation.communityRole,
        hireDate: new Date(),
        isActive: true,
        isApproved: true,
        user: { connect: { id: session.userId! } },
        organization: { connect: { id: invitation.organizationId } },
        ...communityConnector,
      };
      const staffUpdate = {
        isActive: true,
        isApproved: true,
        organization: { connect: { id: invitation.organizationId } },
        ...communityConnector,
      };
      await tx.staff.upsert({
        where: { userId: session.userId! },
        create: staffCreate,
        update: staffUpdate,
      });
    }
    if (invitation.residentId && invitation.communityRole === "RESIDENT") {
      await tx.residentAccess.upsert({
        where: { userId_residentId: { userId: session.userId!, residentId: invitation.residentId } },
        create: { userId: session.userId!, residentId: invitation.residentId, accessRole: "RESIDENT", isActive: true },
        update: { accessRole: "RESIDENT", isActive: true },
      });
      await tx.resident.update({ where: { id: invitation.residentId }, data: { userId: session.userId! } });
    }
    await tx.invitation.update({ where: { id: invitation.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
  });
  return NextResponse.json({ success: true, organizationId: invitation.organizationId, communityId: invitation.communityId });
}
