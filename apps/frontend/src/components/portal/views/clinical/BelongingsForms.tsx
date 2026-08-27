"use client";

import { useEffect, useState } from "react";
import { Package, Plus, X, Printer } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import {
  BELONGINGS_FORMS_KEY, parseBelongingsForms, formsFor, newInventoryRow, newChecklistItem, rowTotal,
  type BelongingsForms as Forms, type InventoryForm,
} from "@/lib/belongingsForms";

type InvKey = "assistiveDevices" | "belongings" | "clothing";
type TabKey = "moveIn" | InvKey;
const TABS: { key: TabKey; label: string }[] = [
  { key: "moveIn", label: "Move-In Checklist" },
  { key: "assistiveDevices", label: "Assistive Devices" },
  { key: "belongings", label: "Personal Belongings" },
  { key: "clothing", label: "Clothing" },
];
const INV_TITLE: Record<InvKey, string> = { assistiveDevices: "Assistive Device Inventory", belongings: "Residents Personal Belongings", clothing: "Clothing Inventory" };
const s = (v: unknown) => (v == null ? "" : String(v));
const esc = (v: unknown): string => s(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

const cell = "w-full rounded border border-gray-300 px-1.5 py-1 text-sm";

export default function BelongingsFormsPanel({ residentId, residentName, room, canEdit }: {
  residentId: string; residentName: string; room: string; canEdit: boolean;
}) {
  const { data: rows, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const stored = parseBelongingsForms(rows.find((r) => (r.key || r.id) === BELONGINGS_FORMS_KEY)?.value);

  const [forms, setForms] = useState<Forms>(() => formsFor(stored, residentId));
  const [tab, setTab] = useState<TabKey>("moveIn");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Refresh from store only while the user isn't mid-edit.
  useEffect(() => { if (!dirty) setForms(formsFor(stored, residentId)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [rows, residentId]);

  const update = (fn: (f: Forms) => Forms) => { setForms(fn); setDirty(true); };
  const patchInv = (k: InvKey, fn: (inv: InventoryForm) => InventoryForm) => update((f) => ({ ...f, [k]: fn(f[k]) }));

  const save = async () => {
    setSaving(true);
    try {
      const next = { ...stored, [residentId]: { ...forms, updatedAt: new Date().toISOString() } };
      await upsertRecord("app-settings", BELONGINGS_FORMS_KEY, { key: BELONGINGS_FORMS_KEY, value: JSON.stringify(next) });
      await refetch();
      setDirty(false);
    } finally { setSaving(false); }
  };

  const printForm = () => {
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) return;
    w.document.write(buildFormHtml(tab, forms, residentName, room));
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500"><Package className="h-3.5 w-3.5" /> Belongings Forms</p>
        <div className="flex items-center gap-2">
          <button onClick={printForm} className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"><Printer className="h-3.5 w-3.5" /> Print</button>
          {canEdit && <button onClick={save} disabled={saving || !dirty} className="inline-flex items-center gap-1 rounded-md bg-[#2E4A48] px-2.5 py-1 text-[11px] font-semibold text-white hover:brightness-110 disabled:opacity-50">{saving ? "Saving…" : dirty ? "Save" : "Saved"}</button>}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${tab === t.key ? "bg-[#2E4A48] text-white" : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"}`}>{t.label}</button>
        ))}
      </div>

      {tab === "moveIn" ? (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-sm">
            <div><span className="text-[10px] font-bold uppercase text-gray-400">Resident</span><p className="font-semibold text-gray-800">{residentName || "—"}</p></div>
            <div><span className="text-[10px] font-bold uppercase text-gray-400">Room No.</span><p className="font-semibold text-gray-800">{room || "—"}</p></div>
            <label className="block"><span className="text-[10px] font-bold uppercase text-gray-400">Move-in Date</span><input type="date" disabled={!canEdit} value={s(forms.moveIn.moveInDate)} onChange={(e) => update((f) => ({ ...f, moveIn: { ...f.moveIn, moveInDate: e.target.value } }))} className={cell} /></label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead><tr className="text-left text-[10px] font-bold uppercase text-gray-500"><th className="w-8 py-1"></th><th className="py-1">Particular</th><th className="w-20 py-1">Quantity</th><th className="w-40 py-1">Checked By</th>{canEdit && <th className="w-6"></th>}</tr></thead>
              <tbody>
                {forms.moveIn.items.map((it) => (
                  <tr key={it.id} className="border-t border-gray-100">
                    <td className="py-1"><input type="checkbox" disabled={!canEdit} checked={!!it.checked} onChange={(e) => update((f) => ({ ...f, moveIn: { ...f.moveIn, items: f.moveIn.items.map((x) => x.id === it.id ? { ...x, checked: e.target.checked } : x) } }))} /></td>
                    <td className="py-1 pr-2 text-gray-800">{it.label || <input disabled={!canEdit} placeholder="Item" value={s(it.label)} onChange={(e) => update((f) => ({ ...f, moveIn: { ...f.moveIn, items: f.moveIn.items.map((x) => x.id === it.id ? { ...x, label: e.target.value } : x) } }))} className={cell} />}</td>
                    <td className="py-1 pr-2"><input disabled={!canEdit} value={s(it.quantity)} onChange={(e) => update((f) => ({ ...f, moveIn: { ...f.moveIn, items: f.moveIn.items.map((x) => x.id === it.id ? { ...x, quantity: e.target.value } : x) } }))} className={cell} /></td>
                    <td className="py-1 pr-2"><input disabled={!canEdit} placeholder="Name & date" value={s(it.checkedBy)} onChange={(e) => update((f) => ({ ...f, moveIn: { ...f.moveIn, items: f.moveIn.items.map((x) => x.id === it.id ? { ...x, checkedBy: e.target.value } : x) } }))} className={cell} /></td>
                    {canEdit && <td className="py-1"><button onClick={() => update((f) => ({ ...f, moveIn: { ...f.moveIn, items: f.moveIn.items.filter((x) => x.id !== it.id) } }))} aria-label="Remove item" className="text-gray-300 hover:text-red-500"><X className="h-3.5 w-3.5" /></button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canEdit && <button onClick={() => update((f) => ({ ...f, moveIn: { ...f.moveIn, items: [...f.moveIn.items, newChecklistItem()] } }))} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2E4A48] hover:underline"><Plus className="h-3 w-3" /> Add item</button>}
        </div>
      ) : (
        <InventoryTable
          form={forms[tab]}
          canEdit={canEdit}
          onField={(patch) => patchInv(tab, (inv) => ({ ...inv, ...patch }))}
          onRow={(id, patch) => patchInv(tab, (inv) => ({ ...inv, rows: inv.rows.map((r) => r.id === id ? { ...r, ...patch } : r) }))}
          onAdd={() => patchInv(tab, (inv) => ({ ...inv, rows: [...inv.rows, newInventoryRow()] }))}
          onDel={(id) => patchInv(tab, (inv) => ({ ...inv, rows: inv.rows.filter((r) => r.id !== id) }))}
        />
      )}
    </div>
  );
}

function InventoryTable({ form, canEdit, onField, onRow, onAdd, onDel }: {
  form: InventoryForm; canEdit: boolean;
  onField: (patch: Partial<InventoryForm>) => void;
  onRow: (id: string, patch: Partial<import("@/lib/belongingsForms").InventoryRow>) => void;
  onAdd: () => void; onDel: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-sm">
        <label className="block"><span className="text-[10px] font-bold uppercase text-gray-400">Covered Month / Period</span><input disabled={!canEdit} value={s(form.period)} onChange={(e) => onField({ period: e.target.value })} placeholder="e.g. July 2026" className={cell} /></label>
        <label className="block"><span className="text-[10px] font-bold uppercase text-gray-400">Prepared By</span><input disabled={!canEdit} value={s(form.preparedBy)} onChange={(e) => onField({ preparedBy: e.target.value })} className={cell} /></label>
        <label className="block"><span className="text-[10px] font-bold uppercase text-gray-400">Checked By</span><input disabled={!canEdit} value={s(form.checkedBy)} onChange={(e) => onField({ checkedBy: e.target.value })} className={cell} /></label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead><tr className="text-left text-[10px] font-bold uppercase text-gray-500">
            <th className="py-1">Particulars</th><th className="w-14 py-1">Beg</th><th className="w-14 py-1">Add</th><th className="w-14 py-1">Less</th><th className="w-14 py-1">Total</th><th className="w-16 py-1">Actual</th><th className="py-1">Remarks</th>{canEdit && <th className="w-6"></th>}
          </tr></thead>
          <tbody>
            {form.rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="py-1 pr-1"><input disabled={!canEdit} value={s(r.particulars)} onChange={(e) => onRow(r.id, { particulars: e.target.value })} className={cell} /></td>
                <td className="py-1 pr-1"><input disabled={!canEdit} value={s(r.begQty)} onChange={(e) => onRow(r.id, { begQty: e.target.value })} className={cell} inputMode="numeric" /></td>
                <td className="py-1 pr-1"><input disabled={!canEdit} value={s(r.add)} onChange={(e) => onRow(r.id, { add: e.target.value })} className={cell} inputMode="numeric" /></td>
                <td className="py-1 pr-1"><input disabled={!canEdit} value={s(r.less)} onChange={(e) => onRow(r.id, { less: e.target.value })} className={cell} inputMode="numeric" /></td>
                <td className="py-1 pr-1"><span className="block rounded bg-gray-100 px-1.5 py-1 text-center text-sm font-semibold text-gray-700">{rowTotal(r) || "—"}</span></td>
                <td className="py-1 pr-1"><input disabled={!canEdit} value={s(r.actualCount)} onChange={(e) => onRow(r.id, { actualCount: e.target.value })} className={cell} inputMode="numeric" /></td>
                <td className="py-1 pr-1"><input disabled={!canEdit} value={s(r.remarks)} onChange={(e) => onRow(r.id, { remarks: e.target.value })} className={cell} /></td>
                {canEdit && <td className="py-1"><button onClick={() => onDel(r.id)} aria-label="Remove row" className="text-gray-300 hover:text-red-500"><X className="h-3.5 w-3.5" /></button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && <button onClick={onAdd} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2E4A48] hover:underline"><Plus className="h-3 w-3" /> Add row</button>}
    </div>
  );
}

// ── Printable HTML per form ───────────────────────────────────────────────────
function buildFormHtml(tab: TabKey, forms: Forms, residentName: string, room: string): string {
  const brand = `<div class="brand"><span class="life">Life</span><span class="care">Care</span> <span class="lv">LIVING</span></div>`;
  const style = `<style>
    *{box-sizing:border-box}body{font-family:"Segoe UI",system-ui,Arial,sans-serif;color:#1f2933;margin:0 auto;max-width:800px;padding:32px 36px;font-size:13px}
    .brand{font-weight:800;font-size:18px}.brand .life{color:#2f9e44}.brand .care{color:#1c7ed6}.brand .lv{font-size:9px;letter-spacing:.2em;color:#1c7ed6}
    h1{font-size:16px;margin:12px 0 2px}.meta{margin:2px 0}.meta b{display:inline-block;min-width:150px}
    table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #adb5bd;padding:5px 7px;text-align:left;font-size:12px}
    th{background:#f1f3f5;font-size:11px;text-transform:uppercase}.c{text-align:center}
    .sign{margin-top:26px;display:flex;justify-content:space-between;gap:20px}.sign div{flex:1}.sign .l{font-size:11px;color:#495057}.sign .v{border-bottom:1px solid #495057;min-height:20px;font-weight:600}
    @page{margin:0}@media print{body{padding:20px 26px}}
  </style>`;
  const head = (title: string, period?: string, date?: string) => `${brand}<h1>${esc(title)}</h1>
    <div class="meta"><b>Resident Name:</b> ${esc(residentName)}</div>
    <div class="meta"><b>Room No.:</b> ${esc(room)}</div>
    ${date ? `<div class="meta"><b>Move-in Date:</b> ${esc(date)}</div>` : ""}
    ${period ? `<div class="meta"><b>Covered Month / Period:</b> ${esc(period)}</div>` : ""}`;

  let body = "";
  if (tab === "moveIn") {
    const rows = forms.moveIn.items.map((i) => `<tr><td class="c">${i.checked ? "✓" : ""}</td><td>${esc(i.label)}</td><td class="c">${esc(i.quantity)}</td><td>${esc(i.checkedBy)}</td></tr>`).join("");
    body = `${head("Move-In Checklist", undefined, forms.moveIn.moveInDate)}
      <table><thead><tr><th class="c" style="width:34px"></th><th>Particular</th><th style="width:90px">Quantity</th><th style="width:200px">Checked By (Name &amp; Signature)</th></tr></thead><tbody>${rows}</tbody></table>`;
  } else {
    const f = forms[tab];
    const rows = f.rows.map((r) => `<tr><td>${esc(r.particulars)}</td><td class="c">${esc(r.begQty)}</td><td class="c">${esc(r.add)}</td><td class="c">${esc(r.less)}</td><td class="c">${esc(rowTotal(r))}</td><td class="c">${esc(r.actualCount)}</td><td>${esc(r.remarks)}</td></tr>`).join("");
    body = `${head(INV_TITLE[tab], f.period)}
      <table><thead><tr><th>Particulars</th><th class="c">Beg Qty</th><th class="c">Add</th><th class="c">Less</th><th class="c">Total</th><th class="c">Actual Count</th><th>Remarks</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="sign"><div><div class="l">Prepared By:</div><div class="v">${esc(f.preparedBy)}</div></div><div><div class="l">Checked By:</div><div class="v">${esc(f.checkedBy)}</div></div></div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(residentName)} — belongings form</title>${style}</head><body>${body}</body></html>`;
}
