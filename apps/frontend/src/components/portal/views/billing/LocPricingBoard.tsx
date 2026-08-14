"use client";

/**
 * Level of Care Pricing — set a MONTHLY fee for each acuity Level of Care (1–5).
 * When a nurse / Care Manager approves a resident's level (Care Acuity board), the
 * matching fee is posted to that resident's charges immediately; re-assessing to a
 * new level switches the fee. The billing cron re-applies it every month. Distinct
 * "Level of Care Fee" line — separate from the Charge Library's Room & Board.
 *
 * Migration-free: pricing is a JSON array in the app-setting `loc_pricing`.
 */

import { useMemo, useState } from "react";
import { Layers, Save, RefreshCw, Info } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { CHARGE_CATEGORIES } from "@/lib/billingLibrary";
import { LOC_PRICING_KEY, parseLocPricing, type LocPrice } from "@/lib/locBilling";

const peso = (n: number) => `₱${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function LocPricingBoard() {
  const { data: settingRows, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const saved = useMemo(() => parseLocPricing(settingRows.find((r) => (r.key || r.id) === LOC_PRICING_KEY)?.value), [settingRows]);
  const [rows, setRows] = useState<LocPrice[]>(saved);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);

  // Adjust state during render (not in an effect) when the store updates and the
  // user has no unsaved edits — keeps the table in sync without cascading renders.
  const [syncedFrom, setSyncedFrom] = useState(saved);
  if (!dirty && syncedFrom !== saved) { setSyncedFrom(saved); setRows(saved); }

  const setRow = (level: number, patch: Partial<LocPrice>) => { setDirty(true); setRows((prev) => prev.map((r) => (r.level === level ? { ...r, ...patch } : r))); };

  const save = async () => {
    setSaving(true);
    try {
      await upsertRecord("app-settings", LOC_PRICING_KEY, { key: LOC_PRICING_KEY, value: JSON.stringify(rows) });
      await refetch();
      setDirty(false);
      Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Level-of-Care pricing saved", showConfirmButton: false, timer: 1600 });
    } finally { setSaving(false); }
  };

  // Backfill this month's fees for all residents at their current approved level.
  const postNow = async () => {
    const c = await Swal.fire({ title: "Post this month's Level-of-Care fees?", text: "Applies each active resident's fee for their current approved level. Safe to run repeatedly — it never double-charges.", icon: "question", showCancelButton: true, confirmButtonText: "Post now", confirmButtonColor: "#0d9488" });
    if (!c.isConfirmed) return;
    setPosting(true);
    try {
      const res = await fetch("/api/cron/billing", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed");
      Swal.fire({ icon: "success", title: "Posted", text: `${json.loc ?? 0} Level-of-Care fee(s) posted this month.` });
    } catch (e) {
      Swal.fire({ icon: "error", title: "Could not post", text: e instanceof Error ? e.message : "Try again." });
    } finally { setPosting(false); }
  };

  const activeCount = rows.filter((r) => r.active && r.amount > 0).length;

  return (
    <div className="min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 flex items-center gap-2"><Layers className="w-6 h-6 text-teal-600" /> Level of Care Pricing</h1>
          <p className="text-sm text-slate-500 mt-1">A monthly fee per acuity Level (1–5). Charged automatically when a resident&apos;s level is approved, and switched on re-assessment.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={postNow} disabled={posting} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"><RefreshCw className={`w-4 h-4 ${posting ? "animate-spin" : ""}`} /> Post this month now</button>
          <button onClick={save} disabled={saving || !dirty} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50"><Save className="w-4 h-4" /> {saving ? "Saving…" : "Save Pricing"}</button>
        </div>
      </div>

      <div className="rounded-xl bg-teal-50 border border-teal-100 px-4 py-3 mb-5 flex items-start gap-2 text-sm text-teal-800">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <p>Set a price and toggle <b>Active</b> for each level you bill. Inactive levels (or ₱0) post no charge. This fee is a <b>separate line item</b> from your Charge Library Room &amp; Board templates — price it as a care surcharge to avoid overlap. Currently active: <b>{activeCount}/5</b>.</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="text-left text-white" style={{ backgroundColor: "#2E4A48" }}>
                <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-wider">Level</th>
                <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-wider">Invoice Label</th>
                <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-wider">Category</th>
                <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-wider">Monthly Fee</th>
                <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-center">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.level} className="hover:bg-slate-50/60">
                  <td className="px-6 py-3.5 align-middle">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-teal-100 text-teal-800 font-bold">{r.level}</span>
                  </td>
                  <td className="px-6 py-3.5 align-middle">
                    <input value={r.label} onChange={(e) => setRow(r.level, { label: e.target.value })} className="w-full min-w-[220px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-teal-400/40" />
                  </td>
                  <td className="px-6 py-3.5 align-middle">
                    <select value={r.category} onChange={(e) => setRow(r.level, { category: e.target.value })} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-teal-400/40">
                      {CHARGE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-6 py-3.5 align-middle">
                    <div className="relative w-40">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                      <input inputMode="decimal" value={r.amount ? String(r.amount) : ""} onChange={(e) => setRow(r.level, { amount: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })} placeholder="0.00" className="w-full pl-7 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-teal-400/40 tabular-nums" />
                      <p className="text-[11px] text-slate-400 mt-1">{peso(r.amount)}/mo</p>
                    </div>
                  </td>
                  <td className="px-6 py-3.5 align-middle text-center">
                    <button type="button" onClick={() => setRow(r.level, { active: !r.active })} aria-pressed={r.active} className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${r.active ? "bg-teal-600" : "bg-slate-300"}`}>
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${r.active ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
