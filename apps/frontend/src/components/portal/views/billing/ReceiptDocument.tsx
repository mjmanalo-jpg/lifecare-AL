"use client";

/**
 * ReceiptDocument — a printable payment receipt in the classic business format
 * (Company Name · RECEIPT · Invoice #/Date · Mailing-Info / Bill-To · itemized
 * Description/Amount table with a diagonal PAID watermark · Subtotal/Discount/
 * Total · "make cheques payable to"). Shared by the Billing & Finance portal,
 * the per-resident Billing Record, and the Family dashboard. PHP (₱).
 */

import { Printer } from "lucide-react";
import { useFacilityConfig } from "@/lib/useFacilityConfig";

const money = (n: number) => `₱${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");

export interface ReceiptLine { description: string; amount: number }
export interface ReceiptDocData {
  receiptNumber?: string;
  invoiceNumber?: string;
  date: string | null;
  residentName: string;
  room?: string;
  sponsorName?: string;
  paymentMethod?: string;
  transactionId?: string;
  lines?: ReceiptLine[];
  discount?: number;
  total: number;
}

export default function ReceiptDocument({ receipt, facilityName, onClose }: { receipt: ReceiptDocData; facilityName?: string; onClose: () => void }) {
  const cfg = useFacilityConfig();
  const company = facilityName || cfg.facilityName || "Assisted Living Facility";
  const addressLines = String(cfg.facilityAddress || "").split(/\n|,\s*/).map((l) => l.trim()).filter(Boolean);

  const lines: ReceiptLine[] = receipt.lines && receipt.lines.length
    ? receipt.lines
    : [{ description: receipt.invoiceNumber ? `Payment received — ${receipt.invoiceNumber}` : "Payment received", amount: receipt.total }];
  const subtotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const discount = Number(receipt.discount) || 0;
  const padRows = Math.max(0, 8 - lines.length);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <style>{`@media print { body * { visibility: hidden !important; } #printable-receipt, #printable-receipt * { visibility: visible !important; } #printable-receipt { position: absolute; left: 0; top: 0; width: 100%; padding: 32px; } .no-print { display: none !important; } }`}</style>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div id="printable-receipt" className="relative p-8 sm:p-10 text-[13px] text-slate-800">
          {/* PAID watermark */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
            <span className="select-none text-[7rem] font-black uppercase tracking-widest text-slate-900/10 -rotate-[24deg]">Paid</span>
          </div>

          <div className="relative">
            {/* Header: company · RECEIPT */}
            <div className="flex items-start justify-between gap-6 border-b-2 border-sky-600 pb-3">
              <h1 className="text-2xl font-bold text-sky-700 min-w-0">{company}</h1>
              <p className="text-2xl sm:text-3xl font-semibold uppercase tracking-[0.15em] text-sky-700 shrink-0">Receipt</p>
            </div>

            {/* Invoice # + date */}
            <div className="mt-3 flex items-center justify-between text-xs">
              <p><span className="font-bold uppercase tracking-wide text-slate-500">Invoice #</span> <span className="font-semibold text-slate-800">{receipt.invoiceNumber || "—"}</span></p>
              <p><span className="font-bold uppercase tracking-wide text-slate-500">Date</span> <span className="text-slate-700">{day(receipt.date)}</span></p>
            </div>

            {/* Mailing info | Bill to */}
            <div className="mt-5 grid grid-cols-2 gap-6 text-sm">
              <div className="flex gap-3">
                <span className="text-[10px] font-bold uppercase tracking-wide text-sky-700 pt-0.5">Mailing<br />Info</span>
                <div className="leading-6 text-slate-700">
                  <p className="font-semibold text-slate-900">{company}</p>
                  {addressLines.length ? addressLines.map((l, i) => <p key={i} className="text-xs">{l}</p>) : <p className="text-xs text-slate-400">—</p>}
                </div>
              </div>
              <div className="flex gap-3">
                <span className="text-[10px] font-bold uppercase tracking-wide text-sky-700 pt-0.5">Bill<br />To</span>
                <div className="leading-6 text-slate-700">
                  <p className="font-semibold text-slate-900">{receipt.residentName}{receipt.room && receipt.room !== "—" ? ` · Room ${receipt.room}` : ""}</p>
                  {receipt.sponsorName ? <p className="text-xs">c/o {receipt.sponsorName} (payer)</p> : null}
                  {receipt.paymentMethod ? <p className="text-xs">Method: {receipt.paymentMethod}</p> : null}
                  {receipt.transactionId ? <p className="text-xs text-slate-400">TXN: {receipt.transactionId}</p> : null}
                </div>
              </div>
            </div>

            {/* Line items */}
            <table className="mt-5 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-sky-600 text-sky-700">
                  <th className="px-1 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider">Description</th>
                  <th className="px-1 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider w-40">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="px-1 py-1.5 text-slate-700">{l.description}</td>
                    <td className="px-1 py-1.5 text-right tabular-nums text-slate-800">{money(l.amount)}</td>
                  </tr>
                ))}
                {Array.from({ length: padRows }).map((_, i) => (
                  <tr key={`pad-${i}`} className="border-b border-slate-100"><td className="px-1 py-1.5">&nbsp;</td><td className="px-1 py-1.5">&nbsp;</td></tr>
                ))}
              </tbody>
            </table>

            {/* Comments + totals */}
            <div className="mt-4 flex flex-wrap items-start justify-between gap-6">
              <div className="min-w-0 flex-1">
                <p className="border-b border-sky-600 pb-1 text-[11px] font-bold uppercase tracking-wider text-sky-700">Other comments</p>
                <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-slate-500">
                  <li>Thank you for keeping your account current.</li>
                  <li>Please quote the invoice number on any correspondence.</li>
                </ol>
              </div>
              <div className="w-56 text-sm">
                <div className="flex items-center justify-between py-1"><span className="text-slate-500">Subtotal</span><span className="tabular-nums text-slate-700">{money(subtotal)}</span></div>
                {discount > 0 && <div className="flex items-center justify-between py-1 text-slate-500"><span>Discount</span><span className="tabular-nums">({money(discount)})</span></div>}
                <div className="mt-1 flex items-center justify-between border-t-2 border-sky-600 py-2"><span className="font-bold uppercase tracking-wide text-slate-800">Total</span><span className="font-extrabold tabular-nums text-sky-700">{money(receipt.total)}</span></div>
              </div>
            </div>

            <div className="mt-6 flex items-end justify-between gap-4">
              <p className="text-lg font-bold text-sky-700">Thank you for your business!</p>
              <p className="text-right text-xs text-slate-500">Make all payments payable to:<br /><span className="font-semibold text-slate-700">{company}</span></p>
            </div>
          </div>
        </div>

        <div className="no-print bg-slate-50 border-t border-slate-200 px-6 py-4 flex flex-wrap justify-between gap-2">
          <button onClick={onClose} className="px-5 py-2 text-slate-700 hover:bg-slate-100 border border-slate-300 rounded-lg text-sm font-semibold transition">Close</button>
          <button onClick={() => window.print()} className="flex items-center gap-2 px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-lg text-sm transition"><Printer className="w-4 h-4" /> Print / Save PDF</button>
        </div>
      </div>
    </div>
  );
}
