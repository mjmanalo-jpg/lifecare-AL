"use client";

import { useMemo, useState } from "react";
import { Search, Plus, X, Trash2, Loader2, TestTube, ShieldAlert, AlertTriangle } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, deleteRecord } from "@/lib/api";

/* eslint-disable @typescript-eslint/no-explicit-any */
const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-400 focus:border-transparent outline-none text-sm";
const labelCls = "block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1";
const str = (v: unknown, d = "") => (typeof v === "string" ? v : v == null ? d : String(v));
const fmtDate = (v: unknown) => { const s = str(v); return s ? new Date(s).toLocaleDateString() : "—"; };

const SEVERITY_BADGE: Record<string, string> = {
  MILD: "bg-yellow-100 text-yellow-700", MODERATE: "bg-orange-100 text-orange-700",
  SEVERE: "bg-red-100 text-red-700", LIFE_THREATENING: "bg-red-200 text-red-800",
};
const FLAG_BADGE: Record<string, string> = {
  NORMAL: "bg-green-100 text-green-700", LOW: "bg-blue-100 text-blue-700",
  HIGH: "bg-orange-100 text-orange-700", CRITICAL: "bg-red-100 text-red-700", ABNORMAL: "bg-amber-100 text-amber-700",
};

export default function LabsAllergiesBoard({ readOnly = false }: { readOnly?: boolean }) {
  const resQ = useLiveQuery("residents", { query: "take=300", tables: ["Resident"] });
  const labQ = useLiveQuery<any>("lab-results", { query: "take=500", tables: ["LabResult"] });
  const allergyQ = useLiveQuery<any>("allergies", { query: "take=500", tables: ["Allergy"] });
  const commQ = useLiveQuery<any>("communities", { query: "take=20", tables: ["Community"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const resMap = useMemo(() => new Map(residents.map((r) => [r.id, r])), [residents]);
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [showLab, setShowLab] = useState(false);
  const [showAllergy, setShowAllergy] = useState(false);

  const communityIdFor = (residentId: string) =>
    str(resMap.get(residentId)?.raw?.communityId) || str((commQ.data || [])[0]?.id) || "";

  const filteredResidents = useMemo(() => {
    if (!search) return residents;
    const q = search.toLowerCase();
    return residents.filter((r) => r.name?.toLowerCase().includes(q) || String(r.room).toLowerCase().includes(q));
  }, [residents, search]);

  const labs = useMemo(() => (labQ.data || []).filter((l: any) => l.residentId === selected)
    .sort((a: any, b: any) => new Date(b.resultedAt || b.createdAt).getTime() - new Date(a.resultedAt || a.createdAt).getTime()), [labQ.data, selected]);
  const allergies = useMemo(() => (allergyQ.data || []).filter((a: any) => a.residentId === selected), [allergyQ.data, selected]);

  const removeLab = async (id: string) => { const r = await Swal.fire({ title: "Delete lab result?", icon: "warning", showCancelButton: true, confirmButtonColor: "#dc2626" }); if (r.isConfirmed) { await deleteRecord("lab-results", id); await labQ.refetch(); } };
  const removeAllergy = async (id: string) => { const r = await Swal.fire({ title: "Delete allergy?", icon: "warning", showCancelButton: true, confirmButtonColor: "#dc2626" }); if (r.isConfirmed) { await deleteRecord("allergies", id); await allergyQ.refetch(); } };

  // ── Resident picker ──
  if (!selected) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2"><TestTube className="w-5 h-5 text-teal-600" /> Labs &amp; Allergies</h2>
          <p className="text-xs text-gray-500 mt-0.5">Lab/diagnostic results and structured allergy records per resident</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resident name or room…" className={inputCls + " pl-10"} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredResidents.map((r) => {
              const allergyCount = (allergyQ.data || []).filter((a: any) => a.residentId === r.id).length;
              return (
                <button key={r.id} onClick={() => setSelected(r.id)} className="text-left p-4 border-2 rounded-xl hover:border-teal-400 hover:bg-teal-50 transition-all">
                  <p className="font-semibold text-gray-900 truncate">{r.name}</p>
                  <p className="text-xs text-gray-500">Room {r.room}{allergyCount ? <span className="ml-2 text-red-600 font-semibold">⚠ {allergyCount} allerg{allergyCount === 1 ? "y" : "ies"}</span> : ""}</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const current = resMap.get(selected);
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <button onClick={() => setSelected("")} className="text-gray-500 hover:text-gray-700 text-sm">← Back</button>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2"><TestTube className="w-5 h-5 text-teal-600" /> {current?.name}</h2>
          <span className="text-xs text-gray-400">Room {current?.room}</span>
        </div>
      </div>

      {/* Allergies */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-red-500" /> Allergies</h3>
          {!readOnly && <button onClick={() => setShowAllergy(true)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add</button>}
        </div>
        {allergies.length === 0 ? <p className="text-sm text-gray-400">No documented allergies.</p> : (
          <div className="space-y-2">
            {allergies.map((a: any) => (
              <div key={a.id} className="flex items-start justify-between gap-3 border border-gray-100 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 flex items-center gap-2">{str(a.allergen)}
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${SEVERITY_BADGE[str(a.severity)] || "bg-gray-100 text-gray-600"}`}>{str(a.severity)}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600">{str(a.type)}</span>
                  </p>
                  {str(a.reaction) && <p className="text-xs text-gray-500">Reaction: {str(a.reaction)}</p>}
                </div>
                {!readOnly && <button onClick={() => removeAllergy(a.id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 className="w-3.5 h-3.5" /></button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lab results */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2"><TestTube className="w-4 h-4 text-teal-500" /> Lab &amp; Diagnostic Results</h3>
          {!readOnly && <button onClick={() => setShowLab(true)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add</button>}
        </div>
        {labs.length === 0 ? <p className="text-sm text-gray-400">No lab results recorded.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-1.5 pr-3">Test</th><th className="py-1.5 pr-3">Result</th><th className="py-1.5 pr-3">Reference</th><th className="py-1.5 pr-3">Flag</th><th className="py-1.5 pr-3">Resulted</th>{!readOnly && <th />}</tr></thead>
              <tbody className="divide-y divide-gray-50">
                {labs.map((l: any) => (
                  <tr key={l.id}>
                    <td className="py-2 pr-3"><span className="font-medium text-gray-900">{str(l.testName)}</span>{str(l.category) && <span className="block text-[11px] text-gray-400">{str(l.category)}</span>}</td>
                    <td className="py-2 pr-3 text-gray-800">{str(l.value)} {str(l.unit)}</td>
                    <td className="py-2 pr-3 text-gray-500 text-xs">{str(l.referenceRange) || "—"}</td>
                    <td className="py-2 pr-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${FLAG_BADGE[str(l.flag)] || "bg-gray-100 text-gray-600"}`}>{str(l.flag) || "—"}</span></td>
                    <td className="py-2 pr-3 text-gray-500 text-xs whitespace-nowrap">{fmtDate(l.resultedAt || l.createdAt)}</td>
                    {!readOnly && <td className="py-2"><button onClick={() => removeLab(l.id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 className="w-3.5 h-3.5" /></button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAllergy && <AllergyModal residentId={selected} communityId={communityIdFor(selected)} onClose={() => setShowAllergy(false)} onSaved={async () => { setShowAllergy(false); await allergyQ.refetch(); }} />}
      {showLab && <LabModal residentId={selected} communityId={communityIdFor(selected)} onClose={() => setShowLab(false)} onSaved={async () => { setShowLab(false); await labQ.refetch(); }} />}
    </div>
  );
}

function ModalShell({ title, icon: Icon, onClose, children }: { title: string; icon: any; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-teal-600 text-white px-5 py-4 flex items-center justify-between">
          <h3 className="font-bold flex items-center gap-2"><Icon className="w-5 h-5" /> {title}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function AllergyModal({ residentId, communityId, onClose, onSaved }: { residentId: string; communityId: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ allergen: "", type: "DRUG", severity: "MODERATE", reaction: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!f.allergen.trim()) { Swal.fire("Allergen required", "", "warning"); return; }
    setSaving(true);
    try { await createRecord("allergies", { residentId, communityId: communityId || null, allergen: f.allergen.trim(), type: f.type, severity: f.severity, reaction: f.reaction.trim() || null, notes: f.notes.trim() || null }); onSaved(); }
    catch (err) { setSaving(false); Swal.fire("Save failed", err instanceof Error ? err.message : String(err), "error"); }
  };
  return (
    <ModalShell title="Add Allergy" icon={ShieldAlert} onClose={onClose}>
      <div><label className={labelCls}>Allergen *</label><input className={inputCls} value={f.allergen} onChange={(e) => setF({ ...f, allergen: e.target.value })} placeholder="e.g. Penicillin, Peanuts" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>Type</label><select className={inputCls} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{["DRUG", "FOOD", "ENVIRONMENTAL", "OTHER"].map((t) => <option key={t}>{t}</option>)}</select></div>
        <div><label className={labelCls}>Severity</label><select className={inputCls} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>{["MILD", "MODERATE", "SEVERE", "LIFE_THREATENING"].map((t) => <option key={t}>{t}</option>)}</select></div>
      </div>
      <div><label className={labelCls}>Reaction</label><input className={inputCls} value={f.reaction} onChange={(e) => setF({ ...f, reaction: e.target.value })} placeholder="e.g. Hives, anaphylaxis" /></div>
      <div><label className={labelCls}>Notes</label><textarea className={inputCls} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      <div className="flex justify-end gap-2 pt-1"><button onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancel</button><button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />} Save Allergy</button></div>
    </ModalShell>
  );
}

function LabModal({ residentId, communityId, onClose, onSaved }: { residentId: string; communityId: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ testName: "", category: "Chemistry", value: "", unit: "", referenceRange: "", flag: "NORMAL", specimen: "", orderingProvider: "", collectedAt: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!f.testName.trim() || !f.value.trim()) { Swal.fire("Test name and result required", "", "warning"); return; }
    setSaving(true);
    try {
      await createRecord("lab-results", {
        residentId, communityId: communityId || null, testName: f.testName.trim(), category: f.category,
        value: f.value.trim(), unit: f.unit.trim() || null, referenceRange: f.referenceRange.trim() || null,
        flag: f.flag, status: "RESULTED", specimen: f.specimen.trim() || null, orderingProvider: f.orderingProvider.trim() || null,
        collectedAt: f.collectedAt ? new Date(f.collectedAt).toISOString() : null,
        resultedAt: new Date().toISOString(), notes: f.notes.trim() || null,
      });
      onSaved();
    } catch (err) { setSaving(false); Swal.fire("Save failed", err instanceof Error ? err.message : String(err), "error"); }
  };
  return (
    <ModalShell title="Add Lab Result" icon={TestTube} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>Test name *</label><input className={inputCls} value={f.testName} onChange={(e) => setF({ ...f, testName: e.target.value })} placeholder="e.g. Hemoglobin A1c" /></div>
        <div><label className={labelCls}>Category</label><select className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{["Hematology", "Chemistry", "Microbiology", "Urinalysis", "Imaging", "Other"].map((t) => <option key={t}>{t}</option>)}</select></div>
        <div><label className={labelCls}>Result *</label><input className={inputCls} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder="e.g. 6.8" /></div>
        <div><label className={labelCls}>Unit</label><input className={inputCls} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="%, mg/dL…" /></div>
        <div><label className={labelCls}>Reference range</label><input className={inputCls} value={f.referenceRange} onChange={(e) => setF({ ...f, referenceRange: e.target.value })} placeholder="4.0–5.6 %" /></div>
        <div><label className={labelCls}>Flag</label><select className={inputCls} value={f.flag} onChange={(e) => setF({ ...f, flag: e.target.value })}>{["NORMAL", "LOW", "HIGH", "CRITICAL", "ABNORMAL"].map((t) => <option key={t}>{t}</option>)}</select></div>
        <div><label className={labelCls}>Ordering provider</label><input className={inputCls} value={f.orderingProvider} onChange={(e) => setF({ ...f, orderingProvider: e.target.value })} /></div>
        <div><label className={labelCls}>Collected</label><input type="date" className={inputCls} value={f.collectedAt} onChange={(e) => setF({ ...f, collectedAt: e.target.value })} /></div>
      </div>
      <div><label className={labelCls}>Notes</label><textarea className={inputCls} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      <div className="flex justify-end gap-2 pt-1"><button onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancel</button><button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <TestTube className="w-4 h-4" />} Save Result</button></div>
    </ModalShell>
  );
}
