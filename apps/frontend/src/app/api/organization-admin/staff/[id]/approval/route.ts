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
  const status = String(body.status || "");
  if (!['APPROVED', 'REJECTED'].includes(status)) return NextResponse.json({ error: "Status must be APPROVED or REJECTED" }, { status: 422 });
  const staff = await prisma.staff.findFirst({ where: { id, organizationId: context.organizationId }, include: { user: true } });
  if (!staff) return NextResponse.json({ error: "Staff record not found" }, { status: 404 });
  const approved = status === "APPROVED";
  await prisma.$transaction([
    prisma.staff.update({ where: { id }, data: { isApproved: approved, isActive: approved } }),
    ...(staff.communityId ? [prisma.communityMembership.updateMany({ where: { userId: staff.userId, communityId: staff.communityId }, data: { status: approved ? "ACTIVE" : "REVOKED" } })] : []),
  ]);
  logAudit({ actorId: context.userId, actorRole: context.role, action: "UPDATE", entityType: "staff_approval", entityId: id, organizationId: context.organizationId, communityId: staff.communityId || undefined, reason: body.reason ? String(body.reason) : undefined, after: { isApproved: approved, isActive: approved } });
  return NextResponse.json({ success: true, status });
}
