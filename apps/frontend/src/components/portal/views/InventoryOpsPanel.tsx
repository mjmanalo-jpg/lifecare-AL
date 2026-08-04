"use client";

import { useMemo, useState } from "react";
import { ScanLine, PackageMinus, PackagePlus, Truck, Wrench, Plus, Trash2, Save, Loader2, CalendarClock, CheckCircle2, X } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { updateRecord, upsertRecord } from "@/lib/api";
import {
  INVENTORY_VENDORS_KEY, INVENTORY_ASSETS_KEY,
  parseVendors, parseAssetSchedules, fefoAllocate, byExpiry, daysUntil, addDays, newId, generateBarcode,
  type Vendor, type Batch, type AssetScheduleMap,
} from "@/lib/inventoryOps";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 bg-white";

/** Materials-management operations: barcode/RFID scan, FEFO dispensing, vendor
 *  directory, and durable-equipment maintenance schedules. Self-contained and
 *  migration-free (vendors + asset schedules live in app-settings). */
export default function InventoryOpsPanel() {
  const { data: itemRows, refetch } = useLiveQuery<Row>("inventory", { query: "take=1000", tables: ["InventoryItem"] });
  const { data: settingRows, refetch: refetchSettings } = useLiveQuery<{ id: string; key?: string; value: string }>("app-settings", { tables: ["AppSetting"] });

  const rowFor = (k: string) => settingRows.find((r) => (r.key || r.id) === k)?.value;
  const vendors = useMemo(() => parseVendors(rowFor(INVENTORY_VENDORS_KEY)), [settingRows]);
  const assetMap = useMemo(() => parseAssetSchedules(rowFor(INVENTORY_ASSETS_KEY)), [settingRows]);

  // Distinct item names (each may span several batch rows).
  const itemNames = useMemo(() => Array.from(new Set(itemRows.map((r) => s(r.itemName)))).filter(Boolean).sort(), [itemRows]);

  // ── Barcode / RFID scan ──────────────────────────────────────────────
  const [scanCode, setScanCode] = useState("");
  const [scanned, setScanned] = useState<Row | null>(null);
  const doScan = (code: string) => {
    const c = code.trim().toLowerCase();
    if (!c) return;
    const hit = itemRows.find((r) => s(r.batchNumber).toLowerCase() === c || s(r.id).toLowerCase() === c)
      || itemRows.find((r) => s(r.itemName).toLowerCase().includes(c));
    if (hit) { setScanned(hit); setScanCode(""); }
    else Swal.fire({ title: "Not found", text: `No item matches “${code}”. Try the batch number or name.`, icon: "info", timer: 2000, showConfirmButton: false });
  };
  const adjustScanned = async (delta: number) => {
    if (!scanned) return;
    const next = Math.max(0, Number(scanned.quantity ?? 0) + delta);
    await updateRecord("inventory", s(scanned.id), { quantity: next, lastRestocked: delta > 0 ? new Date().toISOString() : undefined });
    setScanned({ ...scanned, quantity: next });
    await refetch();
  };

  // Backfill: give every existing item a scannable barcode/batch number.
  const missingBarcode = itemRows.filter((r) => !s(r.batchNumber).trim());
  const [backfilling, setBackfilling] = useState(false);
  const assignBarcodes = async () => {
    if (!missingBarcode.length) return;
    setBackfilling(true);
    try {
      for (const r of missingBarcode) await updateRecord("inventory", s(r.id), { batchNumber: generateBarcode() });
      await refetch();
      Swal.fire({ title: "Barcodes assigned", text: `${missingBarcode.length} item(s) now have a scannable code.`, icon: "success", timer: 2000, showConfirmButton: false });
    } catch (e) { Swal.fire({ title: "Failed", text: e instanceof Error ? e.message : "Try again", icon: "error" }); }
    finally { setBackfilling(false); }
  };

  // ── FEFO dispense ────────────────────────────────────────────────────
  const [fefoName, setFefoName] = useState("");
  const [fefoQty, setFefoQty] = useState("1");
  const [dispensing, setDispensing] = useState(false);
  const fefoBatches = useMemo<Batch[]>(
    () => itemRows.filter((r) => s(r.itemName) === fefoName).map((r) => ({ id: s(r.id), quantity: Number(r.quantity ?? 0), expiryDate: r.expiryDate ? s(r.expiryDate) : null })).sort(byExpiry),
    [itemRows, fefoName],
  );
  const fefoTotal = fefoBatches.reduce((a, b) => a + b.quantity, 0);
  const fefoPlan = useMemo(() => fefoAllocate(fefoBatches, Number(fefoQty) || 0), [fefoBatches, fefoQty]);
  // Soonest-to-expire batches across all items — tap one to select it for dispensing.
  const expiringPreview = useMemo(
    () => itemRows
      .filter((r) => r.expiryDate && Number(r.quantity ?? 0) > 0)
      .map((r) => ({ id: s(r.id), name: s(r.itemName), qty: Number(r.quantity ?? 0), expiry: s(r.expiryDate), batch: s(r.batchNumber) }))
      .sort((a, b) => new Date(a.expiry).getTime() - new Date(b.expiry).getTime())
      .slice(0, 8),
    [itemRows],
  );

  const dispenseFefo = async () => {
    const qty = Number(fefoQty) || 0;
    if (!fefoName || qty <= 0) return;
    if (!fefoPlan.length) { Swal.fire({ title: "Not enough stock", text: `Only ${fefoTotal} on hand.`, icon: "warning" }); return; }
    setDispensing(true);
    try {
      for (const p of fefoPlan) {
        const row = itemRows.find((r) => s(r.id) === p.id);
        const next = Math.max(0, Number(row?.quantity ?? 0) - p.take);
        await updateRecord("inventory", p.id, { quantity: next });
      }
      await refetch();
      const earliest = fefoBatches[0]?.expiryDate ? new Date(fefoBatches[0].expiryDate).toLocaleDateString() : "n/a";
      Swal.fire({ title: "Dispensed (FEFO)", text: `${qty} × ${fefoName} — earliest-expiry batch first (${earliest}).`, icon: "success", timer: 2200, showConfirmButton: false });
      setFefoQty("1");
    } catch (e) {
      Swal.fire({ title: "Failed", text: e instanceof Error ? e.message : "Try again", icon: "error" });
    } finally { setDispensing(false); }
  };

  // ── Vendors ──────────────────────────────────────────────────────────
  const [draftVendors, setDraftVendors] = useState<Vendor[] | null>(null);
  const vlist = draftVendors ?? vendors;
  const [savingV, setSavingV] = useState(false);
  const saveVendors = async (next: Vendor[]) => {
    setSavingV(true);
    try {
      await upsertRecord("app-settings", INVENTORY_VENDORS_KEY, { key: INVENTORY_VENDORS_KEY, value: JSON.stringify(next.filter((v) => v.name.trim())) });
      setDraftVendors(null); await refetchSettings();
      Swal.fire({ title: "Vendors saved", icon: "success", timer: 1200, showConfirmButton: false });
    } catch (e) { Swal.fire({ title: "Save failed", text: e instanceof Error ? e.message : "Try again", icon: "error" }); }
    finally { setSavingV(false); }
  };

  // ── Asset maintenance (durable equipment) ────────────────────────────
  const assets = useMemo(() => itemRows.filter((r) => ["EQUIPMENT", "FURNITURE"].includes(s(r.category))), [itemRows]);
  const setSchedule = async (itemId: string, patch: Partial<AssetScheduleMap[string]>) => {
    const next: AssetScheduleMap = { ...assetMap, [itemId]: { intervalDays: 90, ...(assetMap[itemId] ?? {}), ...patch } };
    await upsertRecord("app-settings", INVENTORY_ASSETS_KEY, { key: INVENTORY_ASSETS_KEY, value: JSON.stringify(next) });
    await refetchSettings();
  };
  const markServiced = async (itemId: string) => {
    const sched = assetMap[itemId] ?? { intervalDays: 90 };
    const now = new Date();
    await setSchedule(itemId, { lastService: now.toISOString(), nextService: addDays(now, sched.intervalDays || 90).toISOString() });
    Swal.fire({ title: "Serviced", icon: "success", timer: 1200, showConfirmButton: false });
  };

  return (
    <div className="space-y-6">
      {/* Scan + FEFO */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2 mb-1"><ScanLine className="w-5 h-5 text-emerald-600" /> Barcode / RFID scan</h3>
          <p className="text-xs text-gray-500 mb-3">Scan (USB scanner types into the box) or type a batch number / item name to jump to an item and receive or dispense.</p>
          <form onSubmit={(e) => { e.preventDefault(); doScan(scanCode); }} className="flex gap-2">
            <input autoFocus value={scanCode} onChange={(e) => setScanCode(e.target.value)} placeholder="Scan or type code…" className={inputCls} />
            <button type="submit" className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700">Find</button>
          </form>
          {missingBarcode.length > 0 && (
            <button onClick={() => void assignBarcodes()} disabled={backfilling} className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-dashed border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60">
              {backfilling ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />} Auto-assign barcodes to {missingBarcode.length} item(s) missing one
            </button>
          )}
          {scanned && (
            <div className="mt-3 rounded-lg border border-gray-200 p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{s(scanned.itemName)}</p>
                <p className="text-xs text-gray-500">On hand: <b>{s(scanned.quantity)}</b> {s(scanned.unit)}{scanned.batchNumber ? ` · batch ${s(scanned.batchNumber)}` : ""}{scanned.expiryDate ? ` · exp ${new Date(s(scanned.expiryDate)).toLocaleDateString()}` : ""}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => void adjustScanned(-1)} title="Dispense 1" className="p-2 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100"><PackageMinus className="w-4 h-4" /></button>
                <button onClick={() => void adjustScanned(1)} title="Receive 1" className="p-2 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100"><PackagePlus className="w-4 h-4" /></button>
                <button onClick={() => setScanned(null)} className="p-2 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2 mb-1"><PackageMinus className="w-5 h-5 text-indigo-600" /> FEFO dispense <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">First-Expire-First-Out</span></h3>
          <p className="text-xs text-gray-500 mb-3">Deducts from the batch nearest to expiry first, across batches, to minimise waste.</p>

          {expiringPreview.length > 0 && (
            <div className="mb-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Nearest to expire — tap to select</p>
              <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                {expiringPreview.map((b) => {
                  const dleft = daysUntil(b.expiry);
                  const active = fefoName === b.name;
                  return (
                    <button key={b.id} type="button" onClick={() => setFefoName(b.name)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition ${active ? "border-indigo-400 bg-indigo-50" : "border-gray-200 hover:bg-gray-50"}`}>
                      <span className="min-w-0 truncate font-semibold text-gray-800">{b.name}{b.batch ? <span className="ml-1 font-normal text-gray-400">· {b.batch}</span> : null}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className={dleft != null && dleft < 0 ? "font-semibold text-rose-600" : dleft != null && dleft < 30 ? "font-semibold text-amber-600" : "text-gray-500"}>
                          {new Date(b.expiry).toLocaleDateString()}{dleft != null ? ` · ${dleft < 0 ? `${Math.abs(dleft)}d ago` : `${dleft}d`}` : ""}
                        </span>
                        <span className="text-gray-400">{b.qty} left</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 items-end">
            <label className="text-xs font-medium text-gray-600 flex-1 min-w-[160px]">Item
              <select className={inputCls + " mt-1"} value={fefoName} onChange={(e) => setFefoName(e.target.value)}>
                <option value="">Select item…</option>
                {itemNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-gray-600 w-24">Qty
              <input type="number" min={1} className={inputCls + " mt-1"} value={fefoQty} onChange={(e) => setFefoQty(e.target.value)} />
            </label>
            <button onClick={() => void dispenseFefo()} disabled={dispensing || !fefoName} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 inline-flex items-center gap-2">{dispensing ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Dispense</button>
          </div>
          {fefoName && (
            <div className="mt-3 text-xs text-gray-600">
              <p className="mb-1">On hand: <b>{fefoTotal}</b> across {fefoBatches.length} batch(es). Plan:</p>
              <ul className="space-y-1">
                {fefoBatches.map((b) => {
                  const take = fefoPlan.find((p) => p.id === b.id)?.take ?? 0;
                  const dleft = daysUntil(b.expiryDate);
                  return <li key={b.id} className={`flex justify-between rounded px-2 py-1 ${take > 0 ? "bg-indigo-50" : "bg-gray-50"}`}><span>Exp {b.expiryDate ? new Date(b.expiryDate).toLocaleDateString() : "—"} {dleft != null && dleft < 30 ? <span className="text-rose-600 font-semibold">({dleft}d)</span> : ""} · {b.quantity} on hand</span><span className="font-semibold">{take > 0 ? `take ${take}` : "—"}</span></li>;
                })}
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* Asset maintenance */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-base font-bold text-gray-900 flex items-center gap-2 mb-1"><Wrench className="w-5 h-5 text-amber-600" /> Durable equipment — maintenance schedules ({assets.length})</h3>
        <p className="text-xs text-gray-500 mb-3">Track wheelchairs, lifts, beds &amp; other equipment. Set a service interval and mark serviced to auto-schedule the next check.</p>
        {assets.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No equipment/furniture items yet.</p> : (
          <div className="space-y-2">
            {assets.map((a) => {
              const sched = assetMap[s(a.id)];
              const dleft = daysUntil(sched?.nextService);
              const status = !sched?.nextService ? "unscheduled" : dleft != null && dleft < 0 ? "overdue" : dleft != null && dleft <= 7 ? "due" : "ok";
              return (
                <div key={s(a.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{s(a.itemName)} <span className="text-xs font-normal text-gray-500">· {s(a.location) || "—"}</span></p>
                    <p className="text-xs text-gray-500">{sched?.nextService ? <>Next service {new Date(sched.nextService).toLocaleDateString()} {dleft != null ? `(${dleft}d)` : ""}</> : "No schedule set"}{sched?.lastService ? ` · last ${new Date(sched.lastService).toLocaleDateString()}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`px-2 py-1 rounded-full text-[11px] font-semibold ${status === "overdue" ? "bg-rose-100 text-rose-700" : status === "due" ? "bg-amber-100 text-amber-700" : status === "ok" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>{status === "unscheduled" ? "No schedule" : status === "ok" ? "OK" : status === "due" ? "Due soon" : "Overdue"}</span>
                    <select className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs bg-white" value={String(sched?.intervalDays ?? 90)} onChange={(e) => void setSchedule(s(a.id), { intervalDays: Number(e.target.value), nextService: sched?.lastService ? addDays(new Date(sched.lastService), Number(e.target.value)).toISOString() : sched?.nextService })}>
                      {[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>every {d}d</option>)}
                    </select>
                    <button onClick={() => void markServiced(s(a.id))} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600"><CheckCircle2 className="w-3.5 h-3.5" /> Serviced</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Vendors */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2"><Truck className="w-5 h-5 text-blue-600" /> Vendor directory ({vlist.length})</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => setDraftVendors([...(vlist), { id: newId("v"), name: "", contact: "", email: "", category: "" }])} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"><Plus className="w-4 h-4" /> Add vendor</button>
            {draftVendors !== null && <button onClick={() => void saveVendors(vlist)} disabled={savingV} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{savingV ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save</button>}
          </div>
        </div>
        {vlist.length === 0 ? <p className="text-sm text-gray-400 py-3 text-center">No vendors yet.</p> : (
          <div className="space-y-2">
            {vlist.map((v) => (
              <div key={v.id} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center">
                <input className={inputCls} placeholder="Vendor name" value={v.name} onChange={(e) => setDraftVendors(vlist.map((x) => x.id === v.id ? { ...x, name: e.target.value } : x))} />
                <input className={inputCls} placeholder="Contact / phone" value={v.contact ?? ""} onChange={(e) => setDraftVendors(vlist.map((x) => x.id === v.id ? { ...x, contact: e.target.value } : x))} />
                <input className={inputCls} placeholder="Email" value={v.email ?? ""} onChange={(e) => setDraftVendors(vlist.map((x) => x.id === v.id ? { ...x, email: e.target.value } : x))} />
                <div className="flex gap-2">
                  <input className={inputCls} placeholder="Supplies (e.g. PPE)" value={v.category ?? ""} onChange={(e) => setDraftVendors(vlist.map((x) => x.id === v.id ? { ...x, category: e.target.value } : x))} />
                  <button onClick={() => setDraftVendors(vlist.filter((x) => x.id !== v.id))} className="p-2 text-red-500 hover:bg-red-50 rounded shrink-0"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
