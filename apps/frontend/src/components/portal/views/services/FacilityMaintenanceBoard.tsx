"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState } from "react";
import {
  RefreshCw, Plus, X, Edit, Trash2, Search, CalendarClock, Play,
  CheckCircle2, Ban, AlertTriangle, Loader2, CircleDollarSign, Building2,
  ClipboardCheck, ChevronLeft, ChevronRight, Eye,
} from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { useWheelToPage } from "@/lib/useWheelToPage";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
import { useToast, Toaster } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import CompleteMaintenanceDialog from "@/components/portal/views/services/CompleteMaintenanceDialog";
import { SYSTEM_META, FREQUENCY_DAYS, FREQUENCY_LABEL } from "./serviceMeta";

/**
 * Preventive Facility Maintenance calendar (Phase 7 cont.) — live via
 * Supabase realtime + polling fallback. Covers the recurring plant loop:
 * HVAC quarterly service · generator monthly test · elevator inspection ·
 * fire & safety systems · pest control. Completing a PREVENTIVE entry
 * auto-schedules the next occurrence from its frequency.
 */

type Row = Record<string, unknown>;

const adaptEntry = (r: Row) => ({
  id: String(r.id ?? ""),
  title: String(r.title ?? "Maintenance"),
  system: String(r.system ?? "OTHER"),
  type: String(r.type ?? "PREVENTIVE"),
  status: String(r.status ?? "SCHEDULED"),
  frequency: String(r.frequency ?? "QUARTERLY"),
  location: String(r.location ?? ""),
  description: String(r.description ?? ""),
  scheduledDate: r.scheduledDate ? String(r.scheduledDate) : "",
  completedDate: r.completedDate ? String(r.completedDate) : "",
  nextDueDate: r.nextDueDate ? String(r.nextDueDate) : "",
  assignedTo: String(r.assignedTo ?? ""),
  vendor: String(r.vendor ?? ""),
  cost: Number(r.cost ?? 0),
  notes: String(r.notes ?? ""),
});
type MaintEntry = ReturnType<typeof adaptEntry>;

const STATUSES = ["SCHEDULED", "OPEN", "IN_PROGRESS", "AWAITING_PARTS", "COMPLETED", "CANCELLED"];
const TYPES = ["PREVENTIVE", "REPAIR", "INSPECTION"];
const DAY_MS = 86400000;

const STATUS_STYLES: Record<string, string> = {
  SCHEDULED: "bg-gray-100 text-gray-700",
  OPEN: "bg-blue-100 text-blue-700",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  AWAITING_PARTS: "bg-purple-100 text-purple-700",
  COMPLETED: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-700",
};

const emptyForm = {
  title: "", system: "HVAC", type: "PREVENTIVE", status: "SCHEDULED",
  frequency: "QUARTERLY", location: "", description: "", scheduledDate: "",
  assignedTo: "", vendor: "", cost: "", notes: "",
};

