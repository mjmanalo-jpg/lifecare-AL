import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashInvitationToken } from "@/lib/invitations";

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