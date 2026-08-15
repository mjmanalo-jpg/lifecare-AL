"use client";

/**
 * InvoiceDocument — a printable / shareable invoice in the classic business
 * format (company header · INVOICE title · Invoice #/Date box · Bill-To ·
 * itemized Description/Amount table · Total). Reused by the Billing & Finance
 * portal, the per-resident Billing Record, and the Family dashboard. PHP (₱).
 * Print is scoped to the document via a self-contained @media print rule.
 */

import { Printer } from "lucide-react";
import { useFacilityConfig } from "@/lib/useFacilityConfig";

// Positive → "₱1,234.00"; negative (e.g. a discount) → "(₱50.00)" in the classic style.
const money = (n: number) => {
  const v = Number(n) || 0;
  const abs = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(₱${abs})` : `₱${abs}`;
};
const day = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");

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
  const cfg = useFacilityConfig();
  const company = facilityName || cfg.facilityName || "Assisted Living Facility";
  const addressLines = String(cfg.facilityAddress || "").split(/\n|,\s*/).map((l) => l.trim()).filter(Boolean);

  const lines: InvoiceLineItem[] = invoice.serviceCharges.length
    ? invoice.serviceCharges
    : [{ id: invoice.id, serviceDate: invoice.billingPeriodEnd ?? invoice.dueDate ?? null, category: "Care Services", description: invoice.description || "Care & services", amount: invoice.totalAmount }];
  // Pad to a stable minimum number of rows so the sheet keeps the classic look.
  const padRows = Math.max(0, 8 - lines.length);
  const isPaid = invoice.status === "PAID" || invoice.balance <= 0;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <style>{`@media print { body * { visibility: hidden !important; } #printable-invoice, #printable-invoice * { visibility: visible !important; } #printable-invoice { position: absolute; left: 0; top: 0; width: 100%; padding: 32px; } .no-print { display: none !important; } }`}</style>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div id="printable-invoice" className="p-8 sm:p-10 text-[13px] text-slate-800">
          {/* Header: company (left) · INVOICE (right) */}
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-slate-900">{company}</h1>
              {addressLines.length > 0
                ? addressLines.map((l, i) => <p key={i} className="text-xs text-slate-500 leading-5">{l}</p>)
                : <p className="text-xs text-slate-400 leading-5">Official billing statement</p>}
            </div>
            <p className="text-3xl sm:text-4xl font-light uppercase tracking-[0.15em] text-slate-400 shrink-0">Invoice</p>
          </div>

          {/* Invoice # / Date box */}
          <div className="mt-5 flex justify-end">
            <table className="border-collapse text-xs">
              <thead>
                <tr>
                  <th className="border border-slate-300 bg-slate-100 px-6 py-1.5 font-bold uppercase tracking-wide text-slate-600">Invoice #</th>
                  <th className="border border-slate-300 bg-slate-100 px-6 py-1.5 font-bold uppercase tracking-wide text-slate-600">Date</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-slate-300 px-6 py-1.5 text-center font-semibold text-slate-800">{invoice.invoiceNumber}</td>
                  <td className="border border-slate-300 px-6 py-1.5 text-center text-slate-700">{day(invoice.sentAt || invoice.billingPeriodEnd || invoice.dueDate)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Bill To */}
          <div className="mt-6">
            <div className="border border-slate-300 bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-600 w-56">Bill To</div>
            <div className="mt-2 text-sm leading-6">
              <p className="font-semibold text-slate-900">{invoice.residentName}{invoice.room && invoice.room !== "—" ? ` · Room ${invoice.room}` : ""}</p>
              {sponsorName ? <p className="text-slate-600">c/o {sponsorName} <span className="text-slate-400">(family sponsor · payer)</span></p> : null}
              {invoice.billingPeriodStart && invoice.billingPeriodEnd
                ? <p className="text-slate-500 text-xs">Billing period: {day(invoice.billingPeriodStart)} – {day(invoice.billingPeriodEnd)}</p>
                : null}
              <p className="text-slate-500 text-xs">Due: {day(invoice.dueDate)}</p>
            </div>
          </div>

          {/* Line items: Date | Category | Description | Amount */}
          <table className="mt-5 w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-slate-300 bg-slate-100 px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600 w-28">Date</th>
                <th className="border border-slate-300 bg-slate-100 px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600 w-36">Category</th>
                <th className="border border-slate-300 bg-slate-100 px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Description</th>
                <th className="border border-slate-300 bg-slate-100 px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600 w-32">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="border-x border-slate-300 px-3 py-1.5 text-slate-500 whitespace-nowrap">{l.serviceDate ? day(l.serviceDate) : "—"}</td>
                  <td className="border-x border-slate-300 px-3 py-1.5 font-semibold text-slate-700">{l.category || "—"}</td>
                  <td className="border-x border-slate-300 px-3 py-1.5 text-slate-700">{l.description}</td>
                  <td className="border-x border-slate-300 px-3 py-1.5 text-right tabular-nums text-slate-800">{money(l.amount)}</td>
                </tr>
              ))}
              {Array.from({ length: padRows }).map((_, i) => (
                <tr key={`pad-${i}`}>
                  <td className="border-x border-slate-300 px-3 py-1.5">&nbsp;</td>
                  <td className="border-x border-slate-300 px-3 py-1.5">&nbsp;</td>
                  <td className="border-x border-slate-300 px-3 py-1.5">&nbsp;</td>
                  <td className="border-x border-slate-300 px-3 py-1.5">&nbsp;</td>
                </tr>
              ))}
              <tr><td className="border border-slate-300" colSpan={4}></td></tr>
            </tbody>
          </table>

          {/* Total bar */}
          <div className="mt-0 flex text-sm">
            <div className="flex-1 px-3 py-3 italic text-slate-500">Thank you for your business!</div>
            <div className="w-56 border border-slate-300">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200"><span className="text-slate-500">Subtotal</span><span className="tabular-nums text-slate-700">{money(invoice.totalAmount)}</span></div>
              {invoice.amountPaid > 0 && <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 text-emerald-700"><span>Amount paid</span><span className="tabular-nums">{money(-invoice.amountPaid)}</span></div>}
              <div className="flex items-center justify-between bg-slate-100 px-3 py-2"><span className="font-bold uppercase tracking-wide text-slate-800">Total</span><span className={`font-extrabold tabular-nums ${invoice.balance > 0 ? "text-amber-600" : "text-emerald-700"}`}>{money(invoice.balance)}</span></div>
            </div>
          </div>

          {isPaid && (
            <p className="mt-3 text-right text-sm font-bold uppercase tracking-wide text-emerald-700">Paid in full{invoice.paidAt ? ` · ${day(invoice.paidAt)}` : ""}</p>
          )}

          {/* Footer contact */}
          <p className="mt-8 text-center text-xs text-slate-500 leading-relaxed">
            If you have any questions about this invoice, please contact<br />
            <span className="font-semibold text-slate-600">{company}</span>{addressLines.length ? ` · ${addressLines.join(", ")}` : ""}
          </p>
        </div>

        <div className="no-print bg-slate-50 border-t border-slate-200 px-6 py-4 flex flex-wrap justify-between gap-2">
          <button onClick={onClose} className="px-5 py-2 text-slate-700 hover:bg-slate-100 border border-slate-300 rounded-lg text-sm font-semibold transition">Close</button>
          <button onClick={() => window.print()} className="flex items-center gap-2 px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-lg text-sm transition"><Printer className="w-4 h-4" /> Print / Save PDF</button>
        </div>
      </div>
    </div>
  );
}
