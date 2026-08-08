import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { readSubscriptionBilling, writeSubscriptionBilling, periodLabel, computeNextBilling } from "@/lib/subscriptionBilling";
import { decideLifecycle, type SubStatus } from "@/lib/subscriptionStatus";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Daily subscription maintenance (Vercel cron, Bearer CRON_SECRET; a signed-in
// platform admin may also trigger it). Two jobs per organization:
//   1. Advance the subscription state machine — expire trials, mark overdue
//      periods PAST_DUE, and suspend after the grace window. See
//      decideLifecycle() for the pure rules; payment-driven ACTIVE transitions
//      happen in the billing route, this is the automated/idle path.
//   2. Record a daily UsageSnapshot per org (communities / residents / staff)
//      so the platform has usage history rather than only on-demand counts.

async function usageSnapshot(organizationId: string, now: Date) {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000);
  const [communities, residents, staff] = await Promise.all([
    prisma.community.count({ where: { organizationId, isActive: true } }),
    prisma.resident.count({ where: { organizationId, isDeceased: false } }),
    prisma.staff.count({ where: { organizationId, isActive: true } }),
  ]);
  const rows: { metric: "ACTIVE_COMMUNITIES" | "ACTIVE_RESIDENTS" | "ACTIVE_STAFF"; value: number }[] = [
    { metric: "ACTIVE_COMMUNITIES", value: communities },
    { metric: "ACTIVE_RESIDENTS", value: residents },
    { metric: "ACTIVE_STAFF", value: staff },
  ];
  const dayTag = periodStart.toISOString().slice(0, 10);
  for (const row of rows) {
    // communityId is null here, so the compound unique index (which includes it)
    // can't dedupe reliably in Postgres. Key the row by a deterministic primary
    // id instead, so same-day re-runs (and cron retries) upsert one row rather
    // than accumulating duplicates that would double-count in insights.
    const id = `usage:${organizationId}:${row.metric}:${dayTag}`;
    await prisma.usageSnapshot.upsert({
      where: { id },
      update: { value: BigInt(row.value), periodEnd },
      create: { id, organizationId, communityId: null, metric: row.metric, value: BigInt(row.value), periodStart, periodEnd },
    });
  }
}

async function run(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const isCron = Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
  if (!isCron) {
    const session = await getSession();
    if (session?.platformRole !== "PLATFORM_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const subscriptions = await prisma.subscription.findMany({
    include: { organization: { select: { id: true } } },
  });

  const transitions: { organizationId: string; from: string; to: string; reason: string }[] = [];
  let snapshotsWritten = 0;

  for (const subscription of subscriptions) {
    const organizationId = subscription.organization.id;

    // 1. Usage snapshot (best-effort; never blocks a state transition).
    await usageSnapshot(organizationId, now).then(() => { snapshotsWritten += 3; }).catch(() => {});

    // 2. Lifecycle transition.
    const store = await readSubscriptionBilling(organizationId);
    const due = computeNextBilling(subscription, now);
    const paidCurrentPeriod = due ? store.payments.some((payment) => payment.status === "PAID" && payment.periodLabel === periodLabel(due)) : false;

    const decision = decideLifecycle(
      {
        status: subscription.status,
        trialEndsAt: subscription.trialEndsAt,
        currentPeriodEnd: subscription.currentPeriodEnd,
        pastDueSince: store.pastDueSince,
        cancelScheduledFor: store.cancelScheduledFor,
        paidCurrentPeriod,
      },
      now,
    );
    if (!decision) continue;

    const nextStatus = decision.status as SubStatus | undefined;
    if (nextStatus) {
      await prisma.subscription.update({
        where: { organizationId },
        data: {
          status: nextStatus,
          ...(nextStatus === "SUSPENDED" ? { suspendedAt: now } : {}),
          ...(nextStatus === "CANCELED" ? { canceledAt: now } : {}),
        },
      });
      transitions.push({ organizationId, from: subscription.status, to: nextStatus, reason: decision.reason });
      logAudit({ actorRole: "SYSTEM", action: "UPDATE", entityType: "subscription", entityId: subscription.id, organizationId, reason: decision.reason, before: { status: subscription.status }, after: { status: nextStatus } });
    }

    // Persist any store-field changes the decision returned.
    if ("pastDueSince" in decision) store.pastDueSince = decision.pastDueSince ?? null;
    if ("cancelScheduledFor" in decision) store.cancelScheduledFor = decision.cancelScheduledFor ?? null;
    await writeSubscriptionBilling(organizationId, store);
  }

  return NextResponse.json({ ok: true, subscriptionsChecked: subscriptions.length, transitions, snapshotsWritten });
}

export async function GET(request: NextRequest) {
  return run(request);
}
export async function POST(request: NextRequest) {
  return run(request);
}
