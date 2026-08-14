"use client";

/**
 * InvoiceDocument — a printable / shareable invoice. Reused by the Billing &
 * Finance portal, the per-resident Billing Record, and the Family dashboard.
 * Renders the facility header, Bill-To (resident + family sponsor), itemized
 * line items (from the invoice's service charges), totals, and a Print action.
 * Print is scoped to the document via a self-contained @media print rule.
 */

import { Printer, CheckCircle2 } from "lucide-react";

const money = (n: number) => `₱${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 border-gray-200",
  SENT: "bg-blue-100 text-blue-700 border-blue-200",
  PAID: "bg-green-100 text-green-700 border-green-200",
  OVERDUE: "bg-red-100 text-red-700 border-red-200",
  CANCELLED: "bg-gray-100 text-gray-500 border-gray-200",
};

export interface InvoiceLineItem { id: string; serviceDate: string | null; category: string; description: string; amount: number }
export interface InvoiceDocData {
  id: string;
  invoiceNumber: string;
  residentName: string;
  room?: string;
  totalAmount: number;
  amountPaid: number;
  balance: number;
  dueDate: string | null;
  status: string;
  description: string;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  sentAt?: string | null;
  paidAt?: string | null;
  serviceCharges: InvoiceLineItem[];
}

export default function InvoiceDocument({ invoice, facilityName, sponsorName, onClose }: { invoice: InvoiceDocData; facilityName?: string; sponsorName?: string; onClose: () => void }) {
  // Line items: the invoice's linked service charges, or a single line from the
  // invoice description when it was billed without itemized charges.
  const lines: InvoiceLineItem[] = invoice.serviceCharges.length
    ? invoice.serviceCharges
    : [{ id: invoice.id, serviceDate: invoice.billingPeriodEnd ?? invoice.dueDate ?? null, category: "Care Services", description: invoice.description || "Care & services", amount: invoice.totalAmount }];
  const subtotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const badge = STATUS_BADGE[invoice.status] ?? STATUS_BADGE.DRAFT;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <style>{`@media print { body * { visibility: hidden !important; } #printable-invoice, #printable-invoice * { visibility: visible !important; } #printable-invoice { position: absolute; left: 0; top: 0; width: 100%; padding: 24px; } .no-print { display: none !important; } }`}</style>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div id="printable-invoice" className="p-8">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-5">
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">{facilityName || "Assisted Living Facility"}</h2>
              <p className="text-xs text-slate-500 mt-0.5">Official Billing Statement</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Invoice</p>
              <p className="text-lg font-extrabold text-slate-900">{invoice.invoiceNumber}</p>
              <span className={`inline-block mt-1 px-2.5 py-0.5 rounded-lg text-xs font-bold border ${badge}`}>{invoice.status}</span>
            </div>
          </div>

          {/* Bill To + meta */}
          <div className="grid grid-cols-2 gap-6 py-5 text-sm">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">Bill To</p>
              <p className="font-bold text-slate-900">{invoice.residentName}{invoice.room && invoice.room !== "—" ? ` · Room ${invoice.room}` : ""}</p>
              {sponsorName ? <p className="text-slate-600 mt-0.5">c/o {sponsorName} <span className="text-slate-400">(family sponsor)</span></p> : null}
            </div>
            <div className="text-right space-y-1">
              {(invoice.billingPeriodStart && invoice.billingPeriodEnd) && (
                <div className="flex justify-end gap-2"><span className="text-slate-400">Period:</span><span className="font-semibold text-slate-700">{day(invoice.billingPeriodStart)} – {day(invoice.billingPeriodEnd)}</span></div>
              )}
              {invoice.sentAt && <div className="flex justify-end gap-2"><span className="text-slate-400">Issued:</span><span className="font-semibold text-slate-700">{day(invoice.sentAt)}</span></div>}
              <div className="flex justify-end gap-2"><span className="text-slate-400">Due:</span><span className="font-semibold text-slate-700">{day(invoice.dueDate)}</span></div>
            </div>
          </div>

          {/* Line items */}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-white" style={{ backgroundColor: "#2E4A48" }}>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider rounded-l-lg">Date</th>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider">Category</th>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider">Description</th>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-right rounded-r-lg">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{l.serviceDate ? day(l.serviceDate) : "—"}</td>
                  <td className="px-4 py-2.5"><span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-xs font-semibold">{l.category}</span></td>
                  <td className="px-4 py-2.5 text-slate-700">{l.description}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-slate-900 tabular-nums">{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end pt-5">
            <div className="w-64 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="font-semibold text-slate-800 tabular-nums">{money(subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Invoice Total</span><span className="font-semibold text-slate-800 tabular-nums">{money(invoice.totalAmount)}</span></div>
              <div className="flex justify-between text-green-700"><span>Amount Paid</span><span className="font-semibold tabular-nums">{money(invoice.amountPaid)}</span></div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base"><span className="font-extrabold text-slate-900">Balance Due</span><span className={`font-extrabold tabular-nums ${invoice.balance > 0 ? "text-amber-600" : "text-green-600"}`}>{money(invoice.balance)}</span></div>
            </div>
          </div>

          {invoice.status === "PAID" && (
            <div className="mt-4 flex items-center justify-end gap-1.5 text-green-700 text-sm font-bold"><CheckCircle2 className="w-4 h-4" /> Paid in full{invoice.paidAt ? ` on ${day(invoice.paidAt)}` : ""}</div>
          )}
          <p className="text-center text-[10px] text-slate-400 mt-6 leading-relaxed">Please settle any outstanding balance by the due date. Thank you for entrusting your loved one&apos;s care to {facilityName || "our facility"}.</p>
        </div>

        <div className="no-print bg-slate-50 border-t border-slate-200 px-6 py-4 flex flex-wrap justify-between gap-2">
          <button onClick={onClose} className="px-5 py-2 text-slate-700 hover:bg-slate-100 border border-slate-300 rounded-lg text-sm font-semibold transition">Close</button>
          <button onClick={() => window.print()} className="flex items-center gap-2 px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-lg text-sm transition"><Printer className="w-4 h-4" /> Print / Save PDF</button>
        </div>
      </div>
    </div>
  );
}
