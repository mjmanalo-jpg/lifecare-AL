import { NextRequest, NextResponse } from "next/server";
import { getSession, updateWorkspaceSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { organizationId, communityId } = await request.json();
  if (!organizationId || !communityId) return NextResponse.json({ error: "Organization and community are required" }, { status: 400 });

  const organizationMembership = await prisma.organizationMembership.findFirst({
    where: { userId: session.userId, organizationId, status: "ACTIVE", organization: { status: "ACTIVE" } },
    include: { organization: { include: { subscription: true } } },
  });
  if (!organizationMembership) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  if (organizationMembership.organization.subscription && !["TRIALING", "ACTIVE"].includes(organizationMembership.organization.subscription.status)) {
    return NextResponse.json({ error: "Organization access is suspended" }, { status: 403 });
  }
  const community = await prisma.community.findFirst({ where: { id: communityId, organizationId, isActive: true } });
  if (!community) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  const membership = await prisma.communityMembership.findFirst({ where: { userId: session.userId, communityId, status: "ACTIVE" } });
  const organizationAdmin = ["OWNER", "ADMIN"].includes(organizationMembership.role);
  if (!membership && !organizationAdmin) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  const role = membership?.role || "FACILITY_ADMIN";
  await updateWorkspaceSession(session, {
    activeOrganizationId: organizationId,
    activeCommunityId: communityId,
    organizationRole: organizationMembership.role,
    role,
  });
  return NextResponse.json({ success: true, organizationId, communityId, role });
}