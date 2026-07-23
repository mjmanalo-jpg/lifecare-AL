import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await requireTenantContext({ allowPlatform: true });
  if (context && requiresPrivilegedMfa(context)) {
    return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });
  }
  if (!context?.platformRole) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [invitations, auditEvents, platformUsers, deniedLast24Hours, usageSnapshots] = await Promise.all([
    prisma.invitation.findMany({
      take: 100,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        status: true,
        organizationRole: true,
        communityRole: true,
        expiresAt: true,
        createdAt: true,
        organization: { select: { id: true, name: true } },
        community: { select: { id: true, name: true } },
      },
    }),
    prisma.auditLog.findMany({
      take: 100,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        actorName: true,
        actorRole: true,
        action: true,
        entityType: true,
        entityId: true,
        organizationId: true,
        ipAddress: true,
        reason: true,
        createdAt: true,
      },
    }),
    prisma.user.findMany({
      where: { platformRole: { not: null } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, platformRole: true, isActive: true, lastLogin: true },
    }),
    prisma.auditLog.count({ where: { action: "DENY", createdAt: { gte: since } } }),
    prisma.usageSnapshot.findMany({
      take: 100,
      orderBy: { periodEnd: "desc" },
      select: { id: true, organizationId: true, communityId: true, metric: true, value: true, periodEnd: true },
    }),
  ]);

  return NextResponse.json({
    invitations,
    auditEvents,
    platformUsers,
    deniedLast24Hours,
    usageSnapshots: usageSnapshots.map((snapshot) => ({ ...snapshot, value: snapshot.value.toString() })),
    health: {
      database: "OPERATIONAL",
      authentication: process.env.NEXT_PUBLIC_SUPABASE_URL ? "CONFIGURED" : "NOT_CONFIGURED",
      realtime: process.env.NEXT_PUBLIC_SUPABASE_URL ? "CONFIGURED" : "NOT_CONFIGURED",
      emailInvitations: process.env.SUPABASE_SERVICE_ROLE_KEY ? "CONFIGURED" : "NOT_CONFIGURED",
      storage: process.env.NEXT_PUBLIC_SUPABASE_URL ? "CONFIGURED" : "NOT_CONFIGURED",
    },
    generatedAt: new Date().toISOString(),
  });
}
