"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, Save, RefreshCw, Download, FileSpreadsheet, Library, Settings2, ShieldAlert, Loader2, Repeat } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import {
  BILLING_LIBRARY_KEY, BILLING_SETTINGS_KEY, BILLING_DISPUTES_KEY,
  CHARGE_CATEGORIES, CARE_LEVEL_OPTIONS, SEED_TEMPLATES,
  parseTemplates, parseBillingSettings, parseDisputes,
  type ChargeTemplate, type BillingSettings, newId,
} from "@/lib/billingLibrary";
import { buildGlTxns, toGeneralLedgerCsv, toQuickBooksIIF, downloadText } from "@/lib/glExport";

type SettingRow = { id: string; key?: string; value: string };
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white";

export default function BillingLibraryTab() {
  const { data: settingRows, refetch } = useLiveQuery<SettingRow>("app-settings", { tables: ["AppSetting"] });
  const { data: invoiceRows } = useLiveQuery<Record<string, unknown>>("invoices", { query: "take=1000", tables: ["Invoice"] });
  const { data: paymentRows } = useLiveQuery<Record<string, unknown>>("payments", { query: "take=1000", tables: ["Payment"] });
  const { data: residentRows } = useLiveQuery<Record<string, unknown>>("residents", { query: "take=500", tables: ["Resident"] });

  const rowFor = (key: string) => settingRows.find((r) => (r.key || r.id) === key)?.value;
  const templates = useMemo(() => parseTemplates(rowFor(BILLING_LIBRARY_KEY)), [settingRows]);
  const settings = useMemo(() => parseBillingSettings(rowFor(BILLING_SETTINGS_KEY)), [settingRows]);
  const disputes = useMemo(() => parseDisputes(rowFor(BILLING_DISPUTES_KEY)), [settingRows]);

  const [draftTemplates, setDraftTemplates] = useState<ChargeTemplate[] | null>(null);
  const [draftSettings, setDraftSettings] = useState<BillingSettings | null>(null);
  const [savingT, setSavingT] = useState(false);
  const [savingS, setSavingS] = useState(false);
  const [running, setRunning] = useState(false);

  const tpl = draftTemplates ?? templates;
  const set = draftSettings ?? settings;

  const residentName = (id: string | null | undefined) => {
    const r = residentRows.find((x) => String(x.id) === String(id));
    return r ? `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || "Resident" : "Resident";
  };
  const invoiceNumberById = (id: string) => String(invoiceRows.find((x) => String(x.id) === id)?.invoiceNumber ?? id.slice(0, 8));

  const saveTemplates = async (next: ChargeTemplate[]) => {
    setSavingT(true);
    try {
      await upsertRecord("app-settings", BILLING_LIBRARY_KEY, { key: BILLING_LIBRARY_KEY, value: JSON.stringify(next) });
      setDraftTemplates(null);
      await refetch();
      Swal.fire({ title: "Charge library saved", icon: "success", timer: 1200, showConfirmButton: false });
    } catch (e) {
      Swal.fire({ title: "Save failed", text: e instanceof Error ? e.message : "Try again", icon: "error" });
    } finally { setSavingT(false); }
  };

  const saveSettings = async (next: BillingSettings) => {
    setSavingS(true);
    try {
      await upsertRecord("app-settings", BILLING_SETTINGS_KEY, { key: BILLING_SETTINGS_KEY, value: JSON.stringify(next) });
      setDraftSettings(null);
      await refetch();
      Swal.fire({ title: "Settings saved", icon: "success", timer: 1200, showConfirmButton: false });
    } catch (e) {
      Swal.fire({ title: "Save failed", text: e instanceof Error ? e.message : "Try again", icon: "error" });
    } finally { setSavingS(false); }
  };

  const addTemplate = () => setDraftTemplates([...(tpl), { id: newId(), name: "", category: CHARGE_CATEGORIES[0], amount: 0, careLevel: "ALL", recurring: false }]);
  const patchTemplate = (id: string, patch: Partial<ChargeTemplate>) => setDraftTemplates(tpl.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const removeTemplate = (id: string) => setDraftTemplates(tpl.filter((t) => t.id !== id));

  const runRecurring = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/cron/billing", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      Swal.fire({ title: "Recurring charges posted", text: `${j.created} charge(s) created, ${j.skipped} already existed across ${j.residents} residents.`, icon: "success" });
    } catch (e) {
      Swal.fire({ title: "Couldn't run", text: e instanceof Error ? e.message : "Try again", icon: "error" });
    } finally { setRunning(false); }
  };

  const exportGl = (kind: "csv" | "iif") => {
    const txns = buildGlTxns(invoiceRows as never, paymentRows as never, set.glAccounts, residentName, invoiceNumberById);
    if (!txns.length) { Swal.fire({ title: "Nothing to export", text: "No posted invoices or payments yet.", icon: "info" }); return; }
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === "csv") downloadText(`gl-export-${stamp}.csv`, toGeneralLedgerCsv(txns), "text/csv");
    else downloadText(`quickbooks-${stamp}.iif`, toQuickBooksIIF(txns), "text/plain");
  };

  const templatesDirty = draftTemplates !== null;
  const settingsDirty = draftSettings !== null;

  return (
    <div className="space-y-6">
      {/* ── Charge Library ── */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Library className="w-5 h-5 text-blue-600" /> Customizable Charge Library</h3>
          <div className="flex items-center flex-wrap gap-2">
            {templates.length === 0 && !templatesDirty && (
              <button onClick={() => setDraftTemplates(SEED_TEMPLATES.map((t) => ({ ...t, id: newId() })))} className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50">Load starter templates</button>
            )}
            <button onClick={addTemplate} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"><Plus className="w-4 h-4" /> Add template</button>
            {templatesDirty && <button onClick={() => void saveTemplates(tpl.filter((t) => t.name.trim()))} disabled={savingT} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{savingT ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save</button>}
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-3">Reusable charge templates by care level. Recurring templates (rent, monthly care fees) are auto-posted each month by the accrual run below.</p>
        {tpl.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">No templates yet. Add one or load the starter set.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs font-semibold text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-2">Name</th><th className="px-2">Category</th><th className="px-2">Care level</th><th className="px-2 text-right">Amount (₱)</th><th className="px-2 text-center">Recurring</th><th></th>
              </tr></thead>
              <tbody>
                {tpl.map((t) => (
                  <tr key={t.id} className="border-b border-gray-100">
                    <td className="py-2 pr-2"><input className={inputCls} value={t.name} onChange={(e) => patchTemplate(t.id, { name: e.target.value })} placeholder="e.g. Monthly Room & Board" /></td>
                    <td className="px-2"><select className={inputCls} value={t.category} onChange={(e) => patchTemplate(t.id, { category: e.target.value })}>{CHARGE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></td>
                    <td className="px-2"><select className={inputCls} value={t.careLevel} onChange={(e) => patchTemplate(t.id, { careLevel: e.target.value })}>{CARE_LEVEL_OPTIONS.map((c) => <option key={c} value={c}>{c === "ALL" ? "All levels" : c[0] + c.slice(1).toLowerCase()}</option>)}</select></td>
                    <td className="px-2"><input type="number" className={inputCls + " text-right"} value={t.amount} onChange={(e) => patchTemplate(t.id, { amount: Number(e.target.value) })} /></td>
                    <td className="px-2 text-center"><input type="checkbox" className="w-5 h-5 accent-blue-600" checked={t.recurring} onChange={(e) => patchTemplate(t.id, { recurring: e.target.checked })} /></td>
                    <td className="px-1 text-right"><button onClick={() => removeTemplate(t.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Recurring accrual + GL export ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-2"><Repeat className="w-5 h-5 text-emerald-600" /> Recurring charge accrual</h3>
          <p className="text-xs text-gray-500 mb-4">Posts this month&apos;s recurring charges (rent, care fees) for every active resident from the templates above. Safe to run repeatedly — it never double-charges.</p>
          <button onClick={() => void runRecurring()} disabled={running} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60">{running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Post recurring charges now</button>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-2"><FileSpreadsheet className="w-5 h-5 text-indigo-600" /> General Ledger export</h3>
          <p className="text-xs text-gray-500 mb-4">Balanced double-entry export of invoices &amp; payments for QuickBooks / Sage Intacct, mapped to your GL accounts.</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => exportGl("csv")} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50"><Download className="w-4 h-4" /> QuickBooks / Sage CSV</button>
            <button onClick={() => exportGl("iif")} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50"><Download className="w-4 h-4" /> QuickBooks .IIF</button>
          </div>
        </section>
      </div>

      {/* ── Settings: GL accounts + online payments ── */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Settings2 className="w-5 h-5 text-gray-600" /> Billing settings</h3>
          {settingsDirty && <button onClick={() => void saveSettings(set)} disabled={savingS} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{savingS ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save</button>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-xs font-medium text-gray-600">GL — Revenue account<input className={inputCls + " mt-1"} value={set.glAccounts.revenue} onChange={(e) => setDraftSettings({ ...set, glAccounts: { ...set.glAccounts, revenue: e.target.value } })} /></label>
          <label className="text-xs font-medium text-gray-600">GL — Accounts Receivable<input className={inputCls + " mt-1"} value={set.glAccounts.ar} onChange={(e) => setDraftSettings({ ...set, glAccounts: { ...set.glAccounts, ar: e.target.value } })} /></label>
          <label className="text-xs font-medium text-gray-600">GL — Cash / Deposit account<input className={inputCls + " mt-1"} value={set.glAccounts.cash} onChange={(e) => setDraftSettings({ ...set, glAccounts: { ...set.glAccounts, cash: e.target.value } })} /></label>
        </div>
        <label className="mt-4 flex items-center justify-between rounded-lg border border-gray-200 p-3">
          <span><b className="block text-sm text-gray-800">Online family payments {set.onlinePaymentsEnabled ? "" : "(gated off)"}</b><span className="text-xs text-gray-500">Enable card / auto-pay checkout once your payment provider is approved.</span></span>
          <input type="checkbox" className="w-5 h-5 accent-emerald-600" checked={set.onlinePaymentsEnabled} onChange={(e) => setDraftSettings({ ...set, onlinePaymentsEnabled: e.target.checked })} />
        </label>
        <p className="mt-2 text-xs text-gray-500">Auto-pay enrolled residents: {settings.autopayResidentIds.length} — enroll from a resident&apos;s statement.</p>
      </section>

      {/* ── Disputes / chargebacks ── */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-3"><ShieldAlert className="w-5 h-5 text-rose-600" /> Disputes &amp; chargebacks ({disputes.length})</h3>
        {disputes.length === 0 ? (
          <p className="text-sm text-gray-400">No disputes recorded. Raise one from an invoice&apos;s actions.</p>
        ) : (
          <div className="space-y-2">
            {disputes.slice().reverse().map((d) => (
              <div key={d.id} className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{d.invoiceNumber} · ₱{d.amount.toLocaleString()}</p>
                  <p className="text-xs text-gray-600">{d.reason}</p>
                  <p className="text-[11px] text-gray-400">{d.by} · {new Date(d.at).toLocaleString()}</p>
                </div>
                <span className={`shrink-0 px-2 py-1 rounded-full text-xs font-semibold ${d.status === "CHARGEBACK" ? "bg-rose-100 text-rose-700" : d.status === "RESOLVED" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{d.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
