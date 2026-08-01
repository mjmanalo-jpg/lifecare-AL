"use client";

import { useEffect, useMemo, useState } from "react";
import { ShoppingCart, Plus, Download, Search, X, Check, Truck, PackageCheck, Ban } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord } from "@/lib/api";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const money = (v: number) => `$${Math.round(v).toLocaleString()}`;

const STATUS_BADGE: Record<string, string> = {
  REQUESTED: "bg-amber-100 text-amber-700 border-amber-200",
  APPROVED: "bg-blue-100 text-blue-700 border-blue-200",
  ORDERED: "bg-indigo-100 text-indigo-700 border-indigo-200",
  RECEIVED: "bg-green-100 text-green-700 border-green-200",
  REJECTED: "bg-red-100 text-red-700 border-red-200",
  CANCELLED: "bg-gray-100 text-gray-500 border-gray-200",
};
const PRIORITY_BADGE: Record<string, string> = {
  URGENT: "bg-red-100 text-red-700 border-red-200",
  HIGH: "bg-orange-100 text-orange-700 border-orange-200",
  NORMAL: "bg-blue-100 text-blue-700 border-blue-200",
  LOW: "bg-gray-100 text-gray-600 border-gray-200",
};

/**
 * Purchase Requests — restock/procurement workflow: request → approve → order →
 * receive (bumps inventory on hand). Closes the loop from low-stock/reorder
 * signals through approval and receiving.
 */
