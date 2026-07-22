"use client";
import { useMemo, useState } from "react";
import { Pill, Plus, X, Trash2, Search, CheckCircle, Clock, AlertTriangle, AlertOctagon, Loader2 } from "lucide-react";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none text-sm";
const labelCls = "block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1";
const marStatusColors: Record<string, string> = {
  SCHEDULED: "bg-blue-100 text-blue-700",
  ADMINISTERED: "bg-green-100 text-green-700",
  REFUSED: "bg-red-100 text-red-700",
  HELD: "bg-yellow-100 text-yellow-700",
  SKIPPED: "bg-gray-100 text-gray-600",
  LATE: "bg-orange-100 text-orange-700",
};

export default function MARBoard() {
  const { data: marRows, loading, refetch } = useLiveQuery("medication-administrations", { query: "take=500", tables: ["MedicationAdministration"] });
  const { data: medRows } = useLiveQuery("medications", { query: "take=200", tables: ["Medication"] });
  const { data: resQ } = useLiveQuery("residents", { tables: ["Resident"] });
  const residents = useMemo(() => (resQ || []).map(adaptResident), [resQ]);
  const resMap = useMemo(() => new Map(residents.map((r: any) => [r.id, r])), [residents]);
  const medMap = useMemo(() => new Map((medRows || []).map((m: any) => [m.id, m])), [medRows]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [creating, setCreating] = useState(false);
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split("T")[0]);

  const today = new Date().toISOString().split("T")[0];
  const filtered = useMemo(() => {
    return (marRows || []).filter((m: any) => {
      const name = resMap.get(m.residentId)?.name || "";
      const medName = medMap.get(m.medicationId)?.name || "";
      if (filter !== "ALL" && m.marStatus !== filter) return false;
      if (dateFilter) {
        const mDate = m.administeredAt ? new Date(m.administeredAt).toISOString().split("T")[0] : null;
        if (mDate && mDate !== dateFilter) return false;
      }
      if (search && !name.toLowerCase().includes(search.toLowerCase()) && !medName.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [marRows, filter, search, resMap, medMap, dateFilter]);

  const stats = useMemo(() => {
    const todays = (marRows || []).filter((m: any) => {
      const d = m.administeredAt ? new Date(m.administeredAt).toISOString().split("T")[0] : null;
      return d === today;
    });
    return {
      administered: todays.filter((m: any) => m.marStatus === "ADMINISTERED").length,
      refused: todays.filter((m: any) => m.marStatus === "REFUSED").length,
      held: todays.filter((m: any) => m.marStatus === "HELD").length,
      scheduled: todays.filter((m: any) => m.marStatus === "SCHEDULED").length,
    };
  }, [marRows, today]);

  const handleDelete = async (id: string) => {
    const r = await Swal.fire({ title: "Delete MAR Entry?", icon: "warning", showCancelButton: true, confirmButtonColor: "#dc2626" });
    if (r.isConfirmed) { await deleteRecord("medication-administrations", id); refetch(); Swal.fire("Deleted", "", "success"); }
  };

  const markAdministered = async (id: string) => {
    await updateRecord("medication-administrations", id, { marStatus: "ADMINISTERED", administeredAt: new Date().toISOString() });
    refetch();
    Swal.fire({ icon: "success", title: "Recorded", timer: 1200, showConfirmButton: false });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><Pill className="w-5 h-5 text-yellow-500" /> Medication Administration Record</h2>
          <p className="text-sm text-gray-500">MAR tracking with dose, route, witness, and refusal logging</p>
        </div>
        <button onClick={() => setCreating(true)} className="w-full sm:w-auto px-4 py-2 rounded-lg bg-yellow-500 text-white text-sm font-semibold hover:bg-yellow-600 flex items-center justify-center gap-1.5">
          <Plus className="w-4 h-4" /> Log Administration
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Administered", value: stats.administered, icon: CheckCircle, color: "text-green-600" },
          { label: "Refused", value: stats.refused, icon: AlertOctagon, color: "text-red-600" },
          { label: "Held", value: stats.held, icon: Clock, color: "text-yellow-600" },
          { label: "Scheduled", value: stats.scheduled, icon: Clock, color: "text-blue-600" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-lg border p-3 flex items-center gap-3">
            <s.icon className={`w-5 h-5 ${s.color}`} />
            <div>
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 items-center flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by resident or medication..." className={`${inputCls} pl-9`} />
        </div>
        <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} className={`${inputCls} w-auto`} />
        <select value={filter} onChange={e => setFilter(e.target.value)} className={`${inputCls} w-auto`}>
          <option value="ALL">All Status</option>
          {Object.keys(marStatusColors).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
          <Pill className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No MAR entries found</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Resident</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Medication</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Dose / Route</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Time</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Witness</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((mar: any) => {
                  const med = medMap.get(mar.medicationId);
                  return (
                    <tr key={mar.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{resMap.get(mar.residentId)?.name || "Unknown"}</p>
                        <p className="text-xs text-gray-500">Room {resMap.get(mar.residentId)?.room || "—"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-gray-900">{med?.name || mar.medicationName || "—"}</p>
                        {med?.dosage && <p className="text-xs text-gray-500">{med.dosage}</p>}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{mar.dosage || med?.dosage || "—"} / {mar.route || med?.route || "—"}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{mar.administeredAt ? new Date(mar.administeredAt).toLocaleString() : "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${marStatusColors[mar.marStatus] || "bg-gray-100 text-gray-600"}`}>{mar.marStatus || "SCHEDULED"}</span>
                        {mar.refusedReason && <p className="text-xs text-red-500 mt-0.5">Reason: {mar.refusedReason}</p>}
                        {mar.heldReason && <p className="text-xs text-yellow-600 mt-0.5">Held: {mar.heldReason}</p>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{mar.witnessName || "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          {mar.marStatus === "SCHEDULED" && (
                            <button onClick={() => markAdministered(mar.id)} className="p-1.5 text-green-500 hover:bg-green-50 rounded cursor-pointer" title="Mark Administered">
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )}
                          <button onClick={() => handleDelete(mar.id)} className="p-1.5 text-red-400 hover:text-red-500 cursor-pointer"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating && <MARModal residents={residents} onClose={() => setCreating(false)} onSaved={() => { refetch(); setCreating(false); }} />}
    </div>
  );
}

function MARModal({ residents, onClose, onSaved }: { residents: any[]; onClose: () => void; onSaved: () => void }) {
  const { data: medRows } = useLiveQuery("medications", { query: "take=200", tables: ["Medication"] });
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    residentId: "", medicationId: "", dosage: "", route: "ORAL",
    marStatus: "ADMINISTERED", refusedReason: "", heldReason: "", witnessName: "", notes: "",
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.residentId) return;
    setSaving(true);
    try {
      await createRecord("medication-administrations", {
        ...form,
        administeredAt: new Date().toISOString(),
        medicationName: (medRows || []).find((m: any) => m.id === form.medicationId)?.name || "",
      });
      onSaved();
      Swal.fire({ icon: "success", title: "Recorded!", timer: 1500, showConfirmButton: false });
    } catch { Swal.fire("Error", "Failed", "error"); } finally { setSaving(false); }
  };

  const medsForResident = (medRows || []).filter((m: any) => !form.residentId || m.residentId === form.residentId);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-yellow-500 to-amber-500 px-6 py-4 rounded-t-xl flex items-center justify-between">
          <h3 className="text-white font-bold text-lg">Log MAR Entry</h3>
          <button onClick={onClose} className="text-white/80 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className={labelCls}>Resident *</label>
            <select value={form.residentId} onChange={e => set("residentId", e.target.value)} className={inputCls} required>
              <option value="">Select...</option>
              {residents.map((r: any) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Medication</label>
            <select value={form.medicationId} onChange={e => set("medicationId", e.target.value)} className={inputCls}>
              <option value="">Select...</option>
              {medsForResident.map((m: any) => <option key={m.id} value={m.id}>{m.name} — {m.dosage || "—"}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Dose</label><input value={form.dosage} onChange={e => set("dosage", e.target.value)} className={inputCls} placeholder="10mg" /></div>
            <div><label className={labelCls}>Route</label><select value={form.route} onChange={e => set("route", e.target.value)} className={inputCls}>
              {["ORAL", "IV", "IM", "SUBCUTANEOUS", "TOPICAL", "INHALATION", "RECTAL", "OTHER"].map(r => <option key={r} value={r}>{r}</option>)}
            </select></div>
          </div>
          <div>
            <label className={labelCls}>MAR Status *</label>
            <select value={form.marStatus} onChange={e => set("marStatus", e.target.value)} className={inputCls} required>
              {Object.keys(marStatusColors).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {form.marStatus === "REFUSED" && <div><label className={labelCls}>Refusal Reason *</label><input value={form.refusedReason} onChange={e => set("refusedReason", e.target.value)} className={inputCls} required placeholder="Why was the medication refused?" /></div>}
          {form.marStatus === "HELD" && <div><label className={labelCls}>Hold Reason *</label><input value={form.heldReason} onChange={e => set("heldReason", e.target.value)} className={inputCls} required placeholder="Why is the medication being held?" /></div>}
          <div><label className={labelCls}>Witness Name (for controlled substances)</label><input value={form.witnessName} onChange={e => set("witnessName", e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Notes</label><textarea value={form.notes} onChange={e => set("notes", e.target.value)} className={inputCls} rows={2} /></div>
          <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-3 -mx-6 -mb-6 rounded-b-xl flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 cursor-pointer">Cancel</button>
            <button type="submit" disabled={saving || !form.residentId} className="px-5 py-2 rounded-lg bg-yellow-500 text-white text-sm font-semibold hover:bg-yellow-600 disabled:opacity-50 cursor-pointer">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
