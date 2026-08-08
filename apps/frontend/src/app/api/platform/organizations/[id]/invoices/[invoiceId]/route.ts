import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";
import { readSubscriptionBilling, writeSubscriptionBilling, type SubscriptionPayment } from "@/lib/subscriptionBilling";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS = new Set(["CARD", "GCASH", "BANK_TRANSFER", "MAYA", "OFFLINE"]);

// Platform-admin actions on an issued invoice: mark it paid (recording an
// offline/manual payment and, for subscription invoices, reactivating + rolling
// the period) or void it.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; invoiceId: string }> }) {
  const context = await requireTenantContext({ allowPlatform: true });
  if (context && requiresPrivilegedMfa(context)) return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });
  if (context?.platformRole !== "PLATFORM_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, invoiceId } = await params;
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");

  const store = await readSubscriptionBilling(id);
  const invoice = store.invoices.find((item) => item.id === invoiceId);
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (invoice.status !== "ISSUED") return NextResponse.json({ error: `Invoice is already ${invoice.status}` }, { status: 409 });

  if (action === "void") {
    invoice.status = "VOID";
    await writeSubscriptionBilling(id, store);
    logAudit({ actorId: context.userId, actorRole: context.role, action: "UPDATE", entityType: "saas-invoice", entityId: invoice.id, organizationId: id, after: { status: "VOID" } });
    return NextResponse.json({ ok: true, invoice });
  }

  if (action === "markPaid") {
    const method = String(body.method || "BANK_TRANSFER").toUpperCase();
    if (!METHODS.has(method)) return NextResponse.json({ error: "Invalid payment method" }, { status: 400 });
    const now = new Date();
    const payment: SubscriptionPayment = {
      id: crypto.randomUUID(),
      amount: invoice.total,
      currency: invoice.currency,
      method,
      reference: invoice.number,
      provider: "manual",
      status: "PAID",
      periodLabel: invoice.periodLabel,
      paidAt: now.toISOString(),
      invoiceNumber: invoice.number,
    };
    store.payments.unshift(payment);
    invoice.status = "PAID";
    invoice.paidAt = now.toISOString();
    invoice.paymentId = payment.id;
    invoice.paymentMethod = method;

    if (invoice.advancesPeriod) {
      // Reactivate + roll the paid-through date forward a month from the later
      // of now and the existing period end (mirrors the org self-pay path).
      const subscription = await prisma.subscription.findUnique({ where: { organizationId: id } });
      if (subscription) {
        const base = subscription.currentPeriodEnd && subscription.currentPeriodEnd.getTime() > now.getTime() ? new Date(subscription.currentPeriodEnd) : new Date(now);
        base.setMonth(base.getMonth() + 1);
        await prisma.subscription.update({ where: { organizationId: id }, data: { status: "ACTIVE", currentPeriodEnd: base } });
      }
      store.pastDueSince = null;
      store.lastReminderPeriod = null;
    }
    await writeSubscriptionBilling(id, store);
    logAudit({ actorId: context.userId, actorRole: context.role, action: "UPDATE", entityType: "saas-invoice", entityId: invoice.id, organizationId: id, after: { status: "PAID", method, amount: invoice.total } });
    return NextResponse.json({ ok: true, invoice, payment });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
