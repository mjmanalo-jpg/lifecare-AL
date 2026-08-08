import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext, requiresPrivilegedMfa } from "@/lib/tenant";
import { readSubscriptionBilling } from "@/lib/subscriptionBilling";
import { readPaymentDetails } from "@/lib/paymentDetails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Printable platform-issued invoice document (ISSUED = amount due, PAID = paid,
// VOID = voided). Rendered on demand from the migration-free store.

const esc = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] as string));
function money(amount: number, currency: string): string {
  try { return new Intl.NumberFormat("en-PH", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount); }
  catch { return `${currency} ${amount.toLocaleString()}`; }
}

export async function GET(_request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const context = await requireTenantContext({ allowInactiveSubscription: true });
  if (!context?.organizationId || !["OWNER", "ADMIN"].includes(context.organizationRole || "")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (requiresPrivilegedMfa(context)) return NextResponse.json({ error: "MFA required", code: "MFA_REQUIRED" }, { status: 403 });

  const organizationId = context.organizationId;
  const { invoiceId } = await params;
  const [store, organization, payee] = await Promise.all([
    readSubscriptionBilling(organizationId),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, legalName: true, address: true, email: true } }),
    readPaymentDetails(),
  ]);
  const invoice = store.invoices.find((item) => item.id === invoiceId);
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const statusColor = invoice.status === "PAID" ? "#059669" : invoice.status === "VOID" ? "#64748b" : "#d97706";
  const rows = invoice.lineItems.map((line) => `<tr><td>${esc(line.description)}</td><td style="text-align:right">${esc(money(line.amount, invoice.currency))}</td></tr>`).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice ${esc(invoice.number)}</title>
<style>
  *{box-sizing:border-box} body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;margin:0;background:#f8fafc;padding:32px}
  .sheet{max-width:720px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .row{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap} h1{font-size:22px;margin:0 0 4px} .muted{color:#64748b;font-size:13px;margin:2px 0}
  .badge{display:inline-block;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:700;color:#fff;background:${statusColor}}
  table{width:100%;border-collapse:collapse;margin-top:28px} th,td{text-align:left;padding:12px 8px;border-bottom:1px solid #e2e8f0;font-size:14px}
  th{color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.05em} .total{font-size:20px;font-weight:800}
  .section{margin-top:28px;font-size:13px;color:#334155} .label{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;margin-bottom:2px}
  @media print{body{background:#fff;padding:0}.sheet{border:none;box-shadow:none}.noprint{display:none}}
  .btn{display:inline-block;margin-bottom:20px;padding:8px 16px;border-radius:8px;background:#4f46e5;color:#fff;text-decoration:none;font-size:13px;font-weight:600;border:none;cursor:pointer}
</style></head><body>
<div class="noprint" style="max-width:720px;margin:0 auto"><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>
<div class="sheet">
  <div class="row">
    <div><h1>${esc(payee.businessName || "Invoice")}</h1><p class="muted">SLMS subscription billing</p></div>
    <div style="text-align:right"><span class="badge">${esc(invoice.status)}</span><p class="muted">Invoice ${esc(invoice.number)}</p><p class="muted">Issued ${esc(new Date(invoice.issuedAt).toLocaleDateString())}</p></div>
  </div>
  <div class="row" style="margin-top:24px">
    <div><div class="label">Billed to</div><b>${esc(organization?.legalName || organization?.name || "Organization")}</b><p class="muted">${esc(organization?.address || "")}</p><p class="muted">${esc(organization?.email || "")}</p></div>
    <div style="text-align:right"><div class="label">${invoice.status === "PAID" ? "Paid on" : "Due"}</div><b>${esc(invoice.status === "PAID" && invoice.paidAt ? new Date(invoice.paidAt).toLocaleDateString() : new Date(invoice.dueDate).toLocaleDateString())}</b><p class="muted">Period ${esc(invoice.periodLabel)}</p></div>
  </div>
  <table>
    <thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${rows}<tr><td class="total">Total ${invoice.status === "PAID" ? "paid" : "due"}</td><td class="total" style="text-align:right">${esc(money(invoice.total, invoice.currency))}</td></tr></tbody>
  </table>
  ${invoice.notes ? `<div class="section">${esc(invoice.notes)}</div>` : ""}
  ${invoice.status === "ISSUED" && payee.notes ? `<div class="section">${esc(payee.notes)}</div>` : ""}
  <p class="section" style="color:#94a3b8;font-size:11px">Generated ${esc(new Date().toLocaleString())}</p>
</div>
</body></html>`;

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
