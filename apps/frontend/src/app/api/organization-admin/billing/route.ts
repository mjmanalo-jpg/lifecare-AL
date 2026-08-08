import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";
import { readPlanMeta } from "@/lib/planMeta";
import { readSubscriptionBilling, writeSubscriptionBilling, periodLabel, computeNextBilling, type SubscriptionPayment } from "@/lib/subscriptionBilling";
import { createCheckout } from "@/lib/payments";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS = new Set(["CARD", "GCASH", "BANK_TRANSFER", "MAYA"]);

async function loadContext() {
  const context = await requireTenantContext();
  if (!context?.organizationId || !["OWNER", "ADMIN"].includes(context.organizationRole || "")) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  if (requiresPrivilegedMfa(context)) return { error: NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 }) };
  return { context };
}

async function billingState(organizationId: string) {
  const subscription = await prisma.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
  const meta = subscription?.plan ? (await readPlanMeta())[subscription.plan.id] : undefined;
  const store = await readSubscriptionBilling(organizationId);
  const currency = meta?.currency || "PHP";
  const amountDue = meta?.priceMonthly ?? null;
  const dueDate = subscription ? computeNextBilling(subscription) : null;
  const currentPeriod = periodLabel(dueDate || new Date());
  const paidThisPeriod = store.payments.some((payment) => payment.status === "PAID" && payment.periodLabel === currentPeriod);
  return {
    planName: subscription?.plan?.name || null,
    status: subscription?.status || "UNASSIGNED",
    amountDue,
    currency,
    dueDate,
    paidThisPeriod,
    onlinePaymentEnabled: amountDue !== null,
    payments: store.payments.slice(0, 12),
  };
}

export async function GET() {
  const { context, error } = await loadContext();
  if (error) return error;
  return NextResponse.json(await billingState(context!.organizationId!));
}

export async function POST(request: NextRequest) {
  const { context, error } = await loadContext();
  if (error) return error;
  const organizationId = context!.organizationId!;
  const body = await request.json().catch(() => ({}));
  const method = String(body.method || "").toUpperCase();
  if (!METHODS.has(method)) return NextResponse.json({ error: "Choose a valid payment method" }, { status: 400 });

  const subscription = await prisma.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
  if (!subscription?.plan) return NextResponse.json({ error: "No active subscription plan" }, { status: 400 });
  const meta = (await readPlanMeta())[subscription.plan.id];
  const amount = meta?.priceMonthly ?? null;
  const currency = meta?.currency || "PHP";
  if (amount === null || amount <= 0) return NextResponse.json({ error: "This plan has no price set. Contact the SLMS Platform Administrator." }, { status: 400 });

  const reference = `SUBS-${organizationId.slice(0, 8)}-${crypto.randomBytes(3).toString("hex")}`;
  const result = await createCheckout({ amount, currency, description: `SLMS subscription — ${subscription.plan.name}`, referenceId: reference });
  if (!result.ok) return NextResponse.json({ error: result.error || "Payment could not be started" }, { status: 502 });

  const dueDate = computeNextBilling(subscription) || new Date();
  const store = await readSubscriptionBilling(organizationId);

  // A real hosted-checkout URL means the charge completes off-site (confirmed by
  // the provider) — record it as PENDING and hand the URL back to redirect. When
  // no provider is configured the layer simulates success, so we settle it now:
  // mark PAID and roll the billing period forward a month.
  if (result.checkoutUrl) {
    const payment: SubscriptionPayment = { id: crypto.randomUUID(), amount, currency, method, reference: result.referenceId || reference, provider: result.provider, status: "PENDING", periodLabel: periodLabel(new Date(dueDate)), paidAt: new Date().toISOString() };
    store.payments.unshift(payment);
    await writeSubscriptionBilling(organizationId, store);
    return NextResponse.json({ ok: true, checkoutUrl: result.checkoutUrl, payment });
  }

  const nextPeriodEnd = new Date(dueDate);
  if (nextPeriodEnd.getTime() < Date.now()) nextPeriodEnd.setTime(Date.now());
  nextPeriodEnd.setMonth(nextPeriodEnd.getMonth() + 1);
  const payment: SubscriptionPayment = { id: crypto.randomUUID(), amount, currency, method, reference: result.referenceId || reference, provider: result.provider, status: "PAID", periodLabel: periodLabel(new Date(dueDate)), paidAt: new Date().toISOString() };
  store.payments.unshift(payment);
  store.lastReminderPeriod = null; // paid — clear so the next cycle can remind again
  await writeSubscriptionBilling(organizationId, store);
  await prisma.subscription.update({ where: { organizationId }, data: { status: "ACTIVE", currentPeriodEnd: nextPeriodEnd } });
  logAudit({ actorId: context!.userId, actorRole: context!.role, action: "CREATE", entityType: "subscription-payment", entityId: payment.id, organizationId, after: { amount, currency, method, provider: result.provider } });
  return NextResponse.json({ ok: true, simulated: result.provider === "simulated", payment, nextPeriodEnd: nextPeriodEnd.toISOString() });
}