// canManage: the Maintenance crew portal can work jobs (Actions column). Facility
// Admin submits/schedules but has no per-row actions.
export default function FacilityMaintenanceBoard({ canManage = false }: { canManage?: boolean } = {}) {
  const { data: rows, loading, error, refetch } = useLiveQuery<Row>(
    "facility-maintenance", { query: "take=400", tables: ["FacilityMaintenance"] }
  );
  const entries = useMemo<MaintEntry[]>(() => rows.map(adaptEntry), [rows]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [systemFilter, setSystemFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<MaintEntry | null>(null);
  const [viewing, setViewing] = useState<MaintEntry | null>(null);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState(emptyForm);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [completing, setCompleting] = useState<MaintEntry | null>(null);
  const perPage = 12;
  const tableScrollRef = useWheelToPage<HTMLDivElement>();

  // shadcn feedback: toasts (success/error) + promise-based confirm dialog.
  const { toasts, toast, dismiss } = useToast();
  const { confirm, confirmDialog } = useConfirm();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter(e => {
      if (q && !e.title.toLowerCase().includes(q) && !e.vendor.toLowerCase().includes(q) && !e.location.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (systemFilter !== "all" && e.system !== systemFilter) return false;
      return true;
    });
  }, [entries, search, statusFilter, systemFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const dueSoon = useMemo(() =>
    entries.filter(e => {
      if (["COMPLETED", "CANCELLED"].includes(e.status) || !e.scheduledDate) return false;
      // eslint-disable-next-line react-hooks/purity
      return new Date(e.scheduledDate).getTime() <= Date.now() + 7 * DAY_MS;
    }).sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime()),
  [entries]);

  const stats = useMemo(() => ({
    scheduled: entries.filter(e => e.status === "SCHEDULED").length,
    inProgress: entries.filter(e => ["OPEN", "IN_PROGRESS", "AWAITING_PARTS"].includes(e.status)).length,
    dueSoon: dueSoon.length,
    completed: entries.filter(e => e.status === "COMPLETED").length,
    cost: entries.filter(e => e.status === "COMPLETED").reduce((s, e) => s + e.cost, 0),
  }), [entries, dueSoon]);

  const buildPayload = (form: typeof emptyForm) => ({
    title: form.title,
    system: form.system,
    type: form.type,
    status: form.status,
    frequency: form.frequency,
    location: form.location || null,
    description: form.description || null,
    scheduledDate: form.scheduledDate ? new Date(form.scheduledDate).toISOString() : null,
    nextDueDate: form.scheduledDate ? new Date(form.scheduledDate).toISOString() : null,
    assignedTo: form.assignedTo || null,
    vendor: form.vendor || null,
    cost: form.cost !== "" ? Number(form.cost) || 0 : null,
    notes: form.notes || null,
  });

  const handleCreate = async () => {
    if (!createForm.title) {
      toast("error", "Missing Fields", "A title is required.");
      return;
    }
    try {
      await createRecord("facility-maintenance", buildPayload(createForm));
      await refetch();
      setShowCreate(false);
      setCreateForm(emptyForm);
      toast("success", "Scheduled", `"${createForm.title}" added to the maintenance calendar.`);
    } catch (err) {
      toast("error", "Create Failed", err instanceof Error ? err.message : "Could not schedule maintenance.");
    }
  };

  const startEditing = (e: MaintEntry) => {
    setEditing(e);
    setEditForm({
      title: e.title, system: e.system, type: e.type, status: e.status,
      frequency: e.frequency, location: e.location, description: e.description,
      scheduledDate: e.scheduledDate ? e.scheduledDate.split("T")[0] : "",
      assignedTo: e.assignedTo, vendor: e.vendor,
      cost: e.cost ? String(e.cost) : "", notes: e.notes,
    });
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    try {
      await updateRecord("facility-maintenance", editing.id, buildPayload(editForm));
      await refetch();
      setEditing(null);
      toast("success", "Saved", "Maintenance entry updated.");
    } catch (err) {
      toast("error", "Save Failed", err instanceof Error ? err.message : "Could not update entry.");
    }
  };

  const handleStart = async (e: MaintEntry) => {
    setBusyId(e.id);
    try {
      await updateRecord("facility-maintenance", e.id, { status: "IN_PROGRESS" });
      await refetch();
    } catch (err) {
      toast("error", "Update Failed", err instanceof Error ? err.message : "Could not start work.");
    } finally {
      setBusyId(null);
    }
  };

  // Opens the shadcn Complete Maintenance dialog; the update runs in submitComplete.
  const handleComplete = (e: MaintEntry) => setCompleting(e);

  const submitComplete = async (cost: number) => {
    const e = completing;
    if (!e) return;
    setCompleting(null);
    setBusyId(e.id);
    try {
      const now = new Date();
      const intervalDays = FREQUENCY_DAYS[e.frequency] ?? 91;
      const nextDue = new Date(now.getTime() + intervalDays * DAY_MS);
      await updateRecord("facility-maintenance", e.id, {
        status: "COMPLETED",
        completedDate: now.toISOString(),
        cost,
        nextDueDate: e.type === "PREVENTIVE" ? nextDue.toISOString() : null,
      });
      // Recurring preventive entries roll forward automatically on the calendar.
      if (e.type === "PREVENTIVE") {
        await createRecord("facility-maintenance", {
          title: e.title,
          system: e.system,
          type: e.type,
          status: "SCHEDULED",
          frequency: e.frequency,
          location: e.location || null,
          description: e.description || null,
          scheduledDate: nextDue.toISOString(),
          nextDueDate: nextDue.toISOString(),
          assignedTo: e.assignedTo || null,
          vendor: e.vendor || null,
        });
      }
      await refetch();
      toast(
        "success",
        "Completed",
        e.type === "PREVENTIVE"
          ? `Next ${FREQUENCY_LABEL[e.frequency]?.toLowerCase() ?? ""} occurrence scheduled for ${nextDue.toLocaleDateString()}.`
          : "Maintenance entry closed.",
      );
    } catch (err) {
      toast("error", "Complete Failed", err instanceof Error ? err.message : "Could not complete entry.");
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (e: MaintEntry) => {
    if (!(await confirm({
      title: "Cancel Entry?",
      description: `Cancel "${e.title}"?`,
      confirmText: "Cancel Entry",
      destructive: true,
    }))) return;
    setBusyId(e.id);
    try {
      await updateRecord("facility-maintenance", e.id, { status: "CANCELLED" });
      await refetch();
    } catch (err) {
      toast("error", "Cancel Failed", err instanceof Error ? err.message : "Could not cancel entry.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (e: MaintEntry) => {
    if (!(await confirm({
      title: "Delete Entry?",
      description: `Remove "${e.title}"?`,
      confirmText: "Delete",
      destructive: true,
    }))) return;
    try {
      await deleteRecord("facility-maintenance", e.id);
      await refetch();
    } catch (err) {
      toast("error", "Delete Failed", err instanceof Error ? err.message : "Could not delete entry.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Facility Maintenance
          </h1>
          <p className="text-gray-600">Preventive calendar — HVAC quarterly · generator monthly · elevator · fire &amp; safety · pest control</p>
        </div>
        <div className="flex gap-2">
          <RefreshButton onRefresh={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium" />
          {/* Scheduling preventive maintenance is a Facility Admin task; the crew
              portal (canManage) only works the jobs. */}
          {!canManage && (
            <button onClick={() => { setCreateForm(emptyForm); setShowCreate(true); }} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
              <Plus className="w-4 h-4" /> Schedule Maintenance
            </button>
          )}
        </div>
      </div>

      {/* Stat Boxes */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatBox label="Scheduled" value={String(stats.scheduled)} icon={CalendarClock} color="blue" />
        <StatBox label="In Progress" value={String(stats.inProgress)} icon={Play} color="amber" />
        <StatBox label="Due in 7 Days" value={String(stats.dueSoon)} icon={AlertTriangle} color="red" />
        <StatBox label="Completed" value={String(stats.completed)} icon={CheckCircle2} color="green" />
        <StatBox label="Total Spend" value={`₱${Math.round(stats.cost).toLocaleString()}`} icon={CircleDollarSign} color="purple" />
      </div>

      {/* Due-soon panel */}
      {dueSoon.length > 0 && (
        <div className="bg-white rounded-lg border border-red-200 ring-1 ring-red-100 p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Due Within 7 Days</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">{dueSoon.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {dueSoon.slice(0, 6).map(e => {
              const sys = SYSTEM_META[e.system] ?? SYSTEM_META.OTHER;
              return (
                <div key={e.id} className="border border-gray-200 rounded-lg p-3 flex items-center gap-3">
                  <Building2 className="w-5 h-5 text-red-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{e.title}</p>
                    <p className="text-xs text-gray-500 truncate">
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold mr-1 ${sys.cls}`}>{sys.label}</span>
                      Due {e.scheduledDate ? new Date(e.scheduledDate).toLocaleDateString() : "—"}
                    </p>
                  </div>
                  {canManage && ["SCHEDULED", "OPEN"].includes(e.status) && (
                    <button onClick={() => handleStart(e)} className="px-3 py-1.5 text-xs font-semibold bg-yellow-400 hover:bg-yellow-500 text-black rounded-lg transition whitespace-nowrap">
                      Start
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          {["all", ...STATUSES].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${
                statusFilter === s
                  ? "bg-yellow-400 text-black border-yellow-400"
                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              }`}>
              {s === "all" ? "All" : s.replace(/_/g, " ")}
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Search title, vendor, or location…" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
          </div>
          <select value={systemFilter} onChange={e => setSystemFilter(e.target.value)}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
            <option value="all">All Systems</option>
            {Object.entries(SYSTEM_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* Table */}
      {loading && entries.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading maintenance calendar...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No maintenance entries match your filters.</div>
      ) : (
        <div ref={tableScrollRef} className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">System</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Title</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Frequency</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Scheduled</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Next Due</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Vendor / Assigned</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Cost</th>
                {canManage && <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.map(e => {
                const sys = SYSTEM_META[e.system] ?? SYSTEM_META.OTHER;
                const busy = busyId === e.id;
                return (
                  <tr key={e.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${sys.cls}`}>{sys.label}</span>
                    </td>
                    <td className="px-4 py-3 max-w-[240px]">
                      <p className="font-medium text-gray-900 truncate" title={e.title}>{e.title}</p>
                      {e.location && <p className="text-xs text-gray-500 truncate">{e.location}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      <span className="inline-flex items-center gap-1"><ClipboardCheck className="w-3 h-3" /> {FREQUENCY_LABEL[e.frequency] ?? e.frequency}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{e.scheduledDate ? new Date(e.scheduledDate).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{e.nextDueDate ? new Date(e.nextDueDate).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{e.vendor || e.assignedTo || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_STYLES[e.status] ?? "bg-gray-100 text-gray-700"}`}>
                        {e.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 font-medium">{e.cost ? `₱${e.cost.toLocaleString()}` : "—"}</td>
                    {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1 flex-wrap">
                        {busy ? (
                          <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                        ) : (
                          <>
                            <button onClick={() => setViewing(e)} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="View Details"><Eye className="w-4 h-4" /></button>
                            {["SCHEDULED", "OPEN", "AWAITING_PARTS"].includes(e.status) && (
                              <button onClick={() => handleStart(e)} className="p-1.5 rounded hover:bg-amber-100 text-amber-600 transition" title="Start Work"><Play className="w-4 h-4" /></button>
                            )}
                            {["IN_PROGRESS", "AWAITING_PARTS"].includes(e.status) && (
                              <button onClick={() => handleComplete(e)} className="p-1.5 rounded hover:bg-green-100 text-green-600 transition" title="Complete"><CheckCircle2 className="w-4 h-4" /></button>
                            )}
                            {!["COMPLETED", "CANCELLED"].includes(e.status) && (
                              <button onClick={() => handleCancel(e)} className="p-1.5 rounded hover:bg-red-100 text-red-500 transition" title="Cancel"><Ban className="w-4 h-4" /></button>
                            )}
                            <button onClick={() => startEditing(e)} className="p-1.5 rounded hover:bg-yellow-100 text-yellow-600 transition" title="Edit"><Edit className="w-4 h-4" /></button>
                            <button onClick={() => handleDelete(e)} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
                          </>
                        )}
                      </div>
                    </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">{filtered.length} entries total</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm font-medium text-gray-700">Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* Create / Edit / View Modals */}
      {showCreate && (
        <MaintenanceFormModal title="Schedule Maintenance" form={createForm} onChange={setCreateForm} onSave={handleCreate}
          onCancel={() => setShowCreate(false)} saveLabel="Schedule" />
      )}
      {editing && (
        <MaintenanceFormModal title="Edit Maintenance Entry" form={editForm} onChange={setEditForm} onSave={handleSaveEdit}
          onCancel={() => setEditing(null)} saveLabel="Save Changes" />
      )}
      {viewing && (
        <MaintenanceViewModal entry={viewing} onClose={() => setViewing(null)} />
      )}

      {/* shadcn complete dialog + confirm + toasts (replace the old SweetAlert2 popups) */}
      <CompleteMaintenanceDialog
        open={!!completing}
        onOpenChange={(o) => { if (!o) setCompleting(null); }}
        entryTitle={completing?.title}
        defaultCost={completing?.cost || 0}
        confirmLabel={completing?.type === "PREVENTIVE" ? "Complete & Schedule Next" : "Complete"}
        onSubmit={submitComplete}
      />
      {confirmDialog}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

/* ── Sub-components ── */

function StatBox({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; color: string }) {
  const COLORS: Record<string, string> = {
    blue: "text-blue-600 bg-blue-50 border-blue-200",
    green: "text-green-600 bg-green-50 border-green-200",
    red: "text-red-600 bg-red-50 border-red-200",
    purple: "text-purple-600 bg-purple-50 border-purple-200",
    amber: "text-amber-600 bg-amber-50 border-amber-200",
  };
  const c = COLORS[color] || COLORS.blue;
  return (
    <div className={`rounded-lg border p-4 ${c}`}>
      <div className="flex items-center justify-between mb-0.5">
        <p className="text-xs font-semibold text-gray-600">{label}</p>
        <Icon className={`w-4 h-4 ${c.split(" ")[0]}`} />
      </div>
      <p className={`text-2xl sm:text-3xl font-bold ${c.split(" ")[0]}`}>{value}</p>
    </div>
  );
}

function MaintenanceFormModal({ title, form, onChange, onSave, onCancel, saveLabel }: {
  title: string;
  form: typeof emptyForm;
  onChange: (f: typeof emptyForm) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
}) {
  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange({ ...form, [field]: e.target.value });

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onCancel} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Title</label>
              <input type="text" value={form.title} onChange={set("title")} placeholder="e.g. HVAC Quarterly Service — East Wing" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">System</label>
              <select value={form.system} onChange={set("system")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                {Object.entries(SYSTEM_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Type</label>
              <select value={form.type} onChange={set("type")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Frequency</label>
              <select value={form.frequency} onChange={set("frequency")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                {Object.entries(FREQUENCY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Scheduled Date</label>
              <input type="date" value={form.scheduledDate} onChange={set("scheduledDate")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Location</label>
              <input type="text" value={form.location} onChange={set("location")} placeholder="Wing / floor / plant area" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Vendor</label>
              <input type="text" value={form.vendor} onChange={set("vendor")} placeholder="External vendor (optional)" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Assigned To</label>
              <input type="text" value={form.assignedTo} onChange={set("assignedTo")} placeholder="Engineer / team" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Estimated Cost (₱)</label>
              <input type="number" min="0" step="0.01" value={form.cost} onChange={set("cost")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
              <textarea value={form.description} onChange={set("description")} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
              <textarea value={form.notes} onChange={set("notes")} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
          </div>
        </div>
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
          <button onClick={onCancel} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
          <button onClick={onSave} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">{saveLabel}</button>
        </div>
      </div>
    </div>
  );
}

function MaintenanceViewModal({ entry, onClose }: { entry: MaintEntry; onClose: () => void }) {
  const sys = SYSTEM_META[entry.system] ?? SYSTEM_META.OTHER;
  const typeMeta = { PREVENTIVE: { label: "Preventive", cls: "bg-blue-100 text-blue-700" }, REPAIR: { label: "Repair", cls: "bg-red-100 text-red-700" }, INSPECTION: { label: "Inspection", cls: "bg-purple-100 text-purple-700" } }[entry.type] ?? { label: entry.type, cls: "bg-gray-100 text-gray-700" };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold">{entry.title}</h2>
          <button onClick={onClose} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-5">
          <div className="flex flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${sys.cls}`}>{sys.label}</span>
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${typeMeta.cls}`}>{typeMeta.label}</span>
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[entry.status] ?? "bg-gray-100 text-gray-700"}`}>{entry.status.replace(/_/g, " ")}</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              ["Frequency", FREQUENCY_LABEL[entry.frequency] ?? entry.frequency],
              ["Location", entry.location || "—"],
              ["Scheduled", entry.scheduledDate ? new Date(entry.scheduledDate).toLocaleDateString() : "—"],
              ["Next Due", entry.nextDueDate ? new Date(entry.nextDueDate).toLocaleDateString() : "—"],
              ["Completed", entry.completedDate ? new Date(entry.completedDate).toLocaleDateString() : "—"],
              ["Assigned To", entry.assignedTo || "—"],
              ["Vendor", entry.vendor || "—"],
              ["Cost", entry.cost ? `₱${entry.cost.toLocaleString()}` : "—"],
            ].map(([label, value]) => (
              <div key={label} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">{value}</p>
              </div>
            ))}
          </div>
          {entry.description && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Description</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{entry.description}</p>
            </div>
          )}
          {entry.notes && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Notes</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{entry.notes}</p>
            </div>
          )}
        </div>
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Close</button>
        </div>
      </div>
    </div>
  );
}
