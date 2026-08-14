"use client";

/**
 * Medication & Supply Inventory — stock levels + purchase-request workflow.
 * Add Item has TWO parts: a Medication item (with generic/brand) and a General
 * supply item. Migration-free: items in app-setting `inventory_items`, purchase
 * requests in `inventory_purchase_requests`.
 */

import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Package, Pill, Search, Plus, RefreshCw, ShoppingCart, Pencil, X, CheckCircle2, User, Upload, Download } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { upsertRecord } from "@/lib/api";
import { exportInventoryCsv, parseInventoryCsv, inventoryHeaders, importSummaryHtml } from "@/lib/inventoryCsv";
import { useClinician, type ClinicianRole } from "./useClinician";

const ITEMS_KEY = "inventory_items";
const PR_KEY = "inventory_purchase_requests";
const newId =(p: string) => globalThis.crypto?.randomUUID?.() ?? `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const fmtDate = (v: string) => (v ? new Date(v + (v.length <= 10 ? "T00:00:00" : "")).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
const UNITS = ["tablets", "capsules", "mL", "mg", "vials", "ampoules", "patches", "sachets", "units", "boxes", "packs", "pcs"];
const URGENCIES = ["Routine", "Urgent", "Emergency"];

interface InvItem { id: string; type: "MEDICATION" | "GENERAL"; name: string; generic?: string; brand?: string; category?: string; supplier?: string; unit: string; quantity: number; reorder: number; location?: string; expiry?: string; notes?: string; residentId?: string; residentName?: string; updatedAt: string; }
type ResOpt = { id: string; name: string; room: string };
interface PR { id: string; itemId: string; itemName: string; unit: string; quantity: number; urgency: string; notes?: string; status: "PENDING" | "APPROVED" | "ORDERED" | "REJECTED"; by?: string; byAt: string; approvedBy?: string; }
const parse = <T,>(raw: string | null | undefined): T[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x) => x && typeof x.id === "string") : []; } catch { return []; } };

const stockLevel = (it: InvItem) => (it.quantity <= 0 ? "out" : it.quantity <= it.reorder ? "low" : "ok");
const daysToExpiry = (exp?: string) => (exp ? Math.ceil((new Date(exp + "T00:00:00").getTime() - Date.now()) / 86_400_000) : null);
// Numeric M/D/YYYY for the table's Expiry column.
const numDate = (v?: string) => (v ? new Date(v + (v.length <= 10 ? "T00:00:00" : "")).toLocaleDateString() : "");
// Stock-level pill for the table (dark = normal, amber = low, coral = out).
const stockMeta = (lvl: string) => (lvl === "out" ? { label: "Out of Stock", cls: "bg-[#C0573F] text-white" } : lvl === "low" ? { label: "Low", cls: "bg-[#C39A3E] text-white" } : { label: "Normal", cls: "bg-[#2E4A48] text-white" });
// Relative expiry note ("Expiring in 9 days", "6 months away", …) with a tone.
const expiryRel = (exp?: string): { text: string; cls: string } | null => {
  const d = daysToExpiry(exp);
  if (d == null) return null;
  if (d < 0) return { text: `Expired ${Math.abs(d)}d ago`, cls: "text-red-600" };
  if (d <= 30) return { text: `Expiring in ${d} day${d === 1 ? "" : "s"}`, cls: "text-amber-600" };
  const months = Math.round(d / 30);
  if (months < 12) return { text: `${months} month${months === 1 ? "" : "s"} away`, cls: "text-slate-400" };
  const years = Math.round(d / 365);
  return { text: `${years} year${years === 1 ? "" : "s"} away`, cls: "text-slate-400" };
};

export default function MedicationInventoryBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName } = useClinician(clinicianRole);
  const { data: settingRows, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const resQ = useLiveQuery<Record<string, unknown>>("residents", { tables: ["Resident"] });
  const residents = useMemo<ResOpt[]>(() => (resQ.data || []).map(adaptResident).map((r) => ({ id: String(r.id), name: String(r.name), room: String(r.room ?? "") })), [resQ.data]);
  const items = useMemo(() => parse<InvItem>(settingRows.find((r) => (r.key || r.id) === ITEMS_KEY)?.value), [settingRows]);
  const prs = useMemo(() => parse<PR>(settingRows.find((r) => (r.key || r.id) === PR_KEY)?.value), [settingRows]);

  const [tab, setTab] = useState<"inventory" | "residents" | "requests">("inventory");
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  const [expiryFilter, setExpiryFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [residentFilter, setResidentFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<InvItem | null>(null);
  const [restockItem, setRestockItem] = useState<InvItem | null>(null);
  const [requestItem, setRequestItem] = useState<InvItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const saveItems = async (next: InvItem[]) => { await upsertRecord("app-settings", ITEMS_KEY, { key: ITEMS_KEY, value: JSON.stringify(next) }); await refetch(); };
  const savePRs = async (next: PR[]) => { await upsertRecord("app-settings", PR_KEY, { key: PR_KEY, value: JSON.stringify(next) }); await refetch(); };

  const upsertItem = async (it: InvItem) => { const rest = items.filter((x) => x.id !== it.id); await saveItems([{ ...it, updatedAt: new Date().toISOString() }, ...rest]); setAddOpen(false); setEditItem(null); };
  const restock = async (it: InvItem, add: number) => { await saveItems(items.map((x) => (x.id === it.id ? { ...x, quantity: x.quantity + add, updatedAt: new Date().toISOString() } : x))); setRestockItem(null); Swal.fire({ toast: true, position: "top-end", icon: "success", title: `Restocked +${add}`, showConfirmButton: false, timer: 1400 }); };
  const submitPR = async (it: InvItem, quantity: number, urgency: string, notes: string) => { const rec: PR = { id: newId("pr"), itemId: it.id, itemName: it.name, unit: it.unit, quantity, urgency, notes: notes || undefined, status: "PENDING", by: clinicianName, byAt: new Date().toISOString() }; await savePRs([rec, ...prs]); setRequestItem(null); Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Purchase request submitted", showConfirmButton: false, timer: 1600 }); };
  const setPRStatus = async (pr: PR, status: PR["status"]) => savePRs(prs.map((x) => (x.id === pr.id ? { ...x, status, approvedBy: status === "APPROVED" ? clinicianName : x.approvedBy } : x)));

  const exportCsv = () => exportInventoryCsv("MED", items, "medication-inventory.csv");
  const importCsv = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    const text = await file.text();
    const result = parseInventoryCsv({ variant: "MED", text, existing: items, residents: residents.map((r) => ({ id: r.id, name: r.name })), newId: () => newId("inv") });
    if (result.formatError) {
      Swal.fire({ icon: "error", title: "Invalid CSV format", html: `${result.formatError}<br/><br/><b>Expected columns:</b><br/><code style="font-size:.8rem">${inventoryHeaders("MED").join(", ")}</code>` });
      return;
    }
    if (!result.added.length) { Swal.fire({ icon: "warning", title: "Nothing to import", html: importSummaryHtml(result) }); return; }
    const confirm = await Swal.fire({ icon: "question", title: "Import inventory?", html: importSummaryHtml(result), showCancelButton: true, confirmButtonText: `Import ${result.added.length} item(s)` });
    if (!confirm.isConfirmed) return;
    const next = [...result.added, ...items] as InvItem[];
    try { await saveItems(next); Swal.fire({ toast: true, position: "top-end", icon: "success", title: `Imported ${result.added.length} item(s)`, showConfirmButton: false, timer: 2200 }); }
    catch { Swal.fire({ toast: true, position: "top-end", icon: "error", title: "Import failed — please retry", showConfirmButton: false, timer: 2600 }); }
  };

  const categoryOpts = useMemo(() => Array.from(new Set(items.map((i) => (i.category || "").trim()).filter(Boolean))).sort(), [items]);
  const locationOpts = useMemo(() => Array.from(new Set(items.map((i) => (i.location || "").trim()).filter(Boolean))).sort(), [items]);

  const q = search.trim().toLowerCase();
  const filtered = items.filter((it) => {
    const okQ = !q || [it.name, it.generic, it.brand, it.category, it.supplier, it.location].some((f) => (f || "").toLowerCase().includes(q));
    const okCat = !categoryFilter || it.category === categoryFilter;
    const okLoc = !locationFilter || it.location === locationFilter;
    const okS = !stockFilter || stockLevel(it) === stockFilter;
    const dte = daysToExpiry(it.expiry);
    const okE = !expiryFilter || (expiryFilter === "expired" ? dte != null && dte < 0 : expiryFilter === "soon" ? dte != null && dte >= 0 && dte <= 90 : true);
    return okQ && okCat && okLoc && okS && okE;
  });
  const stats = { total: items.length, critical: items.filter((it) => stockLevel(it) === "out").length, low: items.filter((it) => stockLevel(it) === "low").length, pendingPR: prs.filter((p) => p.status === "PENDING").length };

  return (
    <div className="min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div><h1 className="text-2xl sm:text-3xl font-bold text-slate-900 flex items-center gap-2"><Package className="w-6 h-6 text-blue-500" /> Medication Inventory</h1><p className="text-sm text-slate-500 mt-1">Track stock levels and manage purchase requests</p></div>
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={importCsv} className="hidden" />
          <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"><Upload className="w-4 h-4" /> Import CSV</button>
          <button onClick={exportCsv} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download className="w-4 h-4" /> Export CSV</button>
          <button onClick={() => { setEditItem(null); setAddOpen(true); }} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"><Plus className="w-4 h-4" /> Add Item</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <InvStat value={stats.total} label="Total Items" tone="#334155" />
        <InvStat value={stats.critical} label="Critical / Out of Stock" tone="#dc2626" />
        <InvStat value={stats.low} label="Low Stock" tone="#d97706" />
        <InvStat value={stats.pendingPR} label="Pending Purchase Requests" tone="#2563eb" />
      </div>

      <div className="inline-flex gap-1 bg-slate-100 rounded-xl p-1 mb-5">
        {([["inventory", "Inventory"], ["residents", "Resident Inventory"], ["requests", "Purchase Requests"]] as const).map(([v, label]) => <button key={v} onClick={() => setTab(v)} className={`px-3.5 py-1.5 rounded-lg text-sm font-medium ${tab === v ? "bg-white shadow-sm text-slate-800" : "text-slate-500"}`}>{label}{v === "inventory" ? ` ${items.length}` : v === "residents" ? ` ${items.filter((it) => it.residentId).length}` : prs.filter((p) => p.status === "PENDING").length ? ` ${prs.filter((p) => p.status === "PENDING").length}` : ""}</button>)}
      </div>

      {tab === "inventory" && (<>
        <div className="flex flex-col lg:flex-row gap-3 mb-5">
          <div className="relative flex-1"><Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, category, location, supplier…" className="w-full pl-11 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40" /></div>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm"><option value="">All Categories</option>{categoryOpts.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm"><option value="">All Locations</option>{locationOpts.map((l) => <option key={l} value={l}>{l}</option>)}</select>
          <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm"><option value="">All Stock Levels</option><option value="out">Out of Stock</option><option value="low">Low Stock</option><option value="ok">In Stock</option></select>
          <select value={expiryFilter} onChange={(e) => setExpiryFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm"><option value="">Any Expiry</option><option value="soon">Expiring ≤ 90 days</option><option value="expired">Expired</option></select>
        </div>
        <InventoryTable items={filtered} onRestock={setRestockItem} onRequest={setRequestItem} onEdit={(x) => { setEditItem(x); setAddOpen(true); }} empty={<>No inventory items. Click <b>Add Item</b> to start.</>} />
      </>)}

      {tab === "residents" && (() => {
        const resItems = items.filter((it) => it.residentId && (!residentFilter || it.residentId === residentFilter));
        return (<>
          <div className="flex flex-col sm:flex-row gap-3 mb-5">
            <div className="relative flex-1 max-w-md">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <select value={residentFilter} onChange={(e) => setResidentFilter(e.target.value)} className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40">
                <option value="">All residents</option>
                {residents.map((r) => <option key={r.id} value={r.id}>{r.name}{r.room ? ` — Rm ${r.room}` : ""}</option>)}
              </select>
            </div>
          </div>
          <InventoryTable items={resItems} onRestock={setRestockItem} onRequest={setRequestItem} onEdit={(x) => { setEditItem(x); setAddOpen(true); }} empty={residentFilter ? "No inventory assigned to this resident yet." : "No resident-assigned inventory yet. Pick a resident when adding an item."} />
        </>);
      })()}

      {tab === "requests" && (
        <div className="space-y-3">
          {prs.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-400">No purchase requests.</div>
            : prs.map((pr) => (
              <div key={pr.id} className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap"><p className="font-bold text-slate-900">{pr.itemName}</p><span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{pr.urgency}</span><span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${pr.status === "APPROVED" ? "bg-green-100 text-green-700" : pr.status === "ORDERED" ? "bg-slate-200 text-slate-600" : pr.status === "REJECTED" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{pr.status === "APPROVED" && <CheckCircle2 className="w-3 h-3" />}{pr.status[0] + pr.status.slice(1).toLowerCase()}</span></div>
                  <p className="text-sm text-slate-600 mt-1">Requested: <b>{pr.quantity} {pr.unit}</b></p>
                  {pr.notes && <p className="text-sm italic text-slate-500 mt-0.5">&ldquo;{pr.notes}&rdquo;</p>}
                  <p className="text-xs text-slate-400 mt-1">By {pr.by || "—"} · {fmtDate(pr.byAt.slice(0, 10))}{pr.approvedBy ? ` · Approved by ${pr.approvedBy}` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  {pr.status === "PENDING" && <><button onClick={() => setPRStatus(pr, "APPROVED")} className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700">Approve</button><button onClick={() => setPRStatus(pr, "REJECTED")} className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Reject</button></>}
                  {pr.status === "APPROVED" && <button onClick={() => setPRStatus(pr, "ORDERED")} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50">Mark Ordered</button>}
                </div>
              </div>
            ))}
        </div>
      )}

      {addOpen && <AddItemModal item={editItem} residents={residents} onClose={() => { setAddOpen(false); setEditItem(null); }} onSave={upsertItem} />}
      {restockItem && <RestockModal item={restockItem} onClose={() => setRestockItem(null)} onRestock={restock} />}
      {requestItem && <RequestModal item={requestItem} onClose={() => setRequestItem(null)} onSubmit={submitPR} />}
    </div>
  );
}

function InvStat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-3xl font-bold" style={{ color: tone }}>{value}</p><p className="text-sm text-slate-500 mt-1">{label}</p></div>;
}

// Shared dark-teal table used by both the Inventory and Resident Inventory tabs.
function InventoryTable({ items, onRestock, onRequest, onEdit, empty }: { items: InvItem[]; onRestock: (it: InvItem) => void; onRequest: (it: InvItem) => void; onEdit: (it: InvItem) => void; empty: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="text-left text-white" style={{ backgroundColor: "#2E4A48" }}>
              <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-wider">Item</th>
              <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-wider">Current Qty</th>
              <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-wider">Stock Level</th>
              <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-wider">Expiry</th>
              <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-wider">Location</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-400">{empty}</td></tr>
            ) : items.map((it) => <InvTableRow key={it.id} it={it} onRestock={onRestock} onRequest={onRequest} onEdit={onEdit} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Table row for the redesigned Inventory tab — item + qty + stock badge
// (with min) + relative expiry + location, with edit/request actions.
function InvTableRow({ it, onRestock, onRequest, onEdit }: { it: InvItem; onRestock: (it: InvItem) => void; onRequest: (it: InvItem) => void; onEdit: (it: InvItem) => void }) {
  const lvl = stockLevel(it); const sm = stockMeta(lvl); const rel = expiryRel(it.expiry);
  const subtitle = [it.category, it.supplier].filter(Boolean).join(" · ");
  return (
    <tr className="hover:bg-slate-50/60 transition">
      <td className="px-6 py-3.5 align-middle">
        <p className="font-bold text-slate-900 flex items-center gap-2">{it.name}{it.residentName && <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700"><User className="w-3 h-3" />{it.residentName}</span>}</p>
        {subtitle ? <p className="text-xs mt-0.5" style={{ color: "#9a7b52" }}>{subtitle}</p> : it.generic ? <p className="text-xs mt-0.5 text-slate-400">{it.generic}</p> : null}
      </td>
      <td className="px-6 py-3.5 align-middle">
        <p className="text-lg font-bold leading-none tabular-nums" style={{ color: lvl === "out" ? "#C0573F" : "#1e293b" }}>{it.quantity}</p>
        <p className="text-[11px] text-slate-400 mt-0.5">{it.unit}</p>
      </td>
      <td className="px-6 py-3.5 align-middle">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-[0.04em] ${sm.cls}`}>{sm.label}</span>
        <p className="text-[11px] text-slate-400 mt-1">Min {it.reorder}</p>
      </td>
      <td className="px-6 py-3.5 align-middle">
        {it.expiry ? <><p className="text-sm text-slate-700 tabular-nums">{numDate(it.expiry)}</p>{rel && <p className={`text-[11px] mt-0.5 ${rel.cls}`}>{rel.text}</p>}</> : <span className="text-slate-300">—</span>}
      </td>
      <td className="px-6 py-3.5 align-middle text-sm text-slate-700">{it.location || <span className="text-slate-300">—</span>}</td>
      <td className="px-4 py-3.5 align-middle text-right whitespace-nowrap">
        <button onClick={() => onRestock(it)} title="Restock" className="p-1.5 rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-[#2E4A48]"><RefreshCw className="w-4 h-4" /></button>
        <button onClick={() => onRequest(it)} title="Request purchase" className="p-1.5 rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-blue-600"><ShoppingCart className="w-4 h-4" /></button>
        <button onClick={() => onEdit(it)} title="Edit" className="p-1.5 rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><Pencil className="w-4 h-4" /></button>
      </td>
    </tr>
  );
}

