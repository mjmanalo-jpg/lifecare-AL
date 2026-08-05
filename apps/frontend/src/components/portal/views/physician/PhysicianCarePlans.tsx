"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState, useEffect } from "react";
import {
  Target, Search, RefreshCw, Plus, X, CheckCircle2, Circle, Trash2, Loader2,
  Users, Eye, ChevronLeft, ChevronRight, UserRound, Clock, type LucideIcon,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

/**
 * Physician Care Plans & Directives — the physician sets individualized care-plan
 * goals per patient; the nurse and caregiver execute them and the family sees
 * them live in their Care Goals tab (same ResidentGoal model). Live via Supabase
 * realtime + polling, with search, patient filter, pagination and a responsive
 * detail modal.
 */

type Row = Record<string, unknown>;
const asStr = (v: unknown): string => (v == null ? "" : String(v));
const PER_PAGE = 9;

type GoalVM = {
  id: string; residentId: string; title: string; description: string;
  isCompleted: boolean; goalDate: string; completedAt: string; createdAt: string;
};

export default function PhysicianCarePlans() {
  const residentsQ = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });
  const goalsQ = useLiveQuery<Row>("resident-goals", { query: "take=600", tables: ["ResidentGoal"] });

  const residents = useMemo(() => residentsQ.data.map(adaptResident), [residentsQ.data]);
  const nameById = useMemo(() => new Map(residents.map((r) => [r.id, r])), [residents]);

  const [search, setSearch] = useState("");
  const [residentFilter, setResidentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "done">("all");
  const [showAdd, setShowAdd] = useState(false);
  const [viewing, setViewing] = useState<GoalVM | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const goals = useMemo<GoalVM[]>(() => goalsQ.data
    .map((g) => ({
      id: asStr(g.id), residentId: asStr(g.residentId), title: asStr(g.title),
      description: asStr(g.description), isCompleted: Boolean(g.isCompleted),
      goalDate: asStr(g.goalDate), completedAt: asStr(g.completedAt), createdAt: asStr(g.createdAt),
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [goalsQ.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return goals.filter((g) => {
      if (residentFilter !== "all" && g.residentId !== residentFilter) return false;
      if (statusFilter === "active" && g.isCompleted) return false;
      if (statusFilter === "done" && !g.isCompleted) return false;
      if (q && !g.title.toLowerCase().includes(q) && !g.description.toLowerCase().includes(q) && !(nameById.get(g.residentId)?.name ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [goals, search, residentFilter, statusFilter, nameById]);

  useEffect(() => { setPage(1); }, [search, residentFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageClamped = Math.min(page, totalPages);
  const paginated = filtered.slice((pageClamped - 1) * PER_PAGE, pageClamped * PER_PAGE);

  const stats = useMemo(() => ({
    total: goals.length,
    active: goals.filter((g) => !g.isCompleted).length,
    completed: goals.filter((g) => g.isCompleted).length,
    patients: new Set(goals.map((g) => g.residentId)).size,
  }), [goals]);

  const toggle = async (id: string, isCompleted: boolean) => {
    setBusyId(id);
    try {
      await updateRecord("resident-goals", id, { isCompleted: !isCompleted, completedAt: !isCompleted ? new Date().toISOString() : null });
      await goalsQ.refetch();
      setViewing((v) => (v && v.id === id ? { ...v, isCompleted: !isCompleted } : v));
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not update goal.", icon: "error" });
    } finally { setBusyId(null); }
  };

  const remove = async (id: string, title: string) => {
    const c = await Swal.fire({ title: "Remove Goal?", text: `"${title}" will be removed from the care plan.`, icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Remove" });
    if (!c.isConfirmed) return;
    try { await deleteRecord("resident-goals", id); await goalsQ.refetch(); setViewing((v) => (v && v.id === id ? null : v)); }
    catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not remove.", icon: "error" }); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
            <Target className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Care Plans &amp; Directives
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
            Physician-set goals the care team executes &amp; the family follows
          </p>
        </div>
        <div className="flex items-center gap-2 self-start">
          <RefreshButton onRefresh={() => goalsQ.refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium" />
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">
            <Plus className="w-4 h-4" /> New Directive
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Total Goals" value={stats.total} icon={Target} tone="gray" />
        <Stat label="Active" value={stats.active} icon={Circle} tone="blue" />
        <Stat label="Achieved" value={stats.completed} icon={CheckCircle2} tone="green" />
        <Stat label="Patients Covered" value={stats.patients} icon={Users} tone="purple" />
      </div>

      {/* Filters + search */}
      <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
        <div className="flex gap-2">
          {(["all", "active", "done"] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${statusFilter === s ? "bg-yellow-400 text-black border-yellow-400" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
              {s === "all" ? "All" : s === "active" ? "Active" : "Achieved"}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search goals or patient…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
        </div>
        <select value={residentFilter} onChange={(e) => setResidentFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
          <option value="all">All Patients</option>
          {residents.map((r) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
        </select>
      </div>

      {/* List */}
      {goalsQ.loading && goals.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">Loading care plans…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">No care-plan goals match your filters.</div>
      ) : (
        <div className="space-y-2">
          {paginated.map((g) => {
            const r = nameById.get(g.residentId);
            const busy = busyId === g.id;
            return (
              <div key={g.id} className="bg-white rounded-lg border border-gray-200 hover:border-yellow-300 hover:shadow-md transition p-4 flex items-start gap-3">
                {busy ? <Loader2 className="w-5 h-5 text-gray-400 animate-spin mt-0.5" /> : (
                  <button onClick={() => toggle(g.id, g.isCompleted)} title={g.isCompleted ? "Mark active" : "Mark achieved"} className="mt-0.5">
                    {g.isCompleted ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <Circle className="w-5 h-5 text-gray-300 hover:text-yellow-500" />}
                  </button>
                )}
                <button onClick={() => setViewing(g)} className="min-w-0 flex-1 text-left">
                  <p className={`font-semibold ${g.isCompleted ? "line-through text-gray-400" : "text-gray-900"}`}>{g.title}</p>
                  <p className="text-xs text-gray-500">{r?.name ?? "Unknown"} · Room {r?.room ?? "—"}</p>
                  {g.description && <p className="text-sm text-gray-600 mt-1 line-clamp-2">{g.description}</p>}
                </button>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => setViewing(g)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                  <button onClick={() => remove(g.id, g.title)} className="p-1.5 rounded hover:bg-red-100 text-red-500 transition" title="Remove"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {filtered.length > PER_PAGE && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-gray-600">{(pageClamped - 1) * PER_PAGE + 1}–{Math.min(pageClamped * PER_PAGE, filtered.length)} of {filtered.length}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageClamped === 1}
              className="flex items-center gap-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm font-medium">
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {pageClamped} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={pageClamped === totalPages}
              className="flex items-center gap-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm font-medium">
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Responsive detail modal */}
      {viewing && (() => {
        const r = nameById.get(viewing.residentId); const busy = busyId === viewing.id;
        return (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
              <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-start justify-between gap-3 z-10">
                <div className="min-w-0">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${viewing.isCompleted ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                    {viewing.isCompleted ? "Achieved" : "Active"}
                  </span>
                  <h2 className="text-lg sm:text-xl font-bold mt-1 break-words">{viewing.title}</h2>
                </div>
                <button onClick={() => setViewing(null)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition flex-shrink-0"><X className="w-6 h-6" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs font-semibold text-gray-500 mb-0.5 flex items-center gap-1"><UserRound className="w-3.5 h-3.5" /> Patient</p><p className="text-gray-900">{r?.name ?? "Unknown"}</p><p className="text-xs text-gray-400">Room {r?.room ?? "—"}</p></div>
                  <div><p className="text-xs font-semibold text-gray-500 mb-0.5 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Set</p><p className="text-gray-900">{viewing.goalDate || viewing.createdAt ? new Date(viewing.goalDate || viewing.createdAt).toLocaleDateString() : "—"}</p>{viewing.isCompleted && viewing.completedAt && <p className="text-xs text-green-600">Achieved {new Date(viewing.completedAt).toLocaleDateString()}</p>}</div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Instructions for the care team</p>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <p className="text-sm text-gray-900 whitespace-pre-wrap">{viewing.description || "—"}</p>
                  </div>
                </div>
                <p className="text-[11px] text-gray-400">Visible live to the nurse, caregiver &amp; family (Care Goals).</p>
              </div>
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between gap-2 flex-wrap">
                <button onClick={() => remove(viewing.id, viewing.title)} className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 border border-red-200 font-semibold rounded-lg hover:bg-red-100 transition text-sm">
                  <Trash2 className="w-4 h-4" /> Remove
                </button>
                <button onClick={() => toggle(viewing.id, viewing.isCompleted)} disabled={busy}
                  className={`flex items-center gap-2 px-5 py-2 font-semibold rounded-lg transition disabled:opacity-50 text-sm text-white ${viewing.isCompleted ? "bg-gray-500 hover:bg-gray-600" : "bg-gradient-to-r from-green-400 to-green-500 hover:shadow-lg"}`}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} {viewing.isCompleted ? "Mark Active" : "Mark Achieved"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showAdd && (
        <AddDirectiveModal residents={residents.map((r) => ({ id: r.id, name: r.name, room: r.room }))}
          onClose={() => setShowAdd(false)} onSaved={() => { void goalsQ.refetch(); setShowAdd(false); }} />
      )}
    </div>
  );
}

function AddDirectiveModal({ residents, onClose, onSaved }: {
  residents: { id: string; name: string; room: string }[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ residentId: "", title: "", description: "" });
  const [saving, setSaving] = useState(false);
  const valid = form.residentId && form.title.trim();
  const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      await createRecord("resident-goals", {
        residentId: form.residentId, title: form.title.trim(),
        description: form.description.trim() || null, isCustom: true, goalDate: new Date().toISOString(),
      });
      Swal.fire({ title: "Directive Set", text: "The care team and family can see it now.", icon: "success", timer: 1500, showConfirmButton: false });
      onSaved();
    } catch (err) {
      setSaving(false);
      Swal.fire({ title: "Save Failed", text: err instanceof Error ? err.message : "Could not save.", icon: "error" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold">New Care Directive</h2>
          <button onClick={onClose} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Patient <span className="text-red-500">*</span></label>
              <select value={form.residentId} onChange={(e) => setForm((f) => ({ ...f, residentId: e.target.value }))} className={inputCls}>
                <option value="">Select patient…</option>
                {residents.map((r) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Goal / Directive <span className="text-red-500">*</span></label>
              <input type="text" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Ambulate 15 min twice daily" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Instructions for the care team</label>
              <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={4}
                placeholder="How the nurse/caregiver should carry this out, target & review date…" className={`${inputCls} resize-y`} />
            </div>
          </div>
          <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
            <button type="button" onClick={onClose} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Cancel</button>
            <button type="submit" disabled={!valid || saving}
              className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50">
              <Target className="w-4 h-4" /> {saving ? "Saving…" : "Set Directive"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const TONES: Record<string, { wrap: string; icon: string; value: string }> = {
  gray: { wrap: "bg-white border-gray-200", icon: "text-gray-500", value: "text-gray-900" },
  blue: { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-500", value: "text-blue-600" },
  green: { wrap: "bg-green-50 border-green-200", icon: "text-green-500", value: "text-green-600" },
  purple: { wrap: "bg-purple-50 border-purple-200", icon: "text-purple-500", value: "text-purple-600" },
};
function Stat({ label, value, icon: Icon, tone }: { label: string; value: number; icon: LucideIcon; tone: keyof typeof TONES }) {
  const t = TONES[tone];
  return (
    <div className={`p-4 rounded-lg border ${t.wrap}`}>
      <div className="flex items-center justify-between"><p className="text-xs sm:text-sm text-gray-600 font-semibold">{label}</p><Icon className={`w-4 h-4 ${t.icon}`} /></div>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 ${t.value}`}>{value}</p>
    </div>
  );
}
