"use client";
import { useMemo, useState } from "react";
import { CalendarCheck, Plus, X, Trash2, Search, CheckCircle, Clock, AlertTriangle, Loader2 } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none text-sm";
const labelCls = "block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1";
const statusColors: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-700",
  SCHEDULED: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-green-100 text-green-700",
  CANCELLED: "bg-gray-100 text-gray-600",
  OVERDUE: "bg-red-100 text-red-700",
};

export default function FollowUpTracker() {
  const { data: fuRows, loading, refetch } = useLiveQuery("follow-ups", { query: "take=500", tables: ["FollowUp"] });
  const { data: resQ } = useLiveQuery("residents", { tables: ["Resident"] });
  const residents = useMemo(() => (resQ || []).map(adaptResident), [resQ]);
  const resMap = useMemo(() => new Map(residents.map((r: any) => [r.id, r])), [residents]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const now = new Date();
    return (fuRows || []).map((f: any) => {
      if (f.status === "PENDING" && f.dueDate && new Date(f.dueDate) < now) return { ...f, status: "OVERDUE" };
      return f;
    }).filter((f: any) => {
      const name = resMap.get(f.residentId)?.name || "";
      if (filter !== "ALL" && f.status !== filter) return false;
      if (search && !name.toLowerCase().includes(search.toLowerCase()) && !(f.type || "").toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [fuRows, filter, search, resMap]);

  const handleDelete = async (id: string) => {
    const r = await Swal.fire({ title: "Delete Follow-up?", icon: "warning", showCancelButton: true, confirmButtonColor: "#dc2626" });
    if (r.isConfirmed) { await deleteRecord("follow-ups", id); refetch(); Swal.fire("Deleted", "", "success"); }
  };

  const markComplete = async (id: string) => {
    await updateRecord("follow-ups", id, { status: "COMPLETED", completedDate: new Date().toISOString() });
    refetch();
    Swal.fire({ icon: "success", title: "Completed", timer: 1200, showConfirmButton: false });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><CalendarCheck className="w-5 h-5 text-yellow-500" /> Follow-up Tracker</h2>
          <p className="text-sm text-gray-500">Hospital referrals, specialist appointments, and care follow-ups</p>
        </div>
        <button onClick={() => setCreating(true)} className="w-full sm:w-auto justify-center px-4 py-2 rounded-lg bg-yellow-500 text-white text-sm font-semibold hover:bg-yellow-600 flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> New Follow-up
        </button>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by resident or type..." className={`${inputCls} pl-9`} />
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value)} className={`${inputCls} w-full sm:w-auto`}>
          <option value="ALL">All Status</option>
          {Object.keys(statusColors).map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
          <CalendarCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No follow-ups found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((fu: any) => (
            <div key={fu.id} className="bg-white rounded-lg border border-gray-200 p-4 hover:bg-gray-50 transition">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium text-gray-900">{resMap.get(fu.residentId)?.name || "Unknown"}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[fu.status] || "bg-gray-100 text-gray-600"}`}>{fu.status?.replace("_", " ")}</span>
                  </div>
                  <p className="text-sm text-gray-600">{fu.type || "Follow-up"} — {fu.description || "—"}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Due: {fu.dueDate ? new Date(fu.dueDate).toLocaleDateString() : "—"}
                    {fu.completedDate && ` • Completed: ${new Date(fu.completedDate).toLocaleDateString()}`}
                    {fu.assignedToName && ` • Assigned: ${fu.assignedToName}`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {fu.status !== "COMPLETED" && fu.status !== "CANCELLED" && (
                    <button onClick={() => markComplete(fu.id)} className="p-1.5 text-green-500 hover:bg-green-50 rounded cursor-pointer" title="Mark Complete">
                      <CheckCircle className="w-4 h-4" />
                    </button>
                  )}
                  <button onClick={() => handleDelete(fu.id)} className="p-1.5 text-red-400 hover:text-red-500 cursor-pointer"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && <FollowUpModal residents={residents} onClose={() => setCreating(false)} onSaved={() => { refetch(); setCreating(false); }} />}
    </div>
  );
}

function FollowUpModal({ residents, onClose, onSaved }: { residents: any[]; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ residentId: "", title: "", type: "Hospital Follow-up", description: "", dueDate: "", assignedToName: "", notes: "" });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.residentId) return;
    setSaving(true);
    try {
      await createRecord("follow-ups", {
        ...form,
        title: form.title.trim() || form.type,
        status: "PENDING",
      });
      onSaved();
      Swal.fire({ icon: "success", title: "Created!", timer: 1500, showConfirmButton: false });
    } catch { Swal.fire("Error", "Failed", "error"); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-yellow-500 to-amber-500 px-6 py-4 rounded-t-xl flex items-center justify-between">
          <h3 className="text-white font-bold text-lg">New Follow-up</h3>
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
          <div><label className={labelCls}>Title *</label><input value={form.title} onChange={e => set("title", e.target.value)} className={inputCls} required placeholder="e.g. Cardiology follow-up" /></div>
          <div><label className={labelCls}>Type</label><select value={form.type} onChange={e => set("type", e.target.value)} className={inputCls}>
            {["Hospital Follow-up", "Specialist Appointment", "Lab Results", "Imaging", "Therapy", "Care Plan Review", "Family Consult", "Other"].map(t => <option key={t} value={t}>{t}</option>)}
          </select></div>
          <div><label className={labelCls}>Description</label><textarea value={form.description} onChange={e => set("description", e.target.value)} className={inputCls} rows={2} placeholder="Details about the follow-up..." /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={labelCls}>Due Date *</label><input type="date" value={form.dueDate} onChange={e => set("dueDate", e.target.value)} className={inputCls} required /></div>
            <div><label className={labelCls}>Assigned To</label><input value={form.assignedToName} onChange={e => set("assignedToName", e.target.value)} className={inputCls} placeholder="Staff name or role" /></div>
          </div>
          <div><label className={labelCls}>Notes</label><textarea value={form.notes} onChange={e => set("notes", e.target.value)} className={inputCls} rows={2} /></div>
          <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-3 -mx-6 -mb-6 rounded-b-xl flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 cursor-pointer">Cancel</button>
            <button type="submit" disabled={saving || !form.residentId} className="px-5 py-2 rounded-lg bg-yellow-500 text-white text-sm font-semibold hover:bg-yellow-600 disabled:opacity-50 cursor-pointer">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
