"use client";
import { useMemo, useState } from "react";
import { Target, Plus, X, Trash2, CheckCircle, Clock, AlertTriangle, FileText, Search, Loader2 } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none text-sm";
const labelCls = "block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1";
const statusColors: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  ACTIVE: "bg-green-100 text-green-700",
  UNDER_REVIEW: "bg-yellow-100 text-yellow-700",
  COMPLETED: "bg-blue-100 text-blue-700",
  DISCONTINUED: "bg-red-100 text-red-700",
};

export default function CarePlanBoard() {
  const { data: planRows, loading, refetch } = useLiveQuery("care-plans", { query: "take=200", tables: ["CarePlan"] });
  const { data: itemRows } = useLiveQuery("care-plan-items", { query: "take=500", tables: ["CarePlanItem"] });
  const { data: resQ } = useLiveQuery("residents", { tables: ["Resident"] });
  const residents = useMemo(() => (resQ || []).map(adaptResident), [resQ]);
  const resMap = useMemo(() => new Map(residents.map((r: any) => [r.id, r])), [residents]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const filtered = useMemo(() => {
    return (planRows || []).filter((p: any) => {
      const name = resMap.get(p.residentId)?.name || "";
      if (filter !== "ALL" && p.status !== filter) return false;
      if (search && !name.toLowerCase().includes(search.toLowerCase()) && !(p.diagnosis || "").toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [planRows, filter, search, resMap]);

  const itemsByPlan = useMemo(() => {
    const map: Record<string, any[]> = {};
    (itemRows || []).forEach((i: any) => {
      if (!map[i.carePlanId]) map[i.carePlanId] = [];
      map[i.carePlanId].push(i);
    });
    return map;
  }, [itemRows]);

  const handleDelete = async (id: string) => {
    const r = await Swal.fire({ title: "Delete Care Plan?", icon: "warning", showCancelButton: true, confirmButtonColor: "#dc2626" });
    if (r.isConfirmed) {
      const items = itemsByPlan[id] || [];
      for (const item of items) await deleteRecord("care-plan-items", item.id);
      await deleteRecord("care-plans", id);
      refetch();
      Swal.fire("Deleted", "", "success");
    }
  };

  const handleStatusChange = async (id: string, status: string) => {
    await updateRecord("care-plans", id, { status });
    refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><Target className="w-5 h-5 text-yellow-500" /> Care Plans</h2>
          <p className="text-sm text-gray-500">Formal care plans with goals, interventions, and reviews</p>
        </div>
        <button onClick={() => setCreating(true)} className="w-full sm:w-auto px-4 py-2 rounded-lg bg-yellow-500 text-white text-sm font-semibold hover:bg-yellow-600 flex items-center justify-center gap-1.5">
          <Plus className="w-4 h-4" /> New Care Plan
        </button>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by resident or diagnosis..." className={`${inputCls} pl-9`} />
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value)} className={`${inputCls} w-auto`}>
          <option value="ALL">All Status</option>
          {Object.keys(statusColors).map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-center text-gray-500"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
          <Target className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No care plans found</p>
          <p className="text-sm mt-1">Create a new care plan to get started</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Resident</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Diagnosis</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600">Goals</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Review</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Created</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((plan: any) => {
                  const rName = resMap.get(plan.residentId)?.name || "Unknown";
                  const items = itemsByPlan[plan.id] || [];
                  return (
                    <tr key={plan.id} className="hover:bg-gray-50 transition">
                      <td className="px-4 py-3 font-medium text-gray-900">{rName}</td>
                      <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate">{plan.diagnosis || "—"}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[plan.status] || "bg-gray-100 text-gray-600"}`}>{plan.status?.replace("_", " ")}</span></td>
                      <td className="px-4 py-3 text-center text-gray-700">{items.length}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{plan.reviewFrequency || "QUARTERLY"}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{plan.createdAt ? new Date(plan.createdAt).toLocaleDateString() : "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {plan.status === "DRAFT" && <button onClick={() => handleStatusChange(plan.id, "ACTIVE")} className="p-1.5 text-green-500 hover:bg-green-50 rounded cursor-pointer" title="Activate"><CheckCircle className="w-4 h-4" /></button>}
                          {plan.status === "ACTIVE" && <button onClick={() => handleStatusChange(plan.id, "COMPLETED")} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded cursor-pointer" title="Complete"><CheckCircle className="w-4 h-4" /></button>}
                          <button onClick={() => setEditing(plan)} className="p-1.5 text-yellow-500 hover:bg-yellow-50 rounded cursor-pointer" title="Edit"><FileText className="w-4 h-4" /></button>
                          <button onClick={() => handleDelete(plan.id)} className="p-1.5 text-red-400 hover:text-red-500 hover:bg-red-50 rounded cursor-pointer" title="Delete"><Trash2 className="w-4 h-4" /></button>
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

      {(creating || editing) && <CarePlanModal plan={editing} residents={residents} onClose={() => { setCreating(false); setEditing(null); }} onSaved={() => { refetch(); setCreating(false); setEditing(null); }} />}
    </div>
  );
}

function CarePlanModal({ plan, residents, onClose, onSaved }: { plan: any; residents: any[]; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    residentId: plan?.residentId || "",
    diagnosis: plan?.diagnosis || "",
    status: plan?.status || "DRAFT",
    reviewFrequency: plan?.reviewFrequency || "QUARTERLY",
    notes: plan?.notes || "",
  });
  const [goals, setGoals] = useState<any[]>(plan ? [] : [{ goalType: "SHORT_TERM", goal: "", intervention: "", responsibleRole: "NURSE" }]);

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.residentId) return;
    setSaving(true);
    try {
      const data = { ...form, startDate: new Date().toISOString() };
      const result = plan ? await updateRecord("care-plans", plan.id, data) : await createRecord("care-plans", data);
      const planId = plan?.id || result?.id || result?.data?.id;
      if (planId) {
        for (const g of goals) {
          if (g.goal) {
            await createRecord("care-plan-items", { carePlanId: planId, ...g });
          }
        }
      }
      onSaved();
      Swal.fire({ icon: "success", title: plan ? "Updated!" : "Created!", timer: 1500, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-yellow-500 to-amber-500 px-6 py-4 rounded-t-xl flex items-center justify-between">
          <h3 className="text-white font-bold text-lg">{plan ? "Edit" : "New"} Care Plan</h3>
          <button onClick={onClose} className="text-white/80 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className={labelCls}>Resident *</label>
            <select value={form.residentId} onChange={e => set("residentId", e.target.value)} className={inputCls} required>
              <option value="">Select resident...</option>
              {residents.map((r: any) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
            </select>
          </div>
          <div><label className={labelCls}>Primary Diagnosis</label><input value={form.diagnosis} onChange={e => set("diagnosis", e.target.value)} className={inputCls} placeholder="e.g., Alzheimer's Disease, Stage 3" /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={labelCls}>Status</label><select value={form.status} onChange={e => set("status", e.target.value)} className={inputCls}>
              {["DRAFT", "ACTIVE", "UNDER_REVIEW", "COMPLETED", "DISCONTINUED"].map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </select></div>
            <div><label className={labelCls}>Review Frequency</label><select value={form.reviewFrequency} onChange={e => set("reviewFrequency", e.target.value)} className={inputCls}>
              {["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "ANNUALLY"].map(s => <option key={s} value={s}>{s}</option>)}
            </select></div>
          </div>

          {!plan && goals.length > 0 && (
            <div className="space-y-2">
              <label className={labelCls}>Initial Goals</label>
              {goals.map((g, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-3 space-y-2">
                  <div className="flex gap-2">
                    <select value={g.goalType} onChange={e => { const next = [...goals]; next[i] = { ...next[i], goalType: e.target.value }; setGoals(next); }} className={`${inputCls} w-1/3`}>
                      <option value="SHORT_TERM">Short Term</option>
                      <option value="LONG_TERM">Long Term</option>
                      <option value="OUTCOME">Outcome</option>
                    </select>
                    <input value={g.goal} onChange={e => { const next = [...goals]; next[i] = { ...next[i], goal: e.target.value }; setGoals(next); }} className={`${inputCls} flex-1`} placeholder="Goal description" />
                    {goals.length > 1 && <button type="button" onClick={() => setGoals(goals.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 cursor-pointer"><Trash2 className="w-4 h-4" /></button>}
                  </div>
                  <input value={g.intervention} onChange={e => { const next = [...goals]; next[i] = { ...next[i], intervention: e.target.value }; setGoals(next); }} className={inputCls} placeholder="Intervention / Action" />
                </div>
              ))}
              <button type="button" onClick={() => setGoals([...goals, { goalType: "SHORT_TERM", goal: "", intervention: "", responsibleRole: "NURSE" }])} className="text-sm text-yellow-600 hover:text-yellow-700 font-medium cursor-pointer">+ Add Goal</button>
            </div>
          )}

          <div><label className={labelCls}>Notes</label><textarea value={form.notes} onChange={e => set("notes", e.target.value)} className={inputCls} rows={3} /></div>

          <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-3 -mx-6 -mb-6 rounded-b-xl flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 cursor-pointer">Cancel</button>
            <button type="submit" disabled={saving || !form.residentId} className="px-5 py-2 rounded-lg bg-yellow-500 text-white text-sm font-semibold hover:bg-yellow-600 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : plan ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
