import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * Issue an invoice to a resident: mark it SENT and push an in-app billing
 * notification to every account linked to that resident — the family sponsor,
 * the resident's own login, and any active authorized users. The invoice also
 * already shows live in their Family portal Billing tab (resident-scoped data).
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = await requireTenantContext({});
    if (!context || context.isPlatform || !context.communityId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const invoice = await prisma.invoice.findFirst({
      where: { id, resident: { communityId: context.communityId } },
      include: {
        resident: {
          select: {
            firstName: true,
            lastName: true,
            sponsorId: true,
            userId: true,
            authorizedUsers: { where: { isActive: true }, select: { userId: true } },
          },
        },
      },
    });
    if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    // Resolve the accounts that should receive this invoice.
    const recipientIds = new Set<string>();
    if (invoice.resident.sponsorId) recipientIds.add(invoice.resident.sponsorId);
    if (invoice.resident.userId) recipientIds.add(invoice.resident.userId);
    for (const a of invoice.resident.authorizedUsers) recipientIds.add(a.userId);

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: invoice.status === "PAID" ? "PAID" : "SENT", sentAt: new Date() },
    });

    const residentName = `${invoice.resident.firstName ?? ""} ${invoice.resident.lastName ?? ""}`.trim();
    const total = Math.round(invoice.totalAmount ?? 0).toLocaleString();
    const outstanding = Math.round(Math.max(0, (invoice.totalAmount ?? 0) - (invoice.amountPaid ?? 0))).toLocaleString();
    const due = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : null;
    const title = `Invoice ${invoice.invoiceNumber}`;
    const message = `A new invoice for ${residentName || "your account"} totaling $${total} has been issued${
      due ? `, due ${due}` : ""
    }. Outstanding balance: $${outstanding}.`;

    if (recipientIds.size > 0) {
      await prisma.notification.createMany({
        data: Array.from(recipientIds).map((userId) => ({
          userId,
          type: "BILLING_UPDATE" as const,
          title,
          message,
          relatedEntityId: invoice.id,
          relatedEntityType: "invoice",
          organizationId: context.organizationId ?? null,
          communityId: context.communityId ?? null,
        })),
      });
    }

    logAudit({
      actorId: context.userId,
      actorRole: context.role,
      action: "UPDATE",
      entityType: "invoice",
      entityId: invoice.id,
      reason: "invoice_sent",
      after: { recipients: recipientIds.size },
    });

    return NextResponse.json({ sent: true, recipients: recipientIds.size });
  } catch (error) {
    console.error("Invoice send failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Unable to send invoice" }, { status: 500 });
  }
}
