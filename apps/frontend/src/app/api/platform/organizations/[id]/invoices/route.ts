import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";
import { readPlanMeta } from "@/lib/planMeta";
import { readSubscriptionBilling, writeSubscriptionBilling, buildInvoiceNumber, invoiceTotal, periodLabel, computeNextBilling, type SaasInvoice, type SaasInvoiceLine } from "@/lib/subscriptionBilling";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Platform-admin invoices issued to a customer org. GET lists them; POST issues
// a new one with line items. Mark-paid / void live in the [invoiceId] route.

async function requirePlatform() {
  const context = await requireTenantContext({ allowPlatform: true });
  if (context && requiresPrivilegedMfa(context)) return { error: NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 }) };
  if (context?.platformRole !== "PLATFORM_ADMIN") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { context };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requirePlatform();
  if (error) return error;
  const { id } = await params;
  const store = await readSubscriptionBilling(id);
  return NextResponse.json({ invoices: store.invoices });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { context, error } = await requirePlatform();
  if (error) return error;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const rawLines = Array.isArray(body.lineItems) ? body.lineItems : [];
  const lineItems: SaasInvoiceLine[] = rawLines
    .map((line: Record<string, unknown>) => ({ description: String(line?.description || "").slice(0, 200), amount: Math.round(Number(line?.amount) || 0) }))
    .filter((line: SaasInvoiceLine) => line.description && line.amount > 0);
  if (!lineItems.length) return NextResponse.json({ error: "Add at least one line item with a description and a positive amount" }, { status: 400 });

  const subscription = await prisma.subscription.findUnique({ where: { organizationId: id }, include: { plan: true } });
  const meta = subscription?.plan ? (await readPlanMeta())[subscription.plan.id] : undefined;
  const currency = String(body.currency || meta?.currency || "PHP").toUpperCase().slice(0, 8);

  const now = new Date();
  const due = subscription ? computeNextBilling(subscription, now) : null;
  const period = String(body.periodLabel || periodLabel(due && due.getTime() > now.getTime() ? due : now)).slice(0, 7);
  const dueDate = body.dueDate ? new Date(body.dueDate) : (due && due.getTime() > now.getTime() ? due : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));

  const store = await readSubscriptionBilling(id);
  const ordinal = store.invoices.filter((invoice) => invoice.periodLabel === period).length + 1;
  const invoice: SaasInvoice = {
    id: crypto.randomUUID(),
    number: buildInvoiceNumber(period, id, ordinal),
    status: "ISSUED",
    currency,
    lineItems,
    total: invoiceTotal(lineItems),
    periodLabel: period,
    advancesPeriod: body.advancesPeriod !== false,
    issuedAt: now.toISOString(),
    dueDate: Number.isNaN(dueDate.getTime()) ? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() : dueDate.toISOString(),
    paidAt: null,
    paymentId: null,
    paymentMethod: null,
    notes: String(body.notes || "").slice(0, 400),
  };
  store.invoices.unshift(invoice);
  await writeSubscriptionBilling(id, store);
  logAudit({ actorId: context!.userId, actorRole: context!.role, action: "CREATE", entityType: "saas-invoice", entityId: invoice.id, organizationId: id, after: { number: invoice.number, total: invoice.total, currency } });
  return NextResponse.json({ ok: true, invoice });
}
