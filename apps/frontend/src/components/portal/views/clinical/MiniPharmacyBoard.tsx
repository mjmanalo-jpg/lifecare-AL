"use client";

/**
 * Mini Pharmacy — a SECONDARY (facility-owned) medication inventory that staff
 * draw from when a resident's own stock is out, or in an emergency. Every
 * dispense is CHARGEABLE: it decrements mini-pharmacy stock and posts a
 * ServiceCharge to the resident (qty × unit selling price), which flows into the
 * resident's next invoice through the existing billing pipeline.
 *
 * Migration-free: items in app-setting `mini_pharmacy_items`, purchase requests
 * in `mini_pharmacy_requests`, and a dispense/charge audit log in
 * `mini_pharmacy_dispenses`. Item shape mirrors `inventory_items` plus a
 * required `unitPrice` (selling price per unit, PHP).
 */

import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Cross, Pill, Package, Search, Plus, RefreshCw, ShoppingCart, Pencil, X, CheckCircle2, HandCoins, User, Users, Upload, Download } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { upsertRecord, createRecord } from "@/lib/api";
import { exportInventoryCsv, parseInventoryCsv, inventoryHeaders, importSummaryHtml } from "@/lib/inventoryCsv";
import { mirrorFacilityInventory } from "@/lib/inventoryMirror";
import { useClinician, type ClinicianRole } from "./useClinician";

const ITEMS_KEY = "mini_pharmacy_items";
const PR_KEY = "mini_pharmacy_requests";
const LOG_KEY = "mini_pharmacy_dispenses";
const CHARGE_CATEGORY = "Medical";
const newId = (p: string) => globalThis.crypto?.randomUUID?.() ?? `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const fmtDate = (v: string) => (v ? new Date(v + (v.length <= 10 ? "T00:00:00" : "")).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
const numDate = (v?: string) => (v ? new Date(v + (v.length <= 10 ? "T00:00:00" : "")).toLocaleDateString() : "");
const peso = (n: number) => `₱${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const UNITS = ["tablets", "capsules", "mL", "mg", "vials", "ampoules", "patches", "sachets", "units", "boxes", "packs", "pcs"];
const URGENCIES = ["Routine", "Urgent", "Emergency"];

interface InvItem { id: string; type: "MEDICATION" | "GENERAL"; name: string; generic?: string; brand?: string; category?: string; supplier?: string; unit: string; quantity: number; reorder: number; unitPrice: number; location?: string; expiry?: string; notes?: string; updatedAt: string; }
type ResOpt = { id: string; name: string; room: string; sponsorId: string; sponsorName: string };
interface PR { id: string; itemId: string; itemName: string; unit: string; quantity: number; urgency: string; notes?: string; status: "PENDING" | "APPROVED" | "ORDERED" | "REJECTED"; by?: string; byAt: string; approvedBy?: string; }
interface DispenseLog { id: string; itemId: string; itemName: string; unit: string; qty: number; unitPrice: number; amount: number; residentId: string; residentName: string; sponsorId?: string; sponsorName?: string; emergency: boolean; reason?: string; by?: string; at: string; }
const parse = <T,>(raw: string | null | undefined): T[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x) => x && typeof x.id === "string") : []; } catch { return []; } };

const stockLevel = (it: InvItem) => (it.quantity <= 0 ? "out" : it.quantity <= it.reorder ? "low" : "ok");
const daysToExpiry = (exp?: string) => (exp ? Math.ceil((new Date(exp + "T00:00:00").getTime() - Date.now()) / 86_400_000) : null);
const stockMeta = (lvl: string) => (lvl === "out" ? { label: "Out of Stock", cls: "bg-[#C0573F] text-white" } : lvl === "low" ? { label: "Low", cls: "bg-[#C39A3E] text-white" } : { label: "Normal", cls: "bg-[#2E4A48] text-white" });
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