const inp = "w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40";
const lbl = "block text-sm font-bold text-slate-700 mb-1.5";

function AddItemModal({ item, residents, onClose, onSave }: { item: InvItem | null; residents: ResOpt[]; onClose: () => void; onSave: (it: InvItem) => Promise<void> }) {
  const [type, setType] = useState<"MEDICATION" | "GENERAL">(item?.type || "MEDICATION");
  const [name, setName] = useState(item?.name || "");
  const [generic, setGeneric] = useState(item?.generic || "");
  const [brand, setBrand] = useState(item?.brand || "");
  const [category, setCategory] = useState(item?.category || "");
  const [supplier, setSupplier] = useState(item?.supplier || "");
  const [unit, setUnit] = useState(item?.unit || "tablets");
  const [quantity, setQuantity] = useState(item ? String(item.quantity) : "0");
  const [reorder, setReorder] = useState(item ? String(item.reorder) : "10");
  const [location, setLocation] = useState(item?.location || "");
  const [expiry, setExpiry] = useState(item?.expiry || "");
  const [notes, setNotes] = useState(item?.notes || "");
  const [residentId, setResidentId] = useState(item?.residentId || "");
  const [saving, setSaving] = useState(false);
  const isMed = type === "MEDICATION";

  const submit = async () => {
    if (!name.trim()) { Swal.fire({ title: `${isMed ? "Medication" : "Item"} name is required`, icon: "warning" }); return; }
    setSaving(true);
    const residentName = residents.find((r) => r.id === residentId)?.name;
    try { await onSave({ id: item?.id || newId("inv"), type, name: name.trim(), generic: isMed ? generic.trim() || undefined : undefined, brand: isMed ? brand.trim() || undefined : undefined, category: category.trim() || undefined, supplier: supplier.trim() || undefined, unit, quantity: Number(quantity) || 0, reorder: Number(reorder) || 0, location: location.trim() || undefined, expiry: expiry || undefined, notes: notes.trim() || undefined, residentId: residentId || undefined, residentName: residentId ? residentName : undefined, updatedAt: new Date().toISOString() }); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[95vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100"><h2 className="font-bold text-slate-900 text-lg">{item ? "Edit" : "Add"} Inventory Item</h2><button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button></div>
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* Two parts: Medication vs General */}
          <div className="grid grid-cols-2 gap-2">
            {(["MEDICATION", "GENERAL"] as const).map((t) => <button key={t} type="button" onClick={() => setType(t)} className={`inline-flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold ${type === t ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"}`}>{t === "MEDICATION" ? <Pill className="w-4 h-4" /> : <Package className="w-4 h-4" />}{t === "MEDICATION" ? "Medication" : "General Supply"}</button>)}
          </div>
          <div><label className={lbl}>Assign to Resident <span className="text-slate-400 font-normal">(optional)</span></label><select value={residentId} onChange={(e) => setResidentId(e.target.value)} className={inp}><option value="">Facility stock (no resident)</option>{residents.map((r) => <option key={r.id} value={r.id}>{r.name}{r.room ? ` — Rm ${r.room}` : ""}</option>)}</select></div>
          <div><label className={lbl}>{isMed ? "Medication Name" : "Item Name"} <span className="text-red-500">*</span></label><input value={name} onChange={(e) => setName(e.target.value)} placeholder={isMed ? "e.g., Amlodipine 5mg" : "e.g., Surgical gloves"} className={inp} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Category</label><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g., Medical Supplies" className={inp} /></div>
            <div><label className={lbl}>Supplier</label><input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g., MedSupply Co." className={inp} /></div>
          </div>
          {isMed && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Generic Name</label><input value={generic} onChange={(e) => setGeneric(e.target.value)} placeholder="e.g., Amlodipine besylate" className={inp} /></div>
              <div><label className={lbl}>Brand Name</label><input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g., Norvasc" className={inp} /></div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Unit <span className="text-red-500">*</span></label><select value={unit} onChange={(e) => setUnit(e.target.value)} className={inp}>{UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
            <div><label className={lbl}>Current Quantity</label><input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inp} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Reorder Threshold</label><input inputMode="numeric" value={reorder} onChange={(e) => setReorder(e.target.value)} className={inp} /></div>
            <div><label className={lbl}>Location / Cabinet</label><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g., Nurse Station A" className={inp} /></div>
          </div>
          <div><label className={lbl}>Expiry Date</label><input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={inp} /></div>
          <div><label className={lbl}>Notes</label><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inp} /></div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100"><button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button><button onClick={submit} disabled={saving} className="px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{saving ? "Saving…" : item ? "Save Changes" : "Add Item"}</button></div>
      </div>
    </div>
  );
}

