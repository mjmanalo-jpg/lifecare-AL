import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";
import { readPlanMeta } from "@/lib/planMeta";
import { cachedPortalData } from "@/lib/dataCache";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await requireTenantContext({ allowPlatform: true });
  if (context && requiresPrivilegedMfa(context)) {
    return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });
  }
  if (!context?.platformRole) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const payload = await cachedPortalData("platform:insights", async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const last30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [invitations, auditEvents, platformUsers, deniedLast24Hours, usageSnapshots, subscriptions, planMeta] = await Promise.all([
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
      prisma.subscription.findMany({ include: { plan: { select: { id: true, name: true, key: true } } } }),
      readPlanMeta(),
    ]);

    // ── SaaS revenue & lifecycle metrics (computed from live subscriptions) ──
    const counts: Record<string, number> = { TRIALING: 0, ACTIVE: 0, PAST_DUE: 0, SUSPENDED: 0, CANCELED: 0 };
    const byPlan = new Map<string, { planId: string; name: string; active: number; revenue: number }>();
    // Track revenue per currency so mixed-currency plans are never summed into one
    // meaningless number; the headline MRR reports the dominant currency only.
    const revenueByCurrency: Record<string, number> = {};
    const payingByCurrency: Record<string, number> = {};
    let newTrialsLast30 = 0;
    let churnedLast30 = 0;
    for (const subscription of subscriptions) {
      counts[subscription.status] = (counts[subscription.status] || 0) + 1;
      if (subscription.trialEndsAt && subscription.createdAt >= last30) newTrialsLast30 += 1;
      if (subscription.canceledAt && subscription.canceledAt >= last30) churnedLast30 += 1;
      const meta = subscription.plan ? planMeta[subscription.plan.id] : undefined;
      const price = meta?.priceMonthly ?? 0;
      const cur = meta?.currency || "PHP";
      if (subscription.plan) {
        const entry = byPlan.get(subscription.plan.id) || { planId: subscription.plan.id, name: subscription.plan.name, active: 0, revenue: 0 };
        // MRR counts only revenue-generating statuses (active + in-grace past-due).
        if (subscription.status === "ACTIVE" || subscription.status === "PAST_DUE") {
          revenueByCurrency[cur] = (revenueByCurrency[cur] || 0) + price;
          payingByCurrency[cur] = (payingByCurrency[cur] || 0) + 1;
          entry.active += 1;
          entry.revenue += price;
        }
        byPlan.set(subscription.plan.id, entry);
      }
    }
    const currency = Object.keys(revenueByCurrency).sort((a, b) => revenueByCurrency[b] - revenueByCurrency[a])[0] || "PHP";
    const mrr = revenueByCurrency[currency] || 0;
    const payingCount = counts.ACTIVE + counts.PAST_DUE;
    const saas = {
      currency,
      mrr,
      arr: mrr * 12,
      arpa: payingByCurrency[currency] ? Math.round(mrr / payingByCurrency[currency]) : 0,
      totalSubscriptions: subscriptions.length,
      counts,
      payingCount,
      newTrialsLast30,
      churnedLast30,
      // Rough trial→paid gauge: paying orgs as a share of paying + still-trialing.
      trialConversionPct: payingCount + counts.TRIALING > 0 ? Math.round((payingCount / (payingCount + counts.TRIALING)) * 100) : 0,
      byPlan: [...byPlan.values()].sort((a, b) => b.revenue - a.revenue),
    };

    return {
      invitations,
      auditEvents,
      platformUsers,
      deniedLast24Hours,
      usageSnapshots: usageSnapshots.map((snapshot) => ({ ...snapshot, value: snapshot.value.toString() })),
      saas,
      health: {
        database: "OPERATIONAL",
        authentication: process.env.NEXT_PUBLIC_SUPABASE_URL ? "CONFIGURED" : "NOT_CONFIGURED",
        realtime: process.env.NEXT_PUBLIC_SUPABASE_URL ? "CONFIGURED" : "NOT_CONFIGURED",
        emailInvitations: process.env.SUPABASE_SERVICE_ROLE_KEY ? "CONFIGURED" : "NOT_CONFIGURED",
        storage: process.env.NEXT_PUBLIC_SUPABASE_URL ? "CONFIGURED" : "NOT_CONFIGURED",
      },
      generatedAt: new Date().toISOString(),
    };
  });

  return NextResponse.json(payload);
}