export default function PurchaseRequests() {
  const { data: rows, loading, refetch } = useLiveQuery<Row>("purchase-requests", { query: "take=400", tables: ["PurchaseRequest"] });
  const { data: invRows, refetch: refetchInv } = useLiveQuery<Row>("inventory", { query: "take=500", tables: ["InventoryItem"] });

  const [session, setSession] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
  useEffect(() => {
    fetch("/api/auth/session").then((r) => r.json()).then((d) => {
      if (d?.authenticated) setSession({ id: d.session?.userId ?? null, name: d.session?.name ?? d.session?.role ?? null });
    }).catch(() => {});
  }, []);

  const invById = useMemo(() => {
    const m = new Map<string, Row>();
    invRows.forEach((i) => m.set(s(i.id), i));
    return m;
  }, [invRows]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ inventoryItemId: "", itemName: "", category: "", quantity: "", unit: "", estimatedUnitCost: "", supplier: "", reason: "", priority: "NORMAL" });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && s(r.status) !== statusFilter) return false;
      if (q && !s(r.itemName).toLowerCase().includes(q) && !s(r.supplier).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const stats = useMemo(() => {
    const open = rows.filter((r) => ["REQUESTED", "APPROVED", "ORDERED"].includes(s(r.status)));
    return {
      pending: rows.filter((r) => s(r.status) === "REQUESTED").length,
      openOrders: rows.filter((r) => ["APPROVED", "ORDERED"].includes(s(r.status))).length,
      received: rows.filter((r) => s(r.status) === "RECEIVED").length,
      openSpend: open.reduce((sum, r) => sum + n(r.quantity) * n(r.estimatedUnitCost), 0),
    };
  }, [rows]);

  const onPickItem = (id: string) => {
    const it = invById.get(id);
    setForm((f) => ({
      ...f,
      inventoryItemId: id,
      itemName: it ? s(it.itemName) : f.itemName,
      category: it ? s(it.category) : f.category,
      unit: it ? s(it.unit) : f.unit,
      supplier: it ? s(it.supplier) : f.supplier,
      estimatedUnitCost: it && it.unitCost != null ? s(it.unitCost) : f.estimatedUnitCost,
    }));
  };

  const submit = async () => {
    if (!form.itemName.trim() || !form.quantity) {
      Swal.fire("Missing fields", "Item name and quantity are required.", "warning");
      return;
    }
    setBusy(true);
    try {
      await createRecord("purchase-requests", {
        inventoryItemId: form.inventoryItemId || null,
        itemName: form.itemName.trim(),
        category: form.category || null,
        quantity: Number(form.quantity),
        unit: form.unit || null,
        estimatedUnitCost: form.estimatedUnitCost ? Number(form.estimatedUnitCost) : null,
        supplier: form.supplier || null,
        reason: form.reason || null,
        priority: form.priority,
        status: "REQUESTED",
        requestedById: session.id,
        requestedByName: session.name,
      });
      await refetch();
      setShowCreate(false);
      setForm({ inventoryItemId: "", itemName: "", category: "", quantity: "", unit: "", estimatedUnitCost: "", supplier: "", reason: "", priority: "NORMAL" });
      Swal.fire("Request created", "Purchase request submitted for approval.", "success");
    } catch (e) {
      Swal.fire("Failed", e instanceof Error ? e.message : "Could not create request.", "error");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (r: Row, patch: Row, confirm?: { title: string; text: string }) => {
    if (confirm) {
      const res = await Swal.fire({ title: confirm.title, text: confirm.text, icon: "question", showCancelButton: true, confirmButtonColor: "#3b82f6" });
      if (!res.isConfirmed) return;
    }
    try {
      await updateRecord("purchase-requests", s(r.id), patch);
      await refetch();
    } catch (e) {
      Swal.fire("Failed", e instanceof Error ? e.message : "Could not update request.", "error");
    }
  };

  const approve = (r: Row) => setStatus(r, { status: "APPROVED", approvedById: session.id, approvedByName: session.name, approvedAt: new Date().toISOString() }, { title: "Approve request?", text: `Approve purchase of ${n(r.quantity)} ${s(r.itemName)}?` });
  const reject = (r: Row) => setStatus(r, { status: "REJECTED" }, { title: "Reject request?", text: `Reject the request for ${s(r.itemName)}?` });
  const order = (r: Row) => setStatus(r, { status: "ORDERED", orderedAt: new Date().toISOString() }, { title: "Mark as ordered?", text: `Confirm ${s(r.itemName)} has been ordered from ${s(r.supplier) || "the supplier"}.` });
  const cancel = (r: Row) => setStatus(r, { status: "CANCELLED" }, { title: "Cancel request?", text: `Cancel the request for ${s(r.itemName)}?` });

  const receive = async (r: Row) => {
    const qty = n(r.quantity);
    const res = await Swal.fire({ title: "Mark as received?", text: `Receive ${qty} ${s(r.itemName)} and add to inventory on hand?`, icon: "question", showCancelButton: true, confirmButtonColor: "#22c55e" });
    if (!res.isConfirmed) return;
    try {
      await updateRecord("purchase-requests", s(r.id), { status: "RECEIVED", receivedAt: new Date().toISOString(), receivedQuantity: qty });
      // Bump the linked inventory item's stock on hand.
      const itemId = s(r.inventoryItemId);
      if (itemId && invById.has(itemId)) {
        const current = n(invById.get(itemId)!.quantity);
        await updateRecord("inventory", itemId, { quantity: current + qty, lastRestocked: new Date().toISOString() });
        await refetchInv();
      }
      await refetch();
      Swal.fire("Received", itemId ? "Stock on hand updated." : "Marked received.", "success");
    } catch (e) {
      Swal.fire("Failed", e instanceof Error ? e.message : "Could not receive.", "error");
    }
  };

  const exportCsv = () => {
    const header = ["Item", "Category", "Qty", "Unit", "Est. Unit Cost", "Est. Total", "Supplier", "Priority", "Status", "Requested By", "Reason"];
    const esc = (v: unknown) => `"${s(v).replace(/"/g, '""')}"`;
    const lines = [header.join(",")];
    filtered.forEach((r) => lines.push([esc(r.itemName), esc(r.category), n(r.quantity), esc(r.unit), n(r.estimatedUnitCost), n(r.quantity) * n(r.estimatedUnitCost), esc(r.supplier), esc(r.priority), esc(r.status), esc(r.requestedByName), esc(r.reason)].join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `purchase-requests-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2 flex items-center gap-3">
            <ShoppingCart className="w-8 h-8 text-blue-500" /> Purchase Requests
          </h1>
          <p className="text-gray-600">Restock &amp; procurement — request → approve → order → receive.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50"><Download className="w-4 h-4" /> CSV</button>
          <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm font-semibold shadow hover:shadow-lg"><Plus className="w-4 h-4" /> New Request</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Pending Approval" value={String(stats.pending)} tint="text-amber-600 bg-amber-50" />
        <Stat label="Open Orders" value={String(stats.openOrders)} tint="text-indigo-600 bg-indigo-50" />
        <Stat label="Received" value={String(stats.received)} tint="text-green-600 bg-green-50" />
        <Stat label="Open Spend (est.)" value={money(stats.openSpend)} tint="text-blue-600 bg-blue-50" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item or supplier…" className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400">
          <option value="all">All Status</option>
          {["REQUESTED", "APPROVED", "ORDERED", "RECEIVED", "REJECTED", "CANCELLED"].map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-gray-600 font-semibold">
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Est. Total</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">No purchase requests yet.</td></tr>
              ) : filtered.map((r) => {
                const st = s(r.status);
                return (
                  <tr key={s(r.id)} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{s(r.itemName)}</p>
                      <p className="text-xs text-gray-500">{s(r.category) || "—"}{r.requestedByName ? ` · by ${s(r.requestedByName)}` : ""}</p>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{n(r.quantity)} {s(r.unit)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{r.estimatedUnitCost != null ? money(n(r.quantity) * n(r.estimatedUnitCost)) : "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{s(r.supplier) || "—"}</td>
                    <td className="px-4 py-3"><span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${PRIORITY_BADGE[s(r.priority)] ?? PRIORITY_BADGE.NORMAL}`}>{s(r.priority)}</span></td>
                    <td className="px-4 py-3"><span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE[st]}`}>{st}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {st === "REQUESTED" && (<>
                          <button onClick={() => approve(r)} title="Approve" className="p-1.5 rounded text-green-600 hover:bg-green-50"><Check className="w-4 h-4" /></button>
                          <button onClick={() => reject(r)} title="Reject" className="p-1.5 rounded text-red-600 hover:bg-red-50"><Ban className="w-4 h-4" /></button>
                        </>)}
                        {st === "APPROVED" && <button onClick={() => order(r)} title="Mark ordered" className="p-1.5 rounded text-indigo-600 hover:bg-indigo-50"><Truck className="w-4 h-4" /></button>}
                        {st === "ORDERED" && <button onClick={() => receive(r)} title="Mark received" className="p-1.5 rounded text-green-600 hover:bg-green-50"><PackageCheck className="w-4 h-4" /></button>}
                        {["REQUESTED", "APPROVED", "ORDERED"].includes(st) && <button onClick={() => cancel(r)} title="Cancel" className="p-1.5 rounded text-gray-500 hover:bg-gray-100"><X className="w-4 h-4" /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between bg-gradient-to-r from-blue-500 to-indigo-600 p-5 text-white">
              <h2 className="flex items-center gap-2 text-xl font-bold"><ShoppingCart className="w-5 h-5" /> New Purchase Request</h2>
              <button onClick={() => setShowCreate(false)} className="rounded-lg p-1.5 hover:bg-white/20"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-700">Link inventory item (optional)</label>
                <select value={form.inventoryItemId} onChange={(e) => onPickItem(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">— New / unlisted item —</option>
                  {invRows.map((i) => <option key={s(i.id)} value={s(i.id)}>{s(i.itemName)} ({n(i.quantity)} on hand)</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className="mb-1 block text-sm font-semibold text-gray-700">Item name <span className="text-red-500">*</span></label><input value={form.itemName} onChange={(e) => setForm({ ...form, itemName: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" /></div>
                <div><label className="mb-1 block text-sm font-semibold text-gray-700">Quantity <span className="text-red-500">*</span></label><input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" /></div>
                <div><label className="mb-1 block text-sm font-semibold text-gray-700">Unit</label><input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="pcs / box" className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" /></div>
                <div><label className="mb-1 block text-sm font-semibold text-gray-700">Est. unit cost</label><input type="number" min={0} value={form.estimatedUnitCost} onChange={(e) => setForm({ ...form, estimatedUnitCost: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" /></div>
                <div><label className="mb-1 block text-sm font-semibold text-gray-700">Priority</label><select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-blue-400">{["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
                <div className="col-span-2"><label className="mb-1 block text-sm font-semibold text-gray-700">Supplier</label><input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" /></div>
                <div className="col-span-2"><label className="mb-1 block text-sm font-semibold text-gray-700">Reason</label><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. below reorder point" className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" /></div>
              </div>
              {form.quantity && form.estimatedUnitCost && (
                <p className="text-sm text-gray-600">Estimated total: <span className="font-semibold text-gray-900">{money(Number(form.quantity) * Number(form.estimatedUnitCost))}</span></p>
              )}
            </div>
            <div className="sticky bottom-0 flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-4">
              <button onClick={() => setShowCreate(false)} disabled={busy} className="rounded-lg px-4 py-2 text-gray-700 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
              <button onClick={submit} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-6 py-2 font-semibold text-white shadow hover:shadow-lg disabled:opacity-50"><Plus className="w-4 h-4" /> {busy ? "Submitting…" : "Submit Request"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${tint}`}><ShoppingCart className="w-4 h-4" /></span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