function RestockModal({ item, onClose, onRestock }: { item: InvItem; onClose: () => void; onRestock: (it: InvItem, add: number) => Promise<void> }) {
  const [add, setAdd] = useState("");
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
        <div className="flex items-center justify-between mb-3"><h2 className="font-bold text-slate-900">Restock — {item.name}</h2><button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button></div>
        <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-sm text-amber-800 mb-3">Current: {item.quantity} {item.unit}</div>
        <label className={lbl}>Add Quantity ({item.unit})</label>
        <input inputMode="numeric" value={add} onChange={(e) => setAdd(e.target.value)} placeholder="e.g., 100" className={inp} />
        <div className="flex justify-end gap-2 mt-4"><button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button><button onClick={() => Number(add) > 0 && onRestock(item, Number(add))} className="px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">Restock</button></div>
      </div>
    </div>
  );
}

function RequestModal({ item, onClose, onSubmit }: { item: InvItem; onClose: () => void; onSubmit: (it: InvItem, quantity: number, urgency: string, notes: string) => Promise<void> }) {
  const [quantity, setQuantity] = useState("");
  const [urgency, setUrgency] = useState("Routine");
  const [notes, setNotes] = useState("");
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
        <div className="flex items-center justify-between mb-3"><h2 className="font-bold text-slate-900">Purchase Request — {item.name}</h2><button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button></div>
        <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 mb-3"><p className="text-xs font-bold text-amber-800">Current Stock</p><p className="text-sm text-amber-700">{item.quantity} {item.unit} (reorder at {item.reorder})</p></div>
        <label className={lbl}>Quantity to Order ({item.unit})</label>
        <input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g., 100" className={inp} />
        <label className={`${lbl} mt-3`}>Urgency</label>
        <select value={urgency} onChange={(e) => setUrgency(e.target.value)} className={inp}>{URGENCIES.map((u) => <option key={u} value={u}>{u}</option>)}</select>
        <label className={`${lbl} mt-3`}>Notes</label>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inp} />
        <div className="flex justify-end gap-2 mt-4"><button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button><button onClick={() => Number(quantity) > 0 && onSubmit(item, Number(quantity), urgency, notes)} className="px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">Submit Request</button></div>
      </div>
    </div>
  );
}
