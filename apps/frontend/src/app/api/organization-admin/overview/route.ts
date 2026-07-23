import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await requireTenantContext();
  if (!context?.organizationId || !["OWNER", "ADMIN"].includes(context.organizationRole || "")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (requiresPrivilegedMfa(context)) return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });
  const organizationId = context.organizationId;
  const [organization, auditEvents] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        subscription: { include: { plan: { include: { entitlements: true } } } },
        communities: { orderBy: { name: "asc" }, include: { _count: { select: { residents: true, staff: true } } } },
        memberships: { orderBy: { createdAt: "asc" }, include: { user: { select: { id: true, name: true, email: true, isActive: true, lastLogin: true, communityMemberships: { where: { community: { organizationId } }, include: { community: { select: { id: true, name: true } } } } } } } },
        invitations: { take: 100, orderBy: { createdAt: "desc" }, include: { community: { select: { id: true, name: true } } } },
        staff: { orderBy: { createdAt: "desc" }, include: { user: { select: { id: true, name: true, email: true, phone: true, role: true, isActive: true } }, community: { select: { id: true, name: true } } } },
      },
    }),
    prisma.auditLog.findMany({ where: { organizationId }, take: 100, orderBy: { createdAt: "desc" }, select: { id: true, actorName: true, actorRole: true, action: true, entityType: true, entityId: true, reason: true, createdAt: true } }),
  ]);
  if (!organization) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  const plan = organization.subscription?.plan;
  return NextResponse.json({
    organization: {
      ...organization,
      subscription: organization.subscription ? { ...organization.subscription, plan: plan ? { ...plan, maxStorageBytes: plan.maxStorageBytes?.toString() || null } : null } : null,
    },
    auditEvents,
  });
}
