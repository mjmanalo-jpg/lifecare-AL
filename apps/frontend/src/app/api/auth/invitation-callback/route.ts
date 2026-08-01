import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@/constants/roleConfig";
import type { Role as PrismaRole } from "@prisma/client";
import { createSession, setSupabaseTokens } from "@/lib/auth";
import { getSupabaseIdentity } from "@/lib/supabaseAuth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

function assuranceLevel(accessToken: string): "aal1" | "aal2" {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"));
    return payload.aal === "aal2" ? "aal2" : "aal1";
  } catch { return "aal1"; }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const accessToken = String(body.accessToken || "");
  const refreshToken = String(body.refreshToken || "");
  if (!accessToken || !refreshToken) return NextResponse.json({ error: "Invalid invitation callback" }, { status: 400 });

  try {
    const identity = await getSupabaseIdentity(accessToken);
    const invitations = await prisma.invitation.findMany({
      where: { email: identity.email, status: "PENDING", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      take: 2,
      include: { organization: { include: { communities: { where: { isActive: true }, orderBy: { createdAt: "asc" }, take: 1 } } }, community: true },
    });
    if (!invitations.length) return NextResponse.json({ error: "No pending SLMS invitation matches this email" }, { status: 404 });
    if (invitations.length > 1) return NextResponse.json({ error: "Multiple invitations are pending. Open the tenant-specific invitation link." }, { status: 409 });
    const invitation = invitations[0];
    if (invitation.organization.status !== "ACTIVE") return NextResponse.json({ error: "Organization is not active" }, { status: 403 });

    const organizationAdmin = ["OWNER", "ADMIN"].includes(invitation.organizationRole || "");
    const community = invitation.community || invitation.organization.communities[0] || null;
    const databaseRole = (invitation.communityRole || (organizationAdmin ? "FACILITY_ADMIN" : "FAMILY")) as PrismaRole;
    const role = (organizationAdmin ? "ORGANIZATION_ADMIN" : databaseRole) as Role;
    const user = await prisma.user.upsert({
      where: { email: identity.email },
      create: { email: identity.email, authUserId: identity.id, name: identity.email.split("@")[0], role: databaseRole },
      update: { authUserId: identity.id, isActive: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${user.id}, true)`;
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${invitation.organizationId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.community_id', ${community?.id || ""}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_platform', 'false', true)`;
      await tx.organizationMembership.upsert({
        where: { userId_organizationId: { userId: user.id, organizationId: invitation.organizationId } },
        create: { userId: user.id, organizationId: invitation.organizationId, role: invitation.organizationRole || "VIEWER", status: "ACTIVE" },
        update: { role: invitation.organizationRole || "VIEWER", status: "ACTIVE" },
      });
      if (invitation.communityId && invitation.communityRole) {
        await tx.communityMembership.upsert({
          where: { userId_communityId: { userId: user.id, communityId: invitation.communityId } },
          create: { userId: user.id, communityId: invitation.communityId, role: invitation.communityRole, status: "ACTIVE" },
          update: { role: invitation.communityRole, status: "ACTIVE" },
        });
      }
      if (invitation.residentId && invitation.communityRole === "RESIDENT") {
        await tx.residentAccess.upsert({
          where: { userId_residentId: { userId: user.id, residentId: invitation.residentId } },
          create: { userId: user.id, residentId: invitation.residentId, accessRole: "RESIDENT", isActive: true },
          update: { accessRole: "RESIDENT", isActive: true },
        });
        await tx.resident.update({ where: { id: invitation.residentId }, data: { userId: user.id } });
      }
      await tx.invitation.update({ where: { id: invitation.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
    });

    await createSession(role, user.id, {
      authUserId: identity.id,
      authAssuranceLevel: assuranceLevel(accessToken),
      organizationRole: invitation.organizationRole || "VIEWER",
      activeOrganizationId: invitation.organizationId,
      activeCommunityId: community?.id,
    });
    await setSupabaseTokens(accessToken, refreshToken, 3600);
    logAudit({ actorId: user.id, actorRole: role, action: "UPDATE", entityType: "invitation", entityId: invitation.id, organizationId: invitation.organizationId, communityId: community?.id });
    const portalUrl = `/${role.toLowerCase()}/dashboard`;
    return NextResponse.json({
      success: true,
      redirectUrl: `/account/setup-password?next=${encodeURIComponent(portalUrl)}`,
    });
  } catch (error) {
    console.error("Invitation callback failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Unable to complete the invitation" }, { status: 401 });
  }
}
