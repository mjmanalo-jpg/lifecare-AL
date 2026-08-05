"use client";

import { useMemo, useState } from "react";
import { Search, Download, Layers, CheckCircle, Clock, Receipt, FileText, Send, X } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord } from "@/lib/api";
import { adaptServiceCharge, adaptInvoice } from "@/lib/adapters";
import { fmt, sourceMeta, downloadCsv } from "./shared";

type Charge = ReturnType<typeof adaptServiceCharge>;
type LedgerStatus = "Paid" | "Invoiced" | "Pending";

const STATUS_BADGE: Record<LedgerStatus, string> = {
  Paid: "bg-green-100 text-green-700 border-green-200",
  Invoiced: "bg-blue-100 text-blue-700 border-blue-200",
  Pending: "bg-amber-100 text-amber-700 border-amber-200",
};

/**
 * Transactions Ledger — every ServiceCharge across all revenue sources
 * (care, hotel services, concierge, dining, transport) in one filterable view,
 * each marked Paid / Invoiced / Pending. This is the "where the money comes
 * from" record for the Billing & Finance portal.
 */
export default function BillingLedger() {
  const { data: chargeRows, loading, refetch: refetchCharges } = useLiveQuery<Record<string, unknown>>("service-charges", {
    query: "include=resident,invoice&take=500",
    tables: ["ServiceCharge", "Resident", "Invoice"],
  });
  const { data: invoiceRows, refetch: refetchInvoices } = useLiveQuery<Record<string, unknown>>("invoices", {
    query: "take=500",
    tables: ["Invoice"],
  });

  const charges = useMemo(() => chargeRows.map(adaptServiceCharge), [chargeRows]);
  const invStatus = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of invoiceRows) {
      const i = adaptInvoice(r);
      m.set(i.id, i.status);
    }
    return m;
  }, [invoiceRows]);

  const statusOf = (c: Charge): LedgerStatus => {
    if (!c.invoiceId) return "Pending";
    const s = invStatus.get(c.invoiceId);
    if (s === "PAID") return "Paid";
    if (!s || s === "CANCELLED") return "Pending";
    return "Invoiced";
  };

  const rows = useMemo(
    () => charges.map((c) => ({ c, status: statusOf(c) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [charges, invStatus],
  );

  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");

  const sources = useMemo(() => Array.from(new Set(charges.map((c) => c.category))).sort(), [charges]);

  // ── Invoice creation from selected pending charges ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showInvoice, setShowInvoice] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [invoiceDesc, setInvoiceDesc] = useState("");
  const [busy, setBusy] = useState(false);

  const pendingById = useMemo(() => {
    const m = new Map<string, Charge>();
    for (const { c, status: st } of rows) if (st === "Pending") m.set(c.id, c);
    return m;
  }, [rows]);

  const selectedCharges = useMemo(
    () => Array.from(selected).map((id) => pendingById.get(id)).filter(Boolean) as Charge[],
    [selected, pendingById],
  );
  const selTotal = selectedCharges.reduce((s, c) => s + c.amount, 0);
  const mixedResident = new Set(selectedCharges.map((c) => c.residentId)).size > 1;
  const selResidentName = selectedCharges[0]?.residentName ?? "";

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearSelection = () => setSelected(new Set());

  const openInvoiceModal = () => {
    if (mixedResident) {
      Swal.fire("One resident per invoice", "The selected charges belong to different residents. Select charges for a single resident.", "warning");
      return;
    }
    const d = new Date();
    d.setDate(d.getDate() + 30);
    setDueDate(d.toISOString().slice(0, 10));
    setInvoiceDesc("");
    setShowInvoice(true);
  };

  const createInvoice = async (send: boolean) => {
    if (selectedCharges.length === 0 || mixedResident) return;
    setBusy(true);
    try {
      const now = new Date();
      const invNum = `INV-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}${String(invoiceRows.length + 1).padStart(3, "0")}`;
      const res = await createRecord("invoices", {
        residentId: selectedCharges[0].residentId,
        invoiceNumber: invNum,
        totalAmount: selTotal,
        amountPaid: 0,
        dueDate: new Date(dueDate).toISOString(),
        billingPeriodStart: now.toISOString(),
        billingPeriodEnd: now.toISOString(),
        description: invoiceDesc || "Consolidated charges from the transactions ledger.",
        status: "DRAFT",
      });
      const invoiceId = res.data?.id || res.id;
      for (const c of selectedCharges) {
        await updateRecord("service-charges", c.id, { invoiceId });
      }
      let sentMsg = "";
      if (send && invoiceId) {
        const sendRes = await fetch(`/api/billing/invoices/${invoiceId}/send`, { method: "POST" });
        const body = await sendRes.json().catch(() => ({}));
        if (!sendRes.ok) throw new Error(body.error || "Invoice created but sending failed.");
        sentMsg = body.recipients > 0 ? ` and sent to ${body.recipients} recipient${body.recipients === 1 ? "" : "s"}` : " (no linked resident/family account to notify)";
      }
      await Promise.all([refetchCharges(), refetchInvoices()]);
      clearSelection();
      setShowInvoice(false);
      Swal.fire("Invoice Created", `${invNum} created${send ? sentMsg : " as a draft"}.`, "success");
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      Swal.fire("Failed", err.message || "Could not create invoice.", "error");
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter(({ c, status: st }) => {
        if (source !== "all" && c.category !== source) return false;
        if (status !== "all" && st.toLowerCase() !== status) return false;
        if (
          q &&
          !c.residentName.toLowerCase().includes(q) &&
          !c.description.toLowerCase().includes(q) &&
          !(c.invoiceNumber || "").toLowerCase().includes(q)
        )
          return false;
        return true;
      })
      .sort((a, b) => new Date(b.c.serviceDate ?? 0).getTime() - new Date(a.c.serviceDate ?? 0).getTime());
  }, [rows, source, status, search]);

  const totals = useMemo(() => {
    let total = 0,
      paid = 0,
      pending = 0,
      invoiced = 0;
    for (const { c, status: st } of filtered) {
      total += c.amount;
      if (st === "Paid") paid += c.amount;
      else if (st === "Pending") pending += c.amount;
      else invoiced += c.amount;
    }
    return { total, paid, pending, invoiced, count: filtered.length };
  }, [filtered]);

  const exportCsv = () => {
    const header = ["Date", "Resident", "Source", "Description", "Amount", "Status", "Invoice #"];
    const body = filtered.map(({ c, status: st }) => [
      c.serviceDate ? new Date(c.serviceDate).toISOString().slice(0, 10) : "",
      c.residentName,
      c.category,
      c.description,
      Math.round(c.amount),
      st,
      c.invoiceNumber || "",
    ]);
    downloadCsv(`transactions-ledger-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...body]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2 flex items-center gap-3">
            <Receipt className="w-8 h-8 text-blue-500" /> Transactions Ledger
          </h1>
          <p className="text-gray-600">Every charge across all revenue sources — care, hotel services, concierge, dining, transport.</p>
        </div>
        <button
          onClick={exportCsv}
          className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatChip label="Total Transactions" value={fmt(totals.total)} sub={`${totals.count} charges`} icon={Layers} color="blue" />
        <StatChip label="Collected (Paid)" value={fmt(totals.paid)} icon={CheckCircle} color="green" />
        <StatChip label="Invoiced (Unpaid)" value={fmt(totals.invoiced)} icon={Receipt} color="indigo" />
        <StatChip label="Pending (Unbilled)" value={fmt(totals.pending)} icon={Clock} color="amber" />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search resident, description, or invoice #…"
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
          />
        </div>
        <select value={source} onChange={(e) => setSource(e.target.value)} className="px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400">
          <option value="all">All Sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {sourceMeta(s).label}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400">
          <option value="all">All Status</option>
          <option value="paid">Paid</option>
          <option value="invoiced">Invoiced</option>
          <option value="pending">Pending</option>
        </select>
      </div>

      {/* Selection toolbar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <div className="text-sm text-blue-900">
            <span className="font-semibold">{selected.size}</span> pending charge{selected.size === 1 ? "" : "s"} · <span className="font-semibold">{fmt(selTotal)}</span>
            {mixedResident ? (
              <span className="ml-2 font-medium text-red-600">⚠ Multiple residents — pick one resident&apos;s charges</span>
            ) : (
              <span className="ml-2 text-blue-700">· {selResidentName}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={clearSelection} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">Clear</button>
            <button
              onClick={openInvoiceModal}
              disabled={mixedResident}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm font-semibold shadow hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileText className="w-4 h-4" /> Generate Invoice
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-gray-600 font-semibold">
                <th className="px-4 py-3 w-10"></th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Resident</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Invoice #</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-500">
                    <div className="inline-block w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mb-2" />
                    <p>Loading transactions…</p>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-500">No transactions match your filters.</td>
                </tr>
              ) : (
                filtered.map(({ c, status: st }) => {
                  const sm = sourceMeta(c.category);
                  return (
                    <tr key={c.id} className={`hover:bg-gray-50 transition ${selected.has(c.id) ? "bg-blue-50/60" : ""}`}>
                      <td className="px-4 py-3">
                        {st === "Pending" ? (
                          <input
                            type="checkbox"
                            checked={selected.has(c.id)}
                            onChange={() => toggleSelect(c.id)}
                            className="rounded cursor-pointer"
                            aria-label={`Select charge ${c.description}`}
                          />
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{c.serviceDate ? new Date(c.serviceDate).toLocaleDateString() : "—"}</td>
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{c.residentName}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${sm.badge}`}>{sm.label}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 max-w-xs truncate">{c.description}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">{fmt(c.amount)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE[st]}`}>{st}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{c.invoiceNumber || "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Generate Invoice modal */}
      {showInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between bg-gradient-to-r from-blue-500 to-indigo-600 p-5 text-white">
              <h2 className="flex items-center gap-2 text-xl font-bold"><FileText className="w-5 h-5" /> Generate Invoice</h2>
              <button onClick={() => setShowInvoice(false)} className="rounded-lg p-1.5 hover:bg-white/20"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4 p-6">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                <p className="text-gray-500">Resident</p>
                <p className="font-semibold text-gray-900">{selResidentName}</p>
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-gray-700">Charges ({selectedCharges.length})</p>
                <div className="max-h-40 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
                  {selectedCharges.map((c) => (
                    <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="truncate text-gray-700">{c.description}</span>
                      <span className="ml-3 whitespace-nowrap font-medium text-gray-900">{fmt(c.amount)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between px-1 text-sm font-bold">
                  <span>Total</span>
                  <span>{fmt(selTotal)}</span>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-gray-700">Due Date</label>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-gray-700">Description (optional)</label>
                <input value={invoiceDesc} onChange={(e) => setInvoiceDesc(e.target.value)} placeholder="e.g. August services" className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            </div>
            <div className="sticky bottom-0 flex items-center justify-between flex-wrap gap-2 border-t border-gray-200 bg-gray-50 px-6 py-4">
              <button onClick={() => setShowInvoice(false)} disabled={busy} className="rounded-lg px-4 py-2 text-gray-700 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
              <div className="flex items-center flex-wrap gap-2">
                <button onClick={() => createInvoice(false)} disabled={busy || !dueDate} className="rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50">Create Draft</button>
                <button onClick={() => createInvoice(true)} disabled={busy || !dueDate} className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-2 font-semibold text-white shadow hover:shadow-lg disabled:opacity-50">
                  <Send className="w-4 h-4" /> {busy ? "Working…" : "Create & Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatChip({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: "blue" | "green" | "amber" | "indigo";
}) {
  const ring: Record<string, string> = {
    blue: "text-blue-600 bg-blue-50",
    green: "text-green-600 bg-green-50",
    amber: "text-amber-600 bg-amber-50",
    indigo: "text-indigo-600 bg-indigo-50",
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${ring[color]}`}>
          <Icon className="w-4 h-4" />
        </span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}
