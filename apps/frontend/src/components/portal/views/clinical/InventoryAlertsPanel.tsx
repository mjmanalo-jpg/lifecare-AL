"use client";
import { useMemo, useState } from "react";
import { Bell, Plus, X, Trash2, Search, AlertTriangle, CheckCircle, Loader2 } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none text-sm";
const labelCls = "block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1";
const severityColors: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-700 border-red-200",
  HIGH: "bg-orange-100 text-orange-700 border-orange-200",
  MEDIUM: "bg-yellow-100 text-yellow-700 border-yellow-200",
  LOW: "bg-blue-100 text-blue-700 border-blue-200",
};

// Module 14 stock levels — Out of Stock / Critical / Low / Normal — classified
// from quantity vs the reorder-or-minimum threshold. Normal → no alert.
const STOCK_BADGE: Record<string, string> = {
  "OUT OF STOCK": "bg-red-200 text-red-800 border-red-300",
  CRITICAL: "bg-red-100 text-red-700 border-red-200",
  LOW: "bg-amber-100 text-amber-700 border-amber-200",
};
function stockLevel(qty: number, threshold: number): { label: string; severity: string; cls: string } | null {
  if (qty <= 0) return { label: "OUT OF STOCK", severity: "CRITICAL", cls: STOCK_BADGE["OUT OF STOCK"] };
  if (threshold > 0 && qty <= Math.ceil(threshold / 2)) return { label: "CRITICAL", severity: "HIGH", cls: STOCK_BADGE.CRITICAL };
  if (threshold > 0 && qty <= threshold) return { label: "LOW", severity: "MEDIUM", cls: STOCK_BADGE.LOW };
  return null; // NORMAL — within range, no alert
}

