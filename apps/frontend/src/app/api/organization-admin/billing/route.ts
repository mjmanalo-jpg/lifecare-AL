import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";
import { readPlanMeta } from "@/lib/planMeta";
import { readSubscriptionBilling, writeSubscriptionBilling, periodLabel, computeNextBilling, buildInvoiceNumber, type SubscriptionPayment, type BillingProfile } from "@/lib/subscriptionBilling";
import { createCheckout } from "@/lib/payments";
import { readPaymentDetails } from "@/lib/paymentDetails";
import { logAudit } from "@/lib/audit";
import { notifyPlatformAdmins } from "@/lib/platformNotify";
import { cachedPortalData, invalidatePortalDataPrefix } from "@/lib/dataCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS = new Set(["CARD", "GCASH", "BANK_TRANSFER", "MAYA"]);

async function loadContext() {
  // allowInactiveSubscription: a lapsed (SUSPENDED/CANCELED) org must still be
  // able to open billing and pay to reactivate.
  const context = await requireTenantContext({ allowInactiveSubscription: true });
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
    profile: store.profile,
    cancelScheduledFor: store.cancelScheduledFor,
    invoices: store.invoices,
    paymentDetails: await readPaymentDetails(),
  };
}

function sanitizeProfile(input: unknown): BillingProfile {
  const data = (input || {}) as Record<string, unknown>;
  const method = String(data.preferredMethod || "CARD").toUpperCase();
  const str = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
  return {
    preferredMethod: METHODS.has(method) ? method : "CARD",
    billingEmail: str(data.billingEmail, 160),
    billingName: str(data.billingName, 160),
  };
}

export async function GET() {
  const { context, error } = await loadContext();
  if (error) return error;
  return NextResponse.json(await cachedPortalData(`org-admin:${context!.organizationId!}:billing`, () => billingState(context!.organizationId!)));
}

// Save the org's billing contact / preferred payment method.
export async function PUT(request: NextRequest) {
  const { context, error } = await loadContext();
  if (error) return error;
  const organizationId = context!.organizationId!;
  const body = await request.json().catch(() => ({}));
  const store = await readSubscriptionBilling(organizationId);
  store.profile = sanitizeProfile(body.profile ?? body);
  await writeSubscriptionBilling(organizationId, store);
  invalidatePortalDataPrefix(`org-admin:${organizationId}:`);
  return NextResponse.json({ ok: true, profile: store.profile });
}

