"use client";
import { useMemo, useState } from "react";
import { Syringe, Plus, X, Trash2, Search, CheckCircle, Clock, AlertTriangle, Loader2 } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none text-sm";
const labelCls = "block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1";
const statusColors: Record<string, string> = {
  SCHEDULED: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
  DECLINED: "bg-gray-100 text-gray-700",
  EXEMPTED: "bg-yellow-100 text-yellow-700",
};

export default function VaccinationTracker() {
  const { data: vacRows, loading, refetch } = useLiveQuery("vaccinations", { query: "take=500", tables: ["Vaccination"] });
  const { data: resQ } = useLiveQuery("residents", { tables: ["Resident"] });
  const residents = useMemo(() => (resQ || []).map(adaptResident), [resQ]);
  const resMap = useMemo(() => new Map(residents.map((r: any) => [r.id, r])), [residents]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    return (vacRows || []).filter((v: any) => {
      const name = resMap.get(v.residentId)?.name || "";
      if (filter !== "ALL" && v.status !== filter) return false;
      if (search && !name.toLowerCase().includes(search.toLowerCase()) && !(v.vaccineName || "").toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [vacRows, filter, search, resMap]);

  const stats = useMemo(() => ({
    total: vacRows?.length || 0,
    completed: (vacRows || []).filter((v: any) => v.status === "COMPLETED").length,
    scheduled: (vacRows || []).filter((v: any) => v.status === "SCHEDULED").length,
    overdue: (vacRows || []).filter((v: any) => v.status === "OVERDUE").length,
  }), [vacRows]);

  const handleDelete = async (id: string) => {
    const r = await Swal.fire({ title: "Delete Record?", icon: "warning", showCancelButton: true, confirmButtonColor: "#dc2626" });
    if (r.isConfirmed) { await deleteRecord("vaccinations", id); refetch(); Swal.fire("Deleted", "", "success"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><Syringe className="w-5 h-5 text-yellow-500" /> Vaccination Tracker</h2>
          <p className="text-sm text-gray-500">Manage immunization records and schedules</p>
        </div>
        <button onClick={() => setCreating(true)} className="w-full sm:w-auto px-4 py-2 rounded-lg bg-yellow-500 text-white text-sm font-semibold hover:bg-yellow-600 flex items-center justify-center gap-1.5">
          <Plus className="w-4 h-4" /> Add Record
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Total", value: stats.total, color: "text-gray-900" },
          { label: "Completed", value: stats.completed, color: "text-green-600" },
          { label: "Scheduled", value: stats.scheduled, color: "text-blue-600" },
          { label: "Overdue", value: stats.overdue, color: "text-red-600" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-lg border p-3 text-center">
            <p className="text-xs text-gray-500 font-medium">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => { setSearch(e.target.value); }} placeholder="Search by resident or vaccine..." className={`${inputCls} pl-9`} />
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value)} className={`${inputCls} sm:w-auto`}>
          <option value="ALL">All Status</option>
          {Object.keys(statusColors).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-center text-gray-500"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
          <Syringe className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No vaccination records</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Resident</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Vaccine</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Dose</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((v: any) => (
                  <tr key={v.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{resMap.get(v.residentId)?.name || "Unknown"}</p>
                      <p className="text-xs text-gray-500">Room {resMap.get(v.residentId)?.room || "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{v.vaccineName || "—"}</td>
                    <td className="px-4 py-3 text-gray-700">{v.doseNumber || 1} of {v.totalDoses || "—"}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{v.dateGiven ? new Date(v.dateGiven).toLocaleDateString() : v.scheduledDate ? `Scheduled: ${new Date(v.scheduledDate).toLocaleDateString()}` : "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[v.status] || "bg-gray-100 text-gray-600"}`}>{v.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        {v.status === "SCHEDULED" && (
                          <button onClick={() => updateRecord("vaccinations", v.id, { status: "COMPLETED", dateGiven: new Date().toISOString() }).then(refetch)} className="p-1.5 text-green-500 hover:bg-green-50 rounded cursor-pointer" title="Mark Complete">
                            <CheckCircle className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => handleDelete(v.id)} className="p-1.5 text-red-400 hover:text-red-500 cursor-pointer"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating && <VaccinationModal residents={residents} onClose={() => setCreating(false)} onSaved={() => { refetch(); setCreating(false); }} />}
    </div>
  );
}

function VaccinationModal({ residents, onClose, onSaved }: { residents: any[]; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ residentId: "", vaccineName: "", doseNumber: 1, totalDoses: 1, scheduledDate: "", notes: "" });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.residentId || !form.vaccineName) return;
    setSaving(true);
    try {
      await createRecord("vaccinations", {
        residentId: form.residentId,
        vaccineName: form.vaccineName,
        doseNumber: parseInt(String(form.doseNumber)) || 1,
        totalDoses: parseInt(String(form.totalDoses)) || 1,
        scheduledDate: form.scheduledDate || null,
        status: form.scheduledDate ? "SCHEDULED" : "COMPLETED",
        dateGiven: form.scheduledDate ? null : new Date().toISOString(),
        notes: form.notes || null,
      });
      onSaved();
      Swal.fire({ icon: "success", title: "Added!", timer: 1500, showConfirmButton: false });
    } catch { Swal.fire("Error", "Failed to save", "error"); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-yellow-500 to-amber-500 px-6 py-4 rounded-t-xl flex items-center justify-between">
          <h3 className="text-white font-bold text-lg">Add Vaccination</h3>
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
          <div><label className={labelCls}>Vaccine Name *</label><input value={form.vaccineName} onChange={e => set("vaccineName", e.target.value)} className={inputCls} required placeholder="e.g., Influenza, COVID-19, Pneumococcal" /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={labelCls}>Dose #</label><input type="number" min="1" value={form.doseNumber} onChange={e => set("doseNumber", e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Total Doses</label><input type="number" min="1" value={form.totalDoses} onChange={e => set("totalDoses", e.target.value)} className={inputCls} /></div>
          </div>
          <div><label className={labelCls}>Scheduled Date (leave blank if already administered)</label><input type="date" value={form.scheduledDate} onChange={e => set("scheduledDate", e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Notes</label><textarea value={form.notes} onChange={e => set("notes", e.target.value)} className={inputCls} rows={2} /></div>
          <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-3 -mx-6 -mb-6 rounded-b-xl flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 cursor-pointer">Cancel</button>
            <button type="submit" disabled={saving || !form.residentId || !form.vaccineName} className="px-5 py-2 rounded-lg bg-yellow-500 text-white text-sm font-semibold hover:bg-yellow-600 disabled:opacity-50 cursor-pointer">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
