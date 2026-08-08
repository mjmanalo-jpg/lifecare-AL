import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext, requiresPrivilegedMfa, type TenantContext } from "@/lib/tenant";
import { readPlanMeta } from "@/lib/planMeta";
import { readSubscriptionBilling, writeSubscriptionBilling, computeNextBilling } from "@/lib/subscriptionBilling";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Org-admin self-serve subscription management: switch plan (upgrade/downgrade)
// and schedule/undo a cancel-at-period-end. Reachable even when the subscription
// has lapsed (allowInactiveSubscription) so an org can still change plan or
// resume. Plan/price/limit governance still lives with the platform admin; this
// only lets a customer move between the plans the platform published.

async function loadContext(): Promise<{ context?: TenantContext; error?: NextResponse }> {
  const context = await requireTenantContext({ allowInactiveSubscription: true });
  if (!context?.organizationId || !["OWNER", "ADMIN"].includes(context.organizationRole || "")) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  if (requiresPrivilegedMfa(context)) return { error: NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 }) };
  return { context };
}

async function usageCounts(organizationId: string) {
  const [communities, residents, staff] = await Promise.all([
    prisma.community.count({ where: { organizationId, isActive: true } }),
    prisma.resident.count({ where: { organizationId, isDeceased: false } }),
    prisma.staff.count({ where: { organizationId, isActive: true } }),
  ]);
  return { communities, residents, staff };
}

export async function GET() {
  const { context, error } = await loadContext();
  if (error) return error;
  const organizationId = context!.organizationId!;

  const [subscription, plans, meta, store, usage] = await Promise.all([
    prisma.subscription.findUnique({ where: { organizationId }, include: { plan: true } }),
    prisma.plan.findMany({ where: { isActive: true } }),
    readPlanMeta(),
    readSubscriptionBilling(organizationId),
    usageCounts(organizationId),
  ]);

  // Offer public plans plus the org's current plan (even if since hidden).
  const options = plans
    .filter((plan) => meta[plan.id]?.public !== false || plan.id === subscription?.planId)
    .map((plan) => ({
      id: plan.id,
      key: plan.key,
      name: plan.name,
      description: plan.description,
      maxCommunities: plan.maxCommunities,
      maxActiveResidents: plan.maxActiveResidents,
      maxStaffSeats: plan.maxStaffSeats,
      priceMonthly: meta[plan.id]?.priceMonthly ?? null,
      currency: meta[plan.id]?.currency || "PHP",
      isCurrent: plan.id === subscription?.planId,
    }))
    .sort((a, b) => (meta[a.id]?.order ?? 100) - (meta[b.id]?.order ?? 100));

  return NextResponse.json({
    currentPlanId: subscription?.planId ?? null,
    status: subscription?.status ?? "UNASSIGNED",
    cancelScheduledFor: store.cancelScheduledFor,
    usage,
    plans: options,
  });
}

export async function PATCH(request: NextRequest) {
  const { context, error } = await loadContext();
  if (error) return error;
  const organizationId = context!.organizationId!;
  const body = await request.json().catch(() => ({}));
  const planId = String(body.planId || "");
  if (!planId) return NextResponse.json({ error: "Choose a plan" }, { status: 400 });

  const [subscription, plan, meta] = await Promise.all([
    prisma.subscription.findUnique({ where: { organizationId } }),
    prisma.plan.findUnique({ where: { id: planId } }),
    readPlanMeta(),
  ]);
  if (!subscription) return NextResponse.json({ error: "No subscription to change" }, { status: 400 });
  if (!plan || !plan.isActive) return NextResponse.json({ error: "That plan is not available" }, { status: 400 });
  if (meta[plan.id]?.public === false && plan.id !== subscription.planId) return NextResponse.json({ error: "That plan is not available" }, { status: 400 });
  if (plan.id === subscription.planId) return NextResponse.json({ error: "You are already on this plan" }, { status: 400 });

  // Downgrade guard: never strand an org above the plan it is moving to.
  const usage = await usageCounts(organizationId);
  const over: string[] = [];
  if (plan.maxCommunities !== null && usage.communities > plan.maxCommunities) over.push(`communities (${usage.communities} active, plan allows ${plan.maxCommunities})`);
  if (plan.maxActiveResidents !== null && usage.residents > plan.maxActiveResidents) over.push(`residents (${usage.residents} active, plan allows ${plan.maxActiveResidents})`);
  if (plan.maxStaffSeats !== null && usage.staff > plan.maxStaffSeats) over.push(`staff seats (${usage.staff} active, plan allows ${plan.maxStaffSeats})`);
  if (over.length) return NextResponse.json({ error: `Reduce your ${over.join("; ")} before switching to ${plan.name}.`, code: "DOWNGRADE_BLOCKED" }, { status: 409 });

  await prisma.subscription.update({ where: { organizationId }, data: { planId: plan.id } });
  logAudit({ actorId: context!.userId, actorRole: context!.role, action: "UPDATE", entityType: "subscription", entityId: subscription.id, organizationId, reason: "Plan change", before: { planId: subscription.planId }, after: { planId: plan.id } });
  return NextResponse.json({ ok: true, planId: plan.id, message: `Switched to ${plan.name}. The new price applies from your next billing date.` });
}

export async function POST(request: NextRequest) {
  const { context, error } = await loadContext();
  if (error) return error;
  const organizationId = context!.organizationId!;
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");

  const subscription = await prisma.subscription.findUnique({ where: { organizationId } });
  if (!subscription) return NextResponse.json({ error: "No subscription found" }, { status: 400 });
  const store = await readSubscriptionBilling(organizationId);

  if (action === "cancel") {
    // Cancel at period end: keep access until the current paid-through / trial
    // date; the lifecycle cron flips the status to CANCELED when it arrives. If
    // the period already lapsed, computeNextBilling can return a past date —
    // clamp to now so we never schedule (and announce) a cancellation in the past.
    const raw = computeNextBilling(subscription);
    const effective = raw && raw.getTime() > Date.now() ? raw : new Date();
    store.cancelScheduledFor = effective.toISOString();
    await writeSubscriptionBilling(organizationId, store);
    logAudit({ actorId: context!.userId, actorRole: context!.role, action: "UPDATE", entityType: "subscription", entityId: subscription.id, organizationId, reason: "Cancellation scheduled", after: { cancelScheduledFor: store.cancelScheduledFor } });
    return NextResponse.json({ ok: true, cancelScheduledFor: store.cancelScheduledFor, message: `Your subscription will cancel on ${effective.toLocaleDateString()}. You keep access until then.` });
  }

  if (action === "resume") {
    store.cancelScheduledFor = null;
    await writeSubscriptionBilling(organizationId, store);
    logAudit({ actorId: context!.userId, actorRole: context!.role, action: "UPDATE", entityType: "subscription", entityId: subscription.id, organizationId, reason: "Cancellation reversed", after: { cancelScheduledFor: null } });
    return NextResponse.json({ ok: true, cancelScheduledFor: null, message: "Cancellation reversed. Your subscription stays active." });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
