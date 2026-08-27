"use client";

import { useState } from "react";
import { Syringe, Plus, X, Pencil } from "lucide-react";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

// Editable vaccination list backed by the `vaccinations` model. Viewers see a
// read-only list; Nurse / Care Manager / Super Admin can add, edit, and remove.

type V = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const STATUSES = ["COMPLETED", "SCHEDULED", "OVERDUE", "DECLINED", "EXEMPTED"];
const STATUS_META: Record<string, string> = {
  COMPLETED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  SCHEDULED: "bg-blue-100 text-blue-700 border-blue-200",
  OVERDUE: "bg-red-100 text-red-700 border-red-200",
  DECLINED: "bg-gray-100 text-gray-600 border-gray-200",
  EXEMPTED: "bg-amber-100 text-amber-700 border-amber-200",
};
const fmtDate = (v: unknown) => { const d = v ? new Date(s(v)) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString() : ""; };
const EMPTY = { vaccineName: "", doseNumber: "", dateGiven: "", status: "COMPLETED" };

export default function VaccinesPanel({ residentId, vaccines, canEdit, onChanged }: {
  residentId: string; vaccines: V[]; canEdit: boolean; onChanged: () => void | Promise<void>;
}) {
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [editId, setEditId] = useState("");
  const [busy, setBusy] = useState(false);

  const openAdd = () => { setEditId(""); setForm({ ...EMPTY }); };
  const openEdit = (v: V) => { setEditId(s(v.id)); setForm({ vaccineName: s(v.vaccineName) || s(v.vaccineType), doseNumber: s(v.doseNumber), dateGiven: s(v.dateGiven).slice(0, 10), status: s(v.status) || "COMPLETED" }); };
  const cancel = () => { setForm(null); setEditId(""); };

  const save = async () => {
    if (!form || !form.vaccineName.trim()) return;
    setBusy(true);
    try {
      const body = {
        residentId,
        vaccineName: form.vaccineName.trim(),
        doseNumber: form.doseNumber ? Number(form.doseNumber) : null,
        dateGiven: form.dateGiven ? new Date(form.dateGiven).toISOString() : null,
        status: form.status,
      };
      if (editId) await updateRecord("vaccinations", editId, body);
      else await createRecord("vaccinations", body);
      await onChanged();
      cancel();
    } catch { /* keep the form open on failure */ } finally { setBusy(false); }
  };
  const remove = async (id: string) => { setBusy(true); try { await deleteRecord("vaccinations", id); await onChanged(); } catch { /* noop */ } finally { setBusy(false); } };

  const inputCls = "w-full rounded-md border border-gray-300 px-2 py-1 text-sm";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-gray-900"><Syringe className="h-4 w-4 text-[#2E4A48]" /> Vaccinations ({vaccines.length})</h3>
        {canEdit && !form && <button onClick={openAdd} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2E4A48] hover:underline"><Plus className="h-3.5 w-3.5" /> Add</button>}
      </div>

      {vaccines.length === 0 && !form ? <p className="text-sm text-gray-400">No vaccination records.</p> : (
        <ul className="space-y-2">
          {vaccines.map((v) => (
            <li key={s(v.id)} className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 p-2.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{s(v.vaccineName) || s(v.vaccineType) || "Vaccine"}</p>
                <p className="mt-0.5 text-xs text-gray-500">{[v.doseNumber ? `Dose ${s(v.doseNumber)}${v.totalDoses ? `/${s(v.totalDoses)}` : ""}` : "", v.dateGiven ? `Given ${fmtDate(v.dateGiven)}` : v.scheduledDate ? `Scheduled ${fmtDate(v.scheduledDate)}` : ""].filter(Boolean).join(" · ") || "—"}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${STATUS_META[s(v.status)] || STATUS_META.SCHEDULED}`}>{s(v.status).replace(/_/g, " ") || "—"}</span>
                {canEdit && <>
                  <button onClick={() => openEdit(v)} aria-label="Edit vaccine" className="text-gray-300 hover:text-[#2E4A48]"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => remove(s(v.id))} disabled={busy} aria-label="Remove vaccine" className="text-gray-300 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
                </>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {form && (
        <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{editId ? "Edit vaccination" : "Add vaccination"}</p>
          <input value={form.vaccineName} onChange={(e) => setForm({ ...form, vaccineName: e.target.value })} placeholder="Vaccine name *" className={inputCls} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input value={form.doseNumber} onChange={(e) => setForm({ ...form, doseNumber: e.target.value })} placeholder="Dose #" inputMode="numeric" className={inputCls} />
            <input type="date" value={form.dateGiven} onChange={(e) => setForm({ ...form, dateGiven: e.target.value })} className={inputCls} />
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>{STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}</select>
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <button onClick={save} disabled={busy || !form.vaccineName.trim()} className="rounded-md bg-[#2E4A48] px-3 py-1 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
            <button onClick={cancel} className="text-xs font-medium text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
