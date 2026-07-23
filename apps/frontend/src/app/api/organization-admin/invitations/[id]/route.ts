import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireTenantContext();
  if (!context?.organizationId || !["OWNER", "ADMIN"].includes(context.organizationRole || "")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (requiresPrivilegedMfa(context)) return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });
  const { id } = await params;
  const body = await request.json();
  if (body.status !== "REVOKED") return NextResponse.json({ error: "Only revocation is supported" }, { status: 422 });
  const invitation = await prisma.invitation.findFirst({ where: { id, organizationId: context.organizationId, status: "PENDING" } });
  if (!invitation) return NextResponse.json({ error: "Pending invitation not found" }, { status: 404 });
  await prisma.invitation.update({ where: { id }, data: { status: "REVOKED" } });
  logAudit({ actorId: context.userId, actorRole: context.role, action: "UPDATE", entityType: "invitation", entityId: id, organizationId: context.organizationId, communityId: invitation.communityId || undefined, reason: "Revoked by organization administrator" });
  return NextResponse.json({ success: true });
}