export async function POST(request: NextRequest) {
  const { context, error } = await loadContext();
  if (error) return error;
  const organizationId = context!.organizationId!;
  const body = await request.json().catch(() => ({}));
  const store0 = await readSubscriptionBilling(organizationId);
  const method = String(body.method || store0.profile?.preferredMethod || "").toUpperCase();
  if (!METHODS.has(method)) return NextResponse.json({ error: "Choose a valid payment method" }, { status: 400 });

  const subscription = await prisma.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
  const invoiceId = body.invoiceId ? String(body.invoiceId) : "";

  // Two charge sources: a specific platform-issued invoice, or the plan's
  // recurring monthly price. Resolve amount/currency/period/rollFrom for each.
  let amount: number, currency: string, label: string, invoiceNumber: string, description: string, advancesPeriod: boolean;
  let rollFrom: Date;
  if (invoiceId) {
    const invoice = store0.invoices.find((item) => item.id === invoiceId);
    if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    if (invoice.status !== "ISSUED") return NextResponse.json({ error: `This invoice is already ${invoice.status.toLowerCase()}.` }, { status: 409 });
    amount = invoice.total; currency = invoice.currency; label = invoice.periodLabel;
    invoiceNumber = invoice.number; description = `SLMS invoice ${invoice.number}`;
    advancesPeriod = invoice.advancesPeriod;
    rollFrom = subscription?.currentPeriodEnd ?? new Date();
  } else {
    if (!subscription?.plan) return NextResponse.json({ error: "No active subscription plan" }, { status: 400 });
    const meta = (await readPlanMeta())[subscription.plan.id];
    const price = meta?.priceMonthly ?? null;
    if (price === null || price <= 0) return NextResponse.json({ error: "This plan has no price set. Contact the SLMS Platform Administrator." }, { status: 400 });
    amount = price; currency = meta?.currency || "PHP";
    const dueDate = computeNextBilling(subscription) || new Date();
    rollFrom = dueDate;
    // Label by the period actually being covered; for a lapsed org the due date
    // is past, so anchor to "now" rather than a stale month.
    label = periodLabel(new Date(Math.max(new Date(dueDate).getTime(), Date.now())));
    const ordinal = store0.payments.filter((payment) => payment.periodLabel === label).length + 1;
    invoiceNumber = buildInvoiceNumber(label, organizationId, ordinal);
    description = `SLMS subscription — ${subscription.plan.name}`;
    advancesPeriod = true;
  }

  const reference = `SUBS-${organizationId.slice(0, 8)}-${crypto.randomBytes(3).toString("hex")}`;
  const result = await createCheckout({ amount, currency, description, referenceId: reference });
  if (!result.ok) return NextResponse.json({ error: result.error || "Payment could not be started" }, { status: 502 });

  const store = await readSubscriptionBilling(organizationId);

  // A real hosted-checkout URL means the charge completes off-site (confirmed by
  // the provider) — record it as PENDING and hand the URL back to redirect. When
  // no provider is configured the layer simulates success, so we settle it now.
  if (result.checkoutUrl) {
    const payment: SubscriptionPayment = { id: crypto.randomUUID(), amount, currency, method, reference: result.referenceId || reference, provider: result.provider, status: "PENDING", periodLabel: label, paidAt: new Date().toISOString(), invoiceNumber };
    store.payments.unshift(payment);
    await writeSubscriptionBilling(organizationId, store);
    invalidatePortalDataPrefix(`org-admin:${organizationId}:`);
    return NextResponse.json({ ok: true, checkoutUrl: result.checkoutUrl, payment });
  }

  const payment: SubscriptionPayment = { id: crypto.randomUUID(), amount, currency, method, reference: result.referenceId || reference, provider: result.provider, status: "PAID", periodLabel: label, paidAt: new Date().toISOString(), invoiceNumber };
  store.payments.unshift(payment);
  // Settle the invoice if this payment was for one.
  if (invoiceId) {
    const invoice = store.invoices.find((item) => item.id === invoiceId);
    if (invoice && invoice.status === "ISSUED") { invoice.status = "PAID"; invoice.paidAt = payment.paidAt; invoice.paymentId = payment.id; invoice.paymentMethod = method; }
  }
  if (advancesPeriod && subscription) {
    const nextPeriodEnd = new Date(Math.max(new Date(rollFrom).getTime(), Date.now()));
    nextPeriodEnd.setMonth(nextPeriodEnd.getMonth() + 1);
    store.lastReminderPeriod = null; // paid — clear so the next cycle can remind again
    store.pastDueSince = null; // paid — clear the grace-window anchor
    await prisma.subscription.update({ where: { organizationId }, data: { status: "ACTIVE", currentPeriodEnd: nextPeriodEnd } });
    // Notify platform admins that a customer subscribed / renewed. Best-effort.
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    await notifyPlatformAdmins({
      title: "Subscription payment received",
      message: `${org?.name ?? "An organization"} paid ${currency} ${amount.toLocaleString()} for ${subscription.plan?.name ?? "subscription"} (${invoiceNumber}).`,
      severity: "WARNING",
      relatedEntityId: subscription.id,
      relatedEntityType: "subscription",
      organizationId,
    });
  }
  await writeSubscriptionBilling(organizationId, store);
  logAudit({ actorId: context!.userId, actorRole: context!.role, action: "CREATE", entityType: "subscription-payment", entityId: payment.id, organizationId, after: { amount, currency, method, provider: result.provider, invoiceId: invoiceId || null } });
  invalidatePortalDataPrefix(`org-admin:${organizationId}:`);
  return NextResponse.json({ ok: true, simulated: result.provider === "simulated", payment });
}