export default function InventoryAlertsPanel() {
  const { data: alertRows, loading, refetch } = useLiveQuery("inventory-alerts", { query: "take=200", tables: ["InventoryAlert"] });
  // Derive live alerts straight from the inventory items so a low/expiring item
  // shows up automatically — no manual alert record needed (Module 14).
  const invQ = useLiveQuery("inventory", { query: "take=500", tables: ["InventoryItem"] });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [creating, setCreating] = useState(false);

  const derivedAlerts = useMemo(() => {
    const now = Date.now();
    const out: any[] = [];
    for (const it of (invQ.data || []) as any[]) {
      const qty = Number(it.quantity ?? 0);
      const threshold = Number(it.reorderPoint ?? it.minimumStock ?? 0);
      const name = String(it.itemName ?? "Item");
      const loc = it.location ? ` · ${it.location}` : "";
      // Stock level per Module 14: Out of Stock / Critical / Low (Normal = no alert).
      const sl = stockLevel(qty, threshold);
      if (sl) {
        out.push({
          id: `stock-${it.id}`, itemName: name, severity: sl.severity, badge: sl.label, badgeCls: sl.cls,
          message: `${qty} ${it.unit ?? "left"}${threshold > 0 ? ` · reorder at ${threshold}` : ""}${loc}`,
          currentQuantity: qty, threshold, derived: true, createdAt: it.updatedAt ?? it.createdAt,
        });
      }
      // Expiry → Expired / Expiring Soon
      if (it.expiryDate) {
        const days = Math.floor((new Date(it.expiryDate).getTime() - now) / 86_400_000);
        if (days < 0) out.push({ id: `exp-${it.id}`, itemName: name, severity: "CRITICAL", badge: "EXPIRED", badgeCls: STOCK_BADGE["OUT OF STOCK"], message: `Expired ${-days} day(s) ago${loc}`, currentQuantity: qty, threshold, derived: true, createdAt: it.expiryDate });
        else if (days <= 30) out.push({ id: `exp-${it.id}`, itemName: name, severity: days <= 7 ? "HIGH" : "MEDIUM", badge: "EXPIRING SOON", badgeCls: STOCK_BADGE.LOW, message: `Expiring in ${days} day(s)${loc}`, currentQuantity: qty, threshold, derived: true, createdAt: it.expiryDate });
      }
    }
    return out;
  }, [invQ.data]);

  // Live derived alerts + any manual, still-unresolved alerts.
  const merged = useMemo(
    () => [...derivedAlerts, ...((alertRows || []) as any[]).filter(a => !a.resolved)],
    [derivedAlerts, alertRows],
  );

  const filtered = useMemo(() => {
    return merged.filter((a: any) => {
      if (filter !== "ALL" && a.severity !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (a.itemName || "").toLowerCase().includes(q) || (a.message || "").toLowerCase().includes(q);
      }
      return true;
    });
  }, [merged, filter, search]);

  const unresolved = merged;

  const handleResolve = async (id: string) => {
    await updateRecord("inventory-alerts", id, { resolved: true, resolvedAt: new Date().toISOString() });
    refetch();
  };

  const handleDelete = async (id: string) => {
    const r = await Swal.fire({ title: "Delete Alert?", icon: "warning", showCancelButton: true, confirmButtonColor: "#dc2626" });
    if (r.isConfirmed) { await deleteRecord("inventory-alerts", id); refetch(); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><Bell className="w-5 h-5 text-yellow-500" /> Inventory Alerts</h2>
          <p className="text-sm text-gray-500">Low stock, expiry warnings, and medication inventory alerts</p>
        </div>
        <div className="flex items-center gap-3">
          {unresolved.length > 0 && (
            <span className="px-3 py-1 rounded-full bg-red-100 text-red-700 text-sm font-semibold">{unresolved.length} active</span>
          )}
          <button onClick={() => setCreating(true)} className="px-4 py-2 rounded-lg bg-yellow-500 text-white text-sm font-semibold hover:bg-yellow-600 flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> New Alert
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search alerts..." className={`${inputCls} pl-9`} />
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value)} className={`${inputCls} w-full sm:w-auto`}>
          <option value="ALL">All Severity</option>
          {Object.keys(severityColors).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
          <Bell className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No active alerts</p>
          <p className="text-sm mt-1">All inventory levels are within normal range</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((alert: any) => (
            <div key={alert.id} className={`bg-white rounded-lg border p-4 flex items-start gap-3 ${severityColors[alert.severity] || "border-gray-200"}`}>
              <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-gray-900">{alert.itemName || "Inventory Item"}</h3>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${alert.badgeCls || severityColors[alert.severity] || "bg-gray-100 text-gray-600"}`}>{alert.badge || alert.severity}</span>
                </div>
                <p className="text-sm text-gray-600 mt-0.5">{alert.message || "Stock level alert"}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {alert.currentQuantity != null && `Current: ${alert.currentQuantity}`}
                  {alert.threshold != null && ` / Threshold: ${alert.threshold}`}
                  {alert.createdAt && ` • ${new Date(alert.createdAt).toLocaleString()}`}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {alert.derived ? (
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-1.5" title="Auto-generated from inventory — clears when restocked/updated">Auto</span>
                ) : (
                  <>
                    {!alert.resolved && (
                      <button onClick={() => handleResolve(alert.id)} className="p-1.5 text-green-500 hover:bg-green-50 rounded cursor-pointer" title="Resolve">
                        <CheckCircle className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => handleDelete(alert.id)} className="p-1.5 text-red-400 hover:text-red-500 cursor-pointer"><Trash2 className="w-4 h-4" /></button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="sticky top-0 bg-gradient-to-r from-yellow-500 to-amber-500 px-6 py-4 rounded-t-xl flex items-center justify-between">
              <h3 className="text-white font-bold text-lg">New Inventory Alert</h3>
              <button onClick={() => setCreating(false)} className="text-white/80 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <AlertForm onClose={() => setCreating(false)} onSaved={() => { refetch(); setCreating(false); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function AlertForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ itemName: "", message: "", severity: "MEDIUM", currentQuantity: "", threshold: "" });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.itemName) return;
    setSaving(true);
    try {
      await createRecord("inventory-alerts", {
        itemName: form.itemName,
        message: form.message,
        severity: form.severity,
        currentQuantity: form.currentQuantity ? parseInt(form.currentQuantity) : null,
        threshold: form.threshold ? parseInt(form.threshold) : null,
        resolved: false,
        createdAt: new Date().toISOString(),
      });
      onSaved();
      Swal.fire({ icon: "success", title: "Created!", timer: 1500, showConfirmButton: false });
    } catch { Swal.fire("Error", "Failed", "error"); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div><label className={labelCls}>Item Name *</label><input value={form.itemName} onChange={e => set("itemName", e.target.value)} className={inputCls} required placeholder="e.g., Gloves, Insulin, Bandages" /></div>
      <div><label className={labelCls}>Message</label><input value={form.message} onChange={e => set("message", e.target.value)} className={inputCls} placeholder="Alert description" /></div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div><label className={labelCls}>Severity</label><select value={form.severity} onChange={e => set("severity", e.target.value)} className={inputCls}>
          {Object.keys(severityColors).map(s => <option key={s} value={s}>{s}</option>)}
        </select></div>
        <div><label className={labelCls}>Current Qty</label><input type="number" min="0" value={form.currentQuantity} onChange={e => set("currentQuantity", e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Threshold</label><input type="number" min="0" value={form.threshold} onChange={e => set("threshold", e.target.value)} className={inputCls} /></div>
      </div>
      <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-3 -mx-6 -mb-6 rounded-b-xl flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 cursor-pointer">Cancel</button>
        <button type="submit" disabled={saving || !form.itemName} className="px-5 py-2 rounded-lg bg-yellow-500 text-white text-sm font-semibold hover:bg-yellow-600 disabled:opacity-50 cursor-pointer">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
        </button>
      </div>
    </form>
  );
}
