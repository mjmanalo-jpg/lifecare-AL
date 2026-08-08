import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { readPlanMeta } from "@/lib/planMeta";
import { readSubscriptionBilling, writeSubscriptionBilling, periodLabel } from "@/lib/subscriptionBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Subscription due-date reminders. A Vercel cron (Bearer CRON_SECRET) runs this
// across every organization; a signed-in platform admin can trigger it too. For
// each subscription whose due date (currentPeriodEnd, else trialEndsAt) falls
// within the reminder window — or is already overdue and unpaid — it creates a
// BILLING_UPDATE notification for the org's owners/admins. De-duplicated per due
// date via lastReminderPeriod so it never spams the same cycle.

const REMINDER_DAYS = 7;

async function run(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const isCron = Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
  if (!isCron) {
    const session = await getSession();
    if (session?.platformRole !== "PLATFORM_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_DAYS * 24 * 60 * 60 * 1000);
  const subscriptions = await prisma.subscription.findMany({
    where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
    include: { plan: true, organization: { select: { id: true, name: true } } },
  });
  const meta = await readPlanMeta();

  let remindersSent = 0;
  let orgsNotified = 0;

  for (const subscription of subscriptions) {
    const dueRaw = subscription.currentPeriodEnd || subscription.trialEndsAt;
    if (!dueRaw) continue;
    const due = new Date(dueRaw);
    // Only upcoming-within-window or already-overdue due dates.
    if (due.getTime() > windowEnd.getTime()) continue;

    const organizationId = subscription.organization.id;
    const store = await readSubscriptionBilling(organizationId);
    const dueKey = due.toISOString();
    if (store.lastReminderPeriod === dueKey) continue; // already reminded this cycle
    // Skip if this billing cycle is already paid.
    if (store.payments.some((payment) => payment.status === "PAID" && payment.periodLabel === periodLabel(due))) continue;

    const admins = await prisma.user.findMany({
      where: { isActive: true, organizationMemberships: { some: { organizationId, role: { in: ["OWNER", "ADMIN"] }, status: "ACTIVE" } } },
      select: { id: true },
    });
    if (!admins.length) continue;

    const price = subscription.plan ? meta[subscription.plan.id]?.priceMonthly ?? null : null;
    const currency = subscription.plan ? meta[subscription.plan.id]?.currency || "PHP" : "PHP";
    const overdue = due.getTime() < now.getTime();
    const amountText = price !== null ? ` of ${currency} ${price.toLocaleString()}` : "";
    const dateText = due.toLocaleDateString();
    const title = overdue ? "Subscription payment overdue" : "Subscription payment due soon";
    const message = overdue
      ? `Your ${subscription.plan?.name || "subscription"} payment${amountText} was due on ${dateText}. Pay now in Usage & Subscription to avoid interruption.`
      : `Your ${subscription.plan?.name || "subscription"} payment${amountText} is due on ${dateText}. Open Usage & Subscription to pay.`;

    await prisma.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        organizationId,
        type: "BILLING_UPDATE" as const,
        title,
        message,
        severity: overdue ? "CRITICAL" : "WARNING",
        relatedEntityType: "subscription",
        relatedEntityId: subscription.id,
      })),
    });

    store.lastReminderPeriod = dueKey;
    await writeSubscriptionBilling(organizationId, store);
    remindersSent += admins.length;
    orgsNotified += 1;
  }

  return NextResponse.json({ ok: true, orgsChecked: subscriptions.length, orgsNotified, remindersSent });
}

export async function GET(request: NextRequest) {
  return run(request);
}
export async function POST(request: NextRequest) {
  return run(request);
}