export default function MiniPharmacyBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName } = useClinician(clinicianRole);
  const { data: settingRows, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  // include=sponsor so each resident carries their family sponsor (the payer who
  // sees/pays this resident's charges in the Family portal, scoped by sponsorId).
  const resQ = useLiveQuery<Record<string, unknown>>("residents", { query: "include=sponsor", tables: ["Resident", "User"] });
  const residents = useMemo<ResOpt[]>(() => (resQ.data || []).map((raw) => {
    const a = adaptResident(raw);
    const sp = (raw.sponsor ?? null) as { id?: unknown; name?: unknown } | null;
    return { id: String(a.id), name: String(a.name), room: String(a.room ?? ""), sponsorId: sp?.id ? String(sp.id) : "", sponsorName: sp?.name ? String(sp.name) : "" };
  }), [resQ.data]);
  const storeItems = useMemo(() => parse<InvItem>(settingRows.find((r) => (r.key || r.id) === ITEMS_KEY)?.value), [settingRows]);
  // Optimistic overlay: the moment we write, show `pendingItems` so the UI updates
  // instantly; cleared once the store round-trip reconciles (avoids the add-stock lag).
  const [pendingItems, setPendingItems] = useState<InvItem[] | null>(null);
  const items = pendingItems ?? storeItems;
  const prs = useMemo(() => parse<PR>(settingRows.find((r) => (r.key || r.id) === PR_KEY)?.value), [settingRows]);
  const logs = useMemo(() => parse<DispenseLog>(settingRows.find((r) => (r.key || r.id) === LOG_KEY)?.value), [settingRows]);

  const [tab, setTab] = useState<"inventory" | "dispenses" | "requests">("inventory");
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<InvItem | null>(null);
  const [restockItem, setRestockItem] = useState<InvItem | null>(null);
  const [requestItem, setRequestItem] = useState<InvItem | null>(null);
  const [dispenseItem, setDispenseItem] = useState<InvItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const saveItems = async (next: InvItem[]) => {
    setPendingItems(next); // show immediately
    try {
      await upsertRecord("app-settings", ITEMS_KEY, { key: ITEMS_KEY, value: JSON.stringify(next) });
      await refetch();
    } finally {
      setPendingItems(null); // store is now authoritative
    }
  };
  const savePRs = async (next: PR[]) => { await upsertRecord("app-settings", PR_KEY, { key: PR_KEY, value: JSON.stringify(next) }); await refetch(); };
  const saveLogs = async (next: DispenseLog[]) => { await upsertRecord("app-settings", LOG_KEY, { key: LOG_KEY, value: JSON.stringify(next) }); await refetch(); };

  // GENERAL supplies added here don't live in the Mini Pharmacy — they go straight
  // to the shared Facility Inventory (Facility portal). Only medications stay here.
  // Returns true if the item was routed away (so the caller skips the local save).
  const routeIfFacilityGeneral = async (rec: InvItem): Promise<boolean> => {
    if (rec.type !== "GENERAL") return false;
    if (items.some((x) => x.id === rec.id)) await saveItems(items.filter((x) => x.id !== rec.id)); // drop if it was here (med retyped to general)
    const fid = await mirrorFacilityInventory({ name: rec.name, category: rec.category, quantity: rec.quantity, unit: rec.unit, reorder: rec.reorder, location: rec.location, supplier: rec.supplier, expiry: rec.expiry, notes: rec.notes, unitCost: rec.unitPrice || undefined, source: "Mini Pharmacy" });
    Swal.fire({ toast: true, position: "top-end", icon: fid ? "success" : "warning", title: fid ? "General supply sent to Facility Inventory" : "Facility Inventory sync failed — please retry", showConfirmButton: false, timer: 2800 });
    return true;
  };

  const upsertItem = async (it: InvItem) => {
    const rec = { ...it, updatedAt: new Date().toISOString() };
    setAddOpen(false); setEditItem(null); // close instantly
    if (await routeIfFacilityGeneral(rec)) return;
    try { await saveItems([rec, ...items.filter((x) => x.id !== rec.id)]); }
    catch { Swal.fire({ toast: true, position: "top-end", icon: "error", title: "Couldn't save — please retry", showConfirmButton: false, timer: 2600 }); }
  };
  const restock = async (it: InvItem, add: number) => {
    setRestockItem(null); // close instantly
    await saveItems(items.map((x) => (x.id === it.id ? { ...x, quantity: x.quantity + add, updatedAt: new Date().toISOString() } : x)));
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: `Restocked +${add}`, showConfirmButton: false, timer: 1400 });
  };
  const submitPR = async (it: InvItem, quantity: number, urgency: string, notes: string) => { const rec: PR = { id: newId("pr"), itemId: it.id, itemName: it.name, unit: it.unit, quantity, urgency, notes: notes || undefined, status: "PENDING", by: clinicianName, byAt: new Date().toISOString() }; await savePRs([rec, ...prs]); setRequestItem(null); Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Purchase request submitted", showConfirmButton: false, timer: 1600 }); };
  const setPRStatus = async (pr: PR, status: PR["status"]) => savePRs(prs.map((x) => (x.id === pr.id ? { ...x, status, approvedBy: status === "APPROVED" ? clinicianName : x.approvedBy } : x)));

  const exportCsv = () => exportInventoryCsv("MINI", items, "mini-pharmacy-stock.csv");
  const importCsv = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    const text = await file.text();
    const result = parseInventoryCsv({ variant: "MINI", text, existing: items, residents: residents.map((r) => ({ id: r.id, name: r.name })), newId: () => newId("mp") });
    if (result.formatError) {
      Swal.fire({ icon: "error", title: "Invalid CSV format", html: `${result.formatError}<br/><br/><b>Expected columns:</b><br/><code style="font-size:.8rem">${inventoryHeaders("MINI").join(", ")}</code>` });
      return;
    }
    if (!result.added.length) { Swal.fire({ icon: "warning", title: "Nothing to import", html: importSummaryHtml(result) }); return; }
    const confirm = await Swal.fire({ icon: "question", title: "Import into Mini Pharmacy?", html: importSummaryHtml(result), showCancelButton: true, confirmButtonText: `Import ${result.added.length} item(s)`, confirmButtonColor: "#0d9488" });
    if (!confirm.isConfirmed) return;
    // General supplies route to the Facility Inventory; medications stay here.
    const toFacility = result.added.filter((a) => a.type === "GENERAL");
    const toClinical = result.added.filter((a) => a.type !== "GENERAL").map((a) => ({ ...a, unitPrice: a.unitPrice ?? 0 })) as InvItem[];
    try {
      if (toClinical.length) await saveItems([...toClinical, ...items]);
      for (const g of toFacility) await mirrorFacilityInventory({ name: g.name, category: g.category, quantity: g.quantity, unit: g.unit, reorder: g.reorder, location: g.location, supplier: g.supplier, expiry: g.expiry, notes: g.notes, unitCost: g.unitPrice || undefined, source: "Mini Pharmacy" });
      Swal.fire({ toast: true, position: "top-end", icon: "success", title: `Imported ${toClinical.length} med(s)${toFacility.length ? ` · ${toFacility.length} to Facility Inventory` : ""}`, showConfirmButton: false, timer: 2600 });
    } catch { Swal.fire({ toast: true, position: "top-end", icon: "error", title: "Import failed — please retry", showConfirmButton: false, timer: 2600 }); }
  };

  // Dispense-with-charge: confirm → decrement stock, post a ServiceCharge to the
  // resident, append to the audit log, and auto-queue a restock request if the
  // draw takes the item low/out. The charge is best-effort separate from the
  // inventory write so an audit trail still lands even if billing hiccups.
  const dispense = async (it: InvItem, opts: { residentId: string; residentName: string; sponsorId: string; sponsorName: string; qty: number; emergency: boolean; reason: string }) => {
    const { residentId, residentName, sponsorId, sponsorName, qty, emergency, reason } = opts;
    const amount = qty * (Number(it.unitPrice) || 0);
    // The resident is the billing subject; when a family sponsor is on file they
    // are the payer who sees/pays it in the Family portal (scoped by sponsorId).
    const billedTo = sponsorName ? `${sponsorName} (family sponsor)` : `${residentName} (resident — no sponsor on file)`;
    const confirm = await Swal.fire({
      title: "Dispense from Mini Pharmacy?",
      html: `Dispense <b>${qty} ${it.unit}</b> of <b>${it.name}</b> for <b>${residentName}</b><br/>Bill to <b>${billedTo}</b>:<br/><span style="font-size:1.4rem;font-weight:800;color:#0f766e">${peso(amount)}</span><br/><span style="font-size:.8rem;color:#64748b">${qty} × ${peso(it.unitPrice)}${emergency ? " · Emergency dispense" : ""}</span>`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Dispense & Charge",
      confirmButtonColor: "#0d9488",
    });
    if (!confirm.isConfirmed) return;

    const nowIso = new Date().toISOString();

    // Build every next-state up front, then fire the four independent writes in
    // PARALLEL (inventory, purchase-requests, dispense-log app-settings + the
    // resident ServiceCharge). Previously these ran sequentially and each save
    // helper also awaited its own refetch — 7 remote round-trips on the Singapore
    // pooler, which is the delay. Now it's one round-trip's worth + one refresh.
    const nextItems = items.map((x) => (x.id === it.id ? { ...x, quantity: x.quantity - qty, updatedAt: nowIso } : x));
    const log: DispenseLog = { id: newId("disp"), itemId: it.id, itemName: it.name, unit: it.unit, qty, unitPrice: Number(it.unitPrice) || 0, amount, residentId, residentName, sponsorId: sponsorId || undefined, sponsorName: sponsorName || undefined, emergency, reason: reason || undefined, by: clinicianName, at: nowIso };
    const nextLogs = [log, ...logs];

    // Auto-queue a restock request when this draw crosses low/out.
    const remaining = it.quantity - qty;
    let nextPRs = prs;
    if (remaining <= it.reorder && !prs.some((p) => p.itemId === it.id && (p.status === "PENDING" || p.status === "APPROVED"))) {
      nextPRs = [{ id: newId("pr"), itemId: it.id, itemName: it.name, unit: it.unit, quantity: Math.max(it.reorder * 2 - remaining, it.reorder), urgency: remaining <= 0 ? "Urgent" : "Routine", notes: "Auto-queued after mini-pharmacy dispense", status: "PENDING", by: "System", byAt: nowIso }, ...prs];
    }

    const results = await Promise.allSettled([
      upsertRecord("app-settings", ITEMS_KEY, { key: ITEMS_KEY, value: JSON.stringify(nextItems) }),
      upsertRecord("app-settings", PR_KEY, { key: PR_KEY, value: JSON.stringify(nextPRs) }),
      upsertRecord("app-settings", LOG_KEY, { key: LOG_KEY, value: JSON.stringify(nextLogs) }),
      // The resident charge (unbilled ServiceCharge → picked up by billing); it
      // reaches the family sponsor automatically via resident.sponsorId scoping.
      createRecord("service-charges", {
        residentId,
        description: `Mini Pharmacy — ${it.name} ×${qty} ${it.unit}${emergency ? " (emergency)" : ""}${reason ? ` — ${reason}` : ""}${sponsorName ? ` · billed to family sponsor ${sponsorName}` : ""}`,
        amount,
        category: CHARGE_CATEGORY,
        serviceDate: nowIso,
      }),
    ]);
    const charged = results[3].status === "fulfilled";

    setDispenseItem(null);
    void refetch(); // single background refresh (useLiveQuery also polls)
    Swal.fire({ toast: true, position: "top-end", icon: charged ? "success" : "warning", title: charged ? `Dispensed · ${peso(amount)} charged` : "Dispensed — charge failed, please add manually", showConfirmButton: false, timer: charged ? 1800 : 3200 });
  };

  const categoryOpts = useMemo(() => Array.from(new Set(items.map((i) => (i.category || "").trim()).filter(Boolean))).sort(), [items]);
  // Only medications live in the Mini Pharmacy — general supplies are routed to the
  // Facility Inventory on add, so they never appear here (this also hides any legacy).
  const medItems = useMemo(() => items.filter((it) => it.type !== "GENERAL"), [items]);
  const q = search.trim().toLowerCase();
  const filtered = medItems.filter((it) => {
    const okQ = !q || [it.name, it.generic, it.brand, it.category, it.supplier, it.location].some((f) => (f || "").toLowerCase().includes(q));
    const okCat = !categoryFilter || it.category === categoryFilter;
    const okS = !stockFilter || stockLevel(it) === stockFilter;
    return okQ && okCat && okS;
  });
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const chargedThisMonth = logs.filter((l) => new Date(l.at).getTime() >= monthStart).reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const stats = { total: medItems.length, critical: medItems.filter((it) => stockLevel(it) === "out").length, low: medItems.filter((it) => stockLevel(it) === "low").length, charged: chargedThisMonth };

  return (
    <div className="min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div><h1 className="text-2xl sm:text-3xl font-bold text-slate-900 flex items-center gap-2"><Cross className="w-6 h-6 text-teal-600" /> Mini Pharmacy</h1><p className="text-sm text-slate-500 mt-1">Facility backup medication stock — dispense when a resident is out or in an emergency; each dispense is charged.</p></div>
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={importCsv} className="hidden" />
          <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"><Upload className="w-4 h-4" /> Import CSV</button>
          <button onClick={exportCsv} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download className="w-4 h-4" /> Export CSV</button>
          <button onClick={() => { setEditItem(null); setAddOpen(true); }} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700"><Plus className="w-4 h-4" /> Add Medication</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <InvStat value={String(stats.total)} label="Stocked Items" tone="#334155" />
        <InvStat value={String(stats.critical)} label="Out of Stock" tone="#dc2626" />
        <InvStat value={String(stats.low)} label="Low Stock" tone="#d97706" />
        <InvStat value={peso(stats.charged)} label="Charged This Month" tone="#0d9488" />
      </div>

      <div className="inline-flex gap-1 bg-slate-100 rounded-xl p-1 mb-5">
        {([["inventory", "Stock"], ["dispenses", "Dispense Log"], ["requests", "Purchase Requests"]] as const).map(([v, label]) => <button key={v} onClick={() => setTab(v)} className={`px-3.5 py-1.5 rounded-lg text-sm font-medium ${tab === v ? "bg-white shadow-sm text-slate-800" : "text-slate-500"}`}>{label}{v === "inventory" ? ` ${medItems.length}` : v === "dispenses" ? ` ${logs.length}` : prs.filter((p) => p.status === "PENDING").length ? ` ${prs.filter((p) => p.status === "PENDING").length}` : ""}</button>)}
      </div>

      {tab === "inventory" && (<>
        <div className="flex flex-col lg:flex-row gap-3 mb-5">
          <div className="relative flex-1"><Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, category, supplier…" className="w-full pl-11 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-teal-400/40" /></div>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm"><option value="">All Categories</option>{categoryOpts.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm"><option value="">All Stock Levels</option><option value="out">Out of Stock</option><option value="low">Low Stock</option><option value="ok">In Stock</option></select>
        </div>
        <InventoryTable items={filtered} onDispense={setDispenseItem} onRestock={setRestockItem} onRequest={setRequestItem} onEdit={(x) => { setEditItem(x); setAddOpen(true); }} empty={<>No mini-pharmacy stock yet. Click <b>Add Medication</b> to start.</>} />
      </>)}

      {tab === "dispenses" && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="inventory-table-head"><tr className="text-left text-white" style={{ backgroundColor: "#2E4A48" }}>
                {["Date", "Medication", "Resident", "Qty", "Charged", "By"].map((h) => <th key={h} className="px-6 py-3 text-[11px] font-bold uppercase tracking-wider">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {logs.length === 0 ? <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-400">No dispenses yet.</td></tr>
                  : logs.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50/60">
                      <td className="px-6 py-3 text-slate-600 whitespace-nowrap">{fmtDate(l.at.slice(0, 10))}</td>
                      <td className="px-6 py-3 font-semibold text-slate-800">{l.itemName}{l.emergency && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">EMERGENCY</span>}</td>
                      <td className="px-6 py-3 text-slate-600">{l.residentName}</td>
                      <td className="px-6 py-3 tabular-nums text-slate-700">{l.qty} {l.unit}</td>
                      <td className="px-6 py-3 tabular-nums font-bold text-teal-700">{peso(l.amount)}</td>
                      <td className="px-6 py-3 text-slate-500">{l.by || "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "requests" && (
        <div className="space-y-3">
          {prs.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-400">No purchase requests.</div>
            : prs.map((pr) => (
              <div key={pr.id} className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap"><p className="font-bold text-slate-900">{pr.itemName}</p><span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">{pr.urgency}</span><span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${pr.status === "APPROVED" ? "bg-green-100 text-green-700" : pr.status === "ORDERED" ? "bg-slate-200 text-slate-600" : pr.status === "REJECTED" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{pr.status === "APPROVED" && <CheckCircle2 className="w-3 h-3" />}{pr.status[0] + pr.status.slice(1).toLowerCase()}</span></div>
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

      {addOpen && <AddItemModal item={editItem} onClose={() => { setAddOpen(false); setEditItem(null); }} onSave={upsertItem} />}
      {restockItem && <RestockModal item={restockItem} onClose={() => setRestockItem(null)} onRestock={restock} />}
      {requestItem && <RequestModal item={requestItem} onClose={() => setRequestItem(null)} onSubmit={submitPR} />}
      {dispenseItem && <DispenseModal item={dispenseItem} residents={residents} onClose={() => setDispenseItem(null)} onDispense={dispense} />}
    </div>
  );
}

function InvStat({ value, label, tone }: { value: string; label: string; tone: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-3xl font-bold" style={{ color: tone }}>{value}</p><p className="text-sm text-slate-500 mt-1">{label}</p></div>;
}

function InventoryTable({ items, onDispense, onRestock, onRequest, onEdit, empty }: { items: InvItem[]; onDispense: (it: InvItem) => void; onRestock: (it: InvItem) => void; onRequest: (it: InvItem) => void; onEdit: (it: InvItem) => void; empty: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="inventory-table-head">
            <tr className="text-left text-white" style={{ backgroundColor: "#2E4A48" }}>
              {["Item", "Current Qty", "Stock Level", "Price / Unit", "Expiry", "Location"].map((h) => <th key={h} className="px-6 py-3 text-[11px] font-bold uppercase tracking-wider">{h}</th>)}
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <tr><td colSpan={7} className="px-6 py-10 text-center text-slate-400">{empty}</td></tr>
            ) : items.map((it) => <InvTableRow key={it.id} it={it} onDispense={onDispense} onRestock={onRestock} onRequest={onRequest} onEdit={onEdit} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InvTableRow({ it, onDispense, onRestock, onRequest, onEdit }: { it: InvItem; onDispense: (it: InvItem) => void; onRestock: (it: InvItem) => void; onRequest: (it: InvItem) => void; onEdit: (it: InvItem) => void }) {
  const lvl = stockLevel(it); const sm = stockMeta(lvl); const rel = expiryRel(it.expiry);
  const subtitle = [it.category, it.supplier].filter(Boolean).join(" · ");
  const out = lvl === "out";
  return (
    <tr className="hover:bg-slate-50/60 transition">
      <td className="px-6 py-3.5 align-middle">
        <p className="font-bold text-slate-900 flex items-center gap-2">{it.type === "MEDICATION" ? <Pill className="w-3.5 h-3.5 text-teal-500" /> : <Package className="w-3.5 h-3.5 text-slate-400" />}{it.name}</p>
        {subtitle ? <p className="text-xs mt-0.5" style={{ color: "#9a7b52" }}>{subtitle}</p> : it.generic ? <p className="text-xs mt-0.5 text-slate-400">{it.generic}</p> : null}
      </td>
      <td className="px-6 py-3.5 align-middle">
        <p className="text-lg font-bold leading-none tabular-nums" style={{ color: out ? "#C0573F" : "#1e293b" }}>{it.quantity}</p>
        <p className="text-[11px] text-slate-400 mt-0.5">{it.unit}</p>
      </td>
      <td className="px-6 py-3.5 align-middle">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-[0.04em] ${sm.cls}`}>{sm.label}</span>
        <p className="text-[11px] text-slate-400 mt-1">Min {it.reorder}</p>
      </td>
      <td className="px-6 py-3.5 align-middle"><p className="text-sm font-bold text-teal-700 tabular-nums">{peso(it.unitPrice)}</p></td>
      <td className="px-6 py-3.5 align-middle">
        {it.expiry ? <><p className="text-sm text-slate-700 tabular-nums">{numDate(it.expiry)}</p>{rel && <p className={`text-[11px] mt-0.5 ${rel.cls}`}>{rel.text}</p>}</> : <span className="text-slate-300">—</span>}
      </td>
      <td className="px-6 py-3.5 align-middle text-sm text-slate-700">{it.location || <span className="text-slate-300">—</span>}</td>
      <td className="px-4 py-3.5 align-middle text-right whitespace-nowrap">
        <button onClick={() => onDispense(it)} disabled={out} title={out ? "Out of stock" : "Dispense (with charge)"} className="p-1.5 rounded-lg text-teal-600 transition hover:bg-teal-50 disabled:opacity-30 disabled:cursor-not-allowed"><HandCoins className="w-4 h-4" /></button>
        <button onClick={() => onRestock(it)} title="Restock" className="p-1.5 rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-[#2E4A48]"><RefreshCw className="w-4 h-4" /></button>
        <button onClick={() => onRequest(it)} title="Request purchase" className="p-1.5 rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-teal-600"><ShoppingCart className="w-4 h-4" /></button>
        <button onClick={() => onEdit(it)} title="Edit" className="p-1.5 rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><Pencil className="w-4 h-4" /></button>
      </td>
    </tr>
  );
}

const inp = "w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-teal-400/40";
const lbl = "block text-sm font-bold text-slate-700 mb-1.5";

function AddItemModal({ item, onClose, onSave }: { item: InvItem | null; onClose: () => void; onSave: (it: InvItem) => Promise<void> }) {
  const [type, setType] = useState<"MEDICATION" | "GENERAL">(item?.type || "MEDICATION");
  const [name, setName] = useState(item?.name || "");
  const [generic, setGeneric] = useState(item?.generic || "");
  const [brand, setBrand] = useState(item?.brand || "");
  const [category, setCategory] = useState(item?.category || "");
  const [supplier, setSupplier] = useState(item?.supplier || "");
  const [unit, setUnit] = useState(item?.unit || "tablets");
  const [quantity, setQuantity] = useState(item ? String(item.quantity) : "0");
  const [reorder, setReorder] = useState(item ? String(item.reorder) : "10");
  const [unitPrice, setUnitPrice] = useState(item ? String(item.unitPrice) : "");
  const [location, setLocation] = useState(item?.location || "");
  const [expiry, setExpiry] = useState(item?.expiry || "");
  const [notes, setNotes] = useState(item?.notes || "");
  const [saving, setSaving] = useState(false);
  const isMed = type === "MEDICATION";

  const submit = async () => {
    if (!name.trim()) { Swal.fire({ title: `${isMed ? "Medication" : "Item"} name is required`, icon: "warning" }); return; }
    if (isMed && !(Number(unitPrice) > 0)) { Swal.fire({ title: "A selling price per unit is required", text: "This is what the resident is charged when the medication is dispensed. (General supplies are sent to the Facility Inventory and need no price.)", icon: "warning" }); return; }
    setSaving(true);
    try { await onSave({ id: item?.id || newId("mp"), type, name: name.trim(), generic: isMed ? generic.trim() || undefined : undefined, brand: isMed ? brand.trim() || undefined : undefined, category: category.trim() || undefined, supplier: supplier.trim() || undefined, unit, quantity: Number(quantity) || 0, reorder: Number(reorder) || 0, unitPrice: Number(unitPrice) || 0, location: location.trim() || undefined, expiry: expiry || undefined, notes: notes.trim() || undefined, updatedAt: new Date().toISOString() }); }
    finally { setSaving(false); }
  };

  const TypeIcon = isMed ? Pill : Package;
  const TYPE_META = {
    MEDICATION: { label: "Medication", desc: "Chargeable · stays in Mini Pharmacy", icon: Pill },
    GENERAL: { label: "General Supply", desc: "Routed to Facility Inventory", icon: Package },
  } as const;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white w-full max-w-lg max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600"><TypeIcon className="w-5 h-5" /></span>
            <div className="min-w-0">
              <h2 className="font-bold text-slate-900 text-lg leading-tight">{item ? "Edit" : "Add"} Mini-Pharmacy Item</h2>
              <p className="text-xs text-slate-500 mt-0.5">Facility backup stock — dispensed to residents with a charge</p>
            </div>
          </div>
          <button onClick={onClose} className="-mr-1.5 shrink-0 p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-5">
          {/* Item type */}
          <div className="grid grid-cols-2 gap-2.5">
            {(["MEDICATION", "GENERAL"] as const).map((t) => {
              const m = TYPE_META[t]; const Icon = m.icon; const active = type === t;
              return (
                <button key={t} type="button" onClick={() => setType(t)} aria-pressed={active}
                  className={`flex items-start gap-2.5 rounded-xl border-2 p-3 text-left transition ${active ? "border-teal-500 bg-teal-50/60" : "border-slate-200 bg-white hover:border-teal-300"}`}>
                  <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${active ? "text-teal-600" : "text-slate-400"}`} />
                  <span className="min-w-0">
                    <span className={`block text-sm font-bold ${active ? "text-teal-800" : "text-slate-700"}`}>{m.label}</span>
                    <span className="block text-[11px] leading-tight text-slate-500 mt-0.5">{m.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {!isMed && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800">
              <Package className="w-4 h-4 shrink-0 mt-0.5" />
              <span>General supplies are saved to the shared <b>Facility Inventory</b> instead of the Mini Pharmacy, and don&apos;t need a selling price.</span>
            </div>
          )}

          {/* Identification */}
          <div className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Item details</p>
            <div><label className={lbl}>{isMed ? "Medication Name" : "Item Name"} <span className="text-red-500">*</span></label><input value={name} onChange={(e) => setName(e.target.value)} placeholder={isMed ? "e.g., Paracetamol 500mg" : "e.g., IV set"} className={inp} /></div>
            {isMed && (
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Generic Name</label><input value={generic} onChange={(e) => setGeneric(e.target.value)} placeholder="e.g., Paracetamol" className={inp} /></div>
                <div><label className={lbl}>Brand Name</label><input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g., Biogesic" className={inp} /></div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Category</label><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g., Analgesic" className={inp} /></div>
              <div><label className={lbl}>Supplier</label><input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g., MedSupply Co." className={inp} /></div>
            </div>
          </div>

          {/* Stock & pricing */}
          <div className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Stock &amp; pricing</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Unit <span className="text-red-500">*</span></label><select value={unit} onChange={(e) => setUnit(e.target.value)} className={inp}>{UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
              <div>
                <label className={lbl}>{isMed ? <>Selling Price / {unit} <span className="text-red-500">*</span></> : <>Unit Cost / {unit} <span className="text-slate-400 font-normal">(optional)</span></>}</label>
                <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span><input inputMode="decimal" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="0.00" className={`${inp} pl-7 ${isMed ? "font-semibold" : ""}`} /></div>
              </div>
            </div>
            {isMed && <p className="-mt-1 text-[11px] text-slate-400">This is what the resident is charged per {unit} on dispense.</p>}
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Current Quantity</label><input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inp} /></div>
              <div><label className={lbl}>Reorder Threshold</label><input inputMode="numeric" value={reorder} onChange={(e) => setReorder(e.target.value)} placeholder="10" className={inp} /></div>
            </div>
          </div>

          {/* Storage */}
          <div className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Storage &amp; notes</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Location / Cabinet</label><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g., Emergency Cabinet" className={inp} /></div>
              <div><label className={lbl}>Expiry Date</label><input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={inp} /></div>
            </div>
            <div><label className={lbl}>Notes</label><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Handling, storage temperature, or dispensing notes…" className={inp} /></div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50/60"><button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button><button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-60"><Plus className="w-4 h-4" /> {saving ? "Saving…" : item ? "Save Changes" : "Add Item"}</button></div>
      </div>
    </div>
  );
}

function DispenseModal({ item, residents, onClose, onDispense }: { item: InvItem; residents: ResOpt[]; onClose: () => void; onDispense: (it: InvItem, opts: { residentId: string; residentName: string; sponsorId: string; sponsorName: string; qty: number; emergency: boolean; reason: string }) => Promise<void> }) {
  const [residentId, setResidentId] = useState("");
  const [qty, setQty] = useState("1");
  const [emergency, setEmergency] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  const overStock = n > item.quantity;
  const amount = n * (Number(item.unitPrice) || 0);
  const selected = residents.find((r) => r.id === residentId);
  const residentName = selected?.name || "";
  const sponsorName = selected?.sponsorName || "";
  const sponsorId = selected?.sponsorId || "";

  const go = async () => {
    if (!residentId) { Swal.fire({ title: "Select the resident to charge", icon: "warning" }); return; }
    if (n <= 0) { Swal.fire({ title: "Enter a quantity", icon: "warning" }); return; }
    if (overStock) { Swal.fire({ title: "Not enough stock", text: `Only ${item.quantity} ${item.unit} available.`, icon: "warning" }); return; }
    setBusy(true);
    try { await onDispense(item, { residentId, residentName, sponsorId, sponsorName, qty: n, emergency, reason: reason.trim() }); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-3"><h2 className="font-bold text-slate-900 flex items-center gap-2"><HandCoins className="w-5 h-5 text-teal-600" /> Dispense — {item.name}</h2><button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button></div>
        <div className="rounded-xl bg-teal-50 border border-teal-100 px-3 py-2 mb-3 text-sm text-teal-800">In stock: <b>{item.quantity} {item.unit}</b> · Price <b>{peso(item.unitPrice)}</b> / {item.unit}</div>
        <label className={lbl}>Charge to Resident <span className="text-red-500">*</span></label>
        <div className="relative"><User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /><select value={residentId} onChange={(e) => setResidentId(e.target.value)} className={`${inp} pl-9`}><option value="">Select resident…</option>{residents.map((r) => <option key={r.id} value={r.id}>{r.name}{r.room ? ` — Rm ${r.room}` : ""}</option>)}</select></div>
        {residentId && (
          <div className={`mt-2 mb-3 flex items-center gap-2 text-xs rounded-lg px-3 py-2 border ${sponsorName ? "bg-indigo-50 text-indigo-700 border-indigo-100" : "bg-amber-50 text-amber-700 border-amber-100"}`}>
            <Users className="w-3.5 h-3.5 shrink-0" />
            {sponsorName ? <span>Billed to family sponsor: <b>{sponsorName}</b> — appears on their family dashboard.</span> : <span>No family sponsor on file — billed to the resident directly.</span>}
          </div>
        )}
        <div className={residentId ? "" : "mt-3"} />
        <label className={lbl}>Quantity ({item.unit}) <span className="text-red-500">*</span></label>
        <input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} className={`${inp} ${overStock ? "border-red-400 focus:ring-red-400/40" : ""}`} />
        {overStock && <p className="text-xs text-red-600 mt-1">Exceeds available stock ({item.quantity} {item.unit}).</p>}
        <label className="flex items-center gap-2 mt-3 text-sm font-medium text-slate-700 cursor-pointer"><input type="checkbox" checked={emergency} onChange={(e) => setEmergency(e.target.checked)} className="w-4 h-4 rounded accent-red-600" /> Emergency dispense</label>
        <label className={`${lbl} mt-3`}>Reason / Note <span className="text-slate-400 font-normal">(optional)</span></label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g., resident's own stock ran out" className={inp} />
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 mt-4 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-600">Bill to {sponsorName || residentName || "resident"}</span>
          <span className="text-2xl font-extrabold text-teal-700 tabular-nums">{peso(amount)}</span>
        </div>
        <div className="flex justify-end gap-2 mt-4"><button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button><button onClick={go} disabled={busy || overStock} className="px-5 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-60">{busy ? "Dispensing…" : "Dispense & Charge"}</button></div>
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
        <div className="flex justify-end gap-2 mt-4"><button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button><button onClick={() => Number(add) > 0 && onRestock(item, Number(add))} className="px-5 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700">Restock</button></div>
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
        <div className="flex justify-end gap-2 mt-4"><button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button><button onClick={() => Number(quantity) > 0 && onSubmit(item, Number(quantity), urgency, notes)} className="px-5 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700">Submit Request</button></div>
      </div>
    </div>
  );
}
