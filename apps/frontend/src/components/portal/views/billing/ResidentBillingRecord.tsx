"use client";

/**
 * Resident Billing Record — a per-resident billing folder for the Billing &
 * Finance portal. Pick a resident to see their running balance and every issued
 * invoice, receipt (payment), and service charge in one place, with printable /
 * shareable invoices and receipts. Read-only over the live billing data
 * (Invoice / ServiceCharge / Payment); invoicing itself stays manual.
 */

import { useMemo, useState } from "react";
import { Search, User, Printer, CheckCircle2, FileText, Layers, Wallet } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { useFacilityConfig } from "@/lib/useFacilityConfig";
import { adaptResident, adaptInvoice, adaptServiceCharge, adaptPayment } from "@/lib/adapters";
import InvoiceDocument from "./InvoiceDocument";
import ReceiptDocument from "./ReceiptDocument";

const money = (n: number) => `₱${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");

type Invoice = ReturnType<typeof adaptInvoice>;
type Payment = ReturnType<typeof adaptPayment>;
type ResRow = { id: string; name: string; room: string; sponsorId: string; sponsorName: string };

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700", SENT: "bg-blue-100 text-blue-700", PAID: "bg-green-100 text-green-700", OVERDUE: "bg-red-100 text-red-700", CANCELLED: "bg-gray-100 text-gray-500",
};

export default function ResidentBillingRecord() {
  const { facilityName } = useFacilityConfig();
  const resQ = useLiveQuery<Record<string, unknown>>("residents", { query: "include=sponsor", tables: ["Resident", "User"] });
  const invQ = useLiveQuery("invoices", { query: "include=resident,serviceCharges,payments&take=500", tables: ["Invoice", "Resident", "ServiceCharge", "Payment"] });
  const chargeQ = useLiveQuery("service-charges", { query: "include=resident,invoice&take=1000", tables: ["ServiceCharge", "Resident", "Invoice"] });
  const payQ = useLiveQuery("payments", { query: "include=invoice&take=500", tables: ["Payment", "Invoice"] });

  const residents = useMemo<ResRow[]>(() => (resQ.data || []).map((raw) => {
    const a = adaptResident(raw);
    const sp = (raw.sponsor ?? null) as { id?: unknown; name?: unknown } | null;
    return { id: String(a.id), name: String(a.name), room: String(a.room ?? ""), sponsorId: sp?.id ? String(sp.id) : "", sponsorName: sp?.name ? String(sp.name) : "" };
  }), [resQ.data]);
  const invoices = useMemo(() => (invQ.data || []).map((v: unknown) => adaptInvoice(v)), [invQ.data]);
  const charges = useMemo(() => (chargeQ.data || []).map((c: unknown) => adaptServiceCharge(c)), [chargeQ.data]);
  const payments = useMemo(() => (payQ.data || []).map((p: unknown) => adaptPayment(p)), [payQ.data]);

  const [selId, setSelId] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"invoices" | "receipts" | "charges">("invoices");
  const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null);
  const [viewReceipt, setViewReceipt] = useState<Payment | null>(null);

  // Outstanding balance per resident (for the list badges).
  const balByResident = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of invoices) {
      const rid = String((v.raw as { residentId?: unknown })?.residentId ?? "");
      if (!rid || v.status === "CANCELLED") continue;
      m.set(rid, (m.get(rid) ?? 0) + v.balance);
    }
    return m;
  }, [invoices]);

  const q = search.trim().toLowerCase();
  const filteredResidents = residents.filter((r) => !q || r.name.toLowerCase().includes(q) || r.room.toLowerCase().includes(q));
  const selected = residents.find((r) => r.id === selId) || null;

  const resInvoices = useMemo(() => invoices.filter((v) => String((v.raw as { residentId?: unknown })?.residentId ?? "") === selId), [invoices, selId]);
  const resInvoiceIds = useMemo(() => new Set(resInvoices.map((v) => v.id)), [resInvoices]);
  const resCharges = useMemo(() => charges.filter((c) => c.residentId === selId), [charges, selId]);
  const resPayments = useMemo(() => payments.filter((p) => resInvoiceIds.has(String(p.invoiceId))), [payments, resInvoiceIds]);

  const active = resInvoices.filter((v) => v.status !== "CANCELLED");
  const totalInvoiced = active.reduce((s, v) => s + v.totalAmount, 0);
  const totalPaid = active.reduce((s, v) => s + v.amountPaid, 0);
  const outstanding = active.reduce((s, v) => s + Math.max(0, v.balance), 0);
  const unbilled = resCharges.filter((c) => !c.invoiceId).reduce((s, c) => s + c.amount, 0);

  return (
    <div className="min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6">
      <div className="mb-4">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 flex items-center gap-2"><FileText className="w-6 h-6 text-teal-600" /> Resident Billing Records</h1>
        <p className="text-sm text-slate-500 mt-1">One folder per resident — issued invoices, receipts, service charges and running balance.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Resident list */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="p-3 border-b border-slate-100">
            <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resident or room…" className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-teal-400/40" /></div>
          </div>
          <div className="max-h-[70vh] overflow-y-auto divide-y divide-slate-100">
            {filteredResidents.length === 0 ? <p className="p-6 text-center text-sm text-slate-400">No residents.</p>
              : filteredResidents.map((r) => {
                const bal = balByResident.get(r.id) ?? 0;
                return (
                  <button key={r.id} onClick={() => setSelId(r.id)} className={`w-full text-left px-4 py-3 flex items-center justify-between gap-2 transition ${selId === r.id ? "bg-teal-50" : "hover:bg-slate-50"}`}>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 truncate">{r.name}</p>
                      <p className="text-xs text-slate-400">{r.room ? `Room ${r.room}` : "—"}{r.sponsorName ? ` · ${r.sponsorName}` : ""}</p>
                    </div>
                    {bal > 0 && <span className="shrink-0 text-xs font-bold text-amber-600 tabular-nums">{money(bal)}</span>}
                  </button>
                );
              })}
          </div>
        </div>

        {/* Detail */}
        <div>
          {!selected ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-400"><User className="w-8 h-8 mx-auto mb-2 opacity-40" />Select a resident to view their billing record.</div>
          ) : (
            <div className="space-y-4">
              {/* Header + stats */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{selected.name}</h2>
                    <p className="text-sm text-slate-500">{selected.room ? `Room ${selected.room}` : "—"}</p>
                    <p className="text-sm text-slate-600 mt-1">Bill to: <b>{selected.sponsorName || selected.name}</b> {selected.sponsorName ? <span className="text-slate-400">(family sponsor)</span> : <span className="text-slate-400">(no sponsor on file)</span>}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
                  <Stat icon={FileText} label="Total Invoiced" value={money(totalInvoiced)} tone="#334155" />
                  <Stat icon={CheckCircle2} label="Total Paid" value={money(totalPaid)} tone="#16a34a" />
                  <Stat icon={Wallet} label="Outstanding" value={money(outstanding)} tone={outstanding > 0 ? "#d97706" : "#16a34a"} />
                  <Stat icon={Layers} label="Unbilled Charges" value={money(unbilled)} tone="#2563eb" />
                </div>
              </div>

              {/* Sub tabs */}
              <div className="inline-flex gap-1 bg-slate-100 rounded-xl p-1">
                {([["invoices", "Invoices", resInvoices.length], ["receipts", "Receipts", resPayments.length], ["charges", "Service Charges", resCharges.length]] as const).map(([v, label, n]) => (
                  <button key={v} onClick={() => setTab(v)} className={`px-3.5 py-1.5 rounded-lg text-sm font-medium ${tab === v ? "bg-white shadow-sm text-slate-800" : "text-slate-500"}`}>{label} {n}</button>
                ))}
              </div>

              {tab === "invoices" && (
                <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead><tr className="text-left text-white" style={{ backgroundColor: "#2E4A48" }}>{["Invoice", "Issued / Due", "Total", "Paid", "Balance", "Status", ""].map((h, i) => <th key={i} className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider">{h}</th>)}</tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {resInvoices.length === 0 ? <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-400">No invoices for this resident yet.</td></tr>
                          : resInvoices.map((v) => (
                            <tr key={v.id} className="hover:bg-slate-50/60">
                              <td className="px-5 py-3 font-semibold text-slate-800">{v.invoiceNumber}</td>
                              <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{day(v.sentAt) } · due {day(v.dueDate)}</td>
                              <td className="px-5 py-3 tabular-nums text-slate-800">{money(v.totalAmount)}</td>
                              <td className="px-5 py-3 tabular-nums text-green-700">{money(v.amountPaid)}</td>
                              <td className="px-5 py-3 tabular-nums font-semibold text-amber-600">{money(v.balance)}</td>
                              <td className="px-5 py-3"><span className={`px-2 py-0.5 rounded text-[11px] font-bold ${STATUS_BADGE[v.status] ?? STATUS_BADGE.DRAFT}`}>{v.status}</span></td>
                              <td className="px-5 py-3 text-right"><button onClick={() => setViewInvoice(v)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Printer className="w-3.5 h-3.5" /> View / Print</button></td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {tab === "receipts" && (
                <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] text-sm">
                      <thead><tr className="text-left text-white" style={{ backgroundColor: "#2E4A48" }}>{["Receipt", "Invoice", "Date", "Method", "Amount", ""].map((h, i) => <th key={i} className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider">{h}</th>)}</tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {resPayments.length === 0 ? <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">No receipts yet — receipts appear once a payment is recorded.</td></tr>
                          : resPayments.map((p) => (
                            <tr key={p.id} className="hover:bg-slate-50/60">
                              <td className="px-5 py-3 font-mono text-xs text-slate-600">#{(p.transactionId || p.id).slice(-6).toUpperCase()}</td>
                              <td className="px-5 py-3 font-semibold text-slate-800">{p.invoiceNumber}</td>
                              <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{day(p.paymentDate)}</td>
                              <td className="px-5 py-3 text-slate-600">{p.paymentMethod || "—"}</td>
                              <td className="px-5 py-3 tabular-nums font-bold text-green-700">{money(p.amount)}</td>
                              <td className="px-5 py-3 text-right"><button onClick={() => setViewReceipt(p)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Printer className="w-3.5 h-3.5" /> View / Print</button></td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {tab === "charges" && (
                <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] text-sm">
                      <thead><tr className="text-left text-white" style={{ backgroundColor: "#2E4A48" }}>{["Date", "Category", "Description", "Amount", "Status"].map((h, i) => <th key={i} className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider">{h}</th>)}</tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {resCharges.length === 0 ? <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No service charges for this resident.</td></tr>
                          : resCharges.map((c) => (
                            <tr key={c.id} className="hover:bg-slate-50/60">
                              <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{day(c.serviceDate)}</td>
                              <td className="px-5 py-3"><span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-xs font-semibold">{c.category}</span></td>
                              <td className="px-5 py-3 text-slate-700 max-w-[280px] truncate">{c.description}</td>
                              <td className="px-5 py-3 tabular-nums font-semibold text-slate-900">{money(c.amount)}</td>
                              <td className="px-5 py-3">{c.invoiceId ? <span className="text-green-700 font-bold text-xs inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Billed ({c.invoiceNumber})</span> : <span className="text-amber-700 font-bold text-xs">Pending</span>}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {viewInvoice && <InvoiceDocument invoice={viewInvoice} facilityName={facilityName} sponsorName={selected?.sponsorName || undefined} onClose={() => setViewInvoice(null)} />}
      {viewReceipt && <ReceiptDocument facilityName={facilityName} onClose={() => setViewReceipt(null)} receipt={{
        receiptNumber: viewReceipt.transactionId || viewReceipt.id,
        invoiceNumber: viewReceipt.invoiceNumber,
        date: viewReceipt.paymentDate ? String(viewReceipt.paymentDate) : null,
        residentName: selected?.name || "—",
        sponsorName: selected?.sponsorName || undefined,
        paymentMethod: viewReceipt.paymentMethod,
        transactionId: viewReceipt.transactionId || viewReceipt.id,
        total: Number(viewReceipt.amount) || 0,
      }} />}
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400"><Icon className="w-3.5 h-3.5" /> {label}</div>
      <p className="text-lg font-extrabold mt-1 tabular-nums" style={{ color: tone }}>{value}</p>
    </div>
  );
}

