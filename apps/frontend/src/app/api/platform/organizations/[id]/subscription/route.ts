import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";
import { readSubscriptionBilling, writeSubscriptionBilling } from "@/lib/subscriptionBilling";
import { invalidatePortalData } from "@/lib/dataCache";

// Platform-admin subscription management: create a subscription for an org that
// has none, change its plan, or flip its lifecycle status. This is the only UI
// path that can create a missing subscription — the /status route only toggles
// org status and un-suspends an already-existing subscription.
const ALLOWED = new Set(["TRIALING", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELED"]);
const TRIAL_MS = 30 * 24 * 60 * 60 * 1000;

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireTenantContext({ allowPlatform: true });
  if (context && requiresPrivilegedMfa(context)) return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });
  if (context?.platformRole !== "PLATFORM_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { planId, status } = await request.json();
  if (!ALLOWED.has(status)) return NextResponse.json({ error: "Invalid subscription status" }, { status: 422 });
  if (!planId) return NextResponse.json({ error: "A plan is required" }, { status: 422 });

  const [organization, plan] = await Promise.all([
    prisma.organization.findUnique({ where: { id }, select: { id: true } }),
    prisma.plan.findFirst({ where: { id: planId, isActive: true }, select: { id: true } }),
  ]);
  if (!organization) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const now = new Date();
  // Lifecycle timestamps kept coherent with the status the admin is setting.
  const stamps = {
    suspendedAt: status === "SUSPENDED" ? now : null,
    canceledAt: status === "CANCELED" ? now : null,
  };
  const existing = await prisma.subscription.findUnique({ where: { organizationId: id }, select: { trialEndsAt: true } });
  const trialEndsAt = status === "TRIALING" ? (existing?.trialEndsAt ?? new Date(now.getTime() + TRIAL_MS)) : existing?.trialEndsAt ?? null;

  const subscription = await prisma.subscription.upsert({
    where: { organizationId: id },
    update: { planId, status, trialEndsAt, ...stamps },
    create: { organizationId: id, planId, status, trialEndsAt, ...stamps },
    include: { plan: true },
  });

  // Clear the dunning/cancellation anchors when reactivating, or the next
  // lifecycle cron run would immediately re-suspend or re-cancel the org.
  if (status === "ACTIVE" || status === "TRIALING") {
    const store = await readSubscriptionBilling(id);
    if (store.pastDueSince || store.cancelScheduledFor) {
      store.pastDueSince = null;
      store.cancelScheduledFor = null;
      await writeSubscriptionBilling(id, store);
    }
  }

  invalidatePortalData("platform:organizations");
  invalidatePortalData("platform:insights");
  return NextResponse.json({ subscription });
}
