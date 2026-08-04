"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState } from "react";
import {
  ConciergeBell, RefreshCw, Plus, X, Trash2, Search, Play, CheckCircle2,
  Ban, Loader2, Star, Ticket, Timer, CircleDollarSign, UserCheck, Camera,
  TrendingUp, Upload,
} from "lucide-react";
import { downscaleImage } from "@/lib/photoCapture";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { useWheelToPage } from "@/lib/useWheelToPage";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
import { useToast, Toaster } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import CompleteTicketDialog from "@/components/portal/views/services/CompleteTicketDialog";
import StartWorkDialog from "@/components/portal/views/services/StartWorkDialog";
import {
  CATEGORY_META, PRIORITY_PILL, REQUEST_STATUS_PILL, TEAM_LABEL,
  SOURCE_LABEL, autoAssignTeam,
} from "./serviceMeta";

/**
 * Staff-facing hotel-style Resident Services desk (Phase 7 cont.) — live via
 * Supabase realtime + polling fallback. Full ticket workflow:
 * request (portal / AI voice / call bell / front desk) → priority ticket →
 * auto-assigned team → in progress → completed with photo proof → resident
 * confirmation & ★ rating → billable ServiceCharge posted → analytics.
 */

type Row = Record<string, unknown>;

const rel = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});

const adaptTicket = (r: Row) => {
  const resident = rel(r.resident);
  return {
    id: String(r.id ?? ""),
    residentId: String(r.residentId ?? ""),
    residentName: `${String(resident.firstName ?? "")} ${String(resident.lastName ?? "")}`.trim() || "—",
    roomNumber: String(r.roomNumber ?? resident.roomNumber ?? ""),
    category: String(r.category ?? "HOUSEKEEPING"),
    subType: String(r.subType ?? ""),
    details: String(r.details ?? ""),
    source: String(r.source ?? "RESIDENT_PORTAL"),
    priority: String(r.priority ?? "ROUTINE"),
    status: String(r.status ?? "OPEN"),
    assignedTeam: r.assignedTeam ? String(r.assignedTeam) : "",
    assignedTo: String(r.assignedTo ?? ""),
    photoProofUrl: String(r.photoProofUrl ?? ""),
    completedAt: r.completedAt ? String(r.completedAt) : "",
    rating: Number(r.rating ?? 0),
    ratingComment: String(r.ratingComment ?? ""),
    billable: Boolean(r.billable),
    charge: Number(r.charge ?? 0),
    billed: Boolean(r.billed),
    createdAt: String(r.createdAt ?? ""),
  };
};
type ServiceTicket = ReturnType<typeof adaptTicket>;

const adaptResident = (r: Row) => ({
  id: String(r.id ?? ""),
  name: `${String(r.firstName ?? "")} ${String(r.lastName ?? "")}`.trim(),
  roomNumber: String(r.roomNumber ?? ""),
});
type ResidentOpt = ReturnType<typeof adaptResident>;

const STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CONFIRMED", "CANCELLED"];
const PRIORITIES = ["ROUTINE", "URGENT", "EMERGENCY"];
const DAY_MS = 86400000;

const emptyForm = {
  residentId: "", category: "HOUSEKEEPING", subType: "Room Clean",
  priority: "ROUTINE", source: "FRONT_DESK", details: "", photo: "",
  billable: false, charge: "",
};

const isLast30Days = (iso: string) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !isNaN(t) && Date.now() - t <= 30 * DAY_MS;
};

export default function ServiceRequestsBoard({ categories }: { categories?: string[] } = {}) {
  const { data: rows, loading, error, refetch } = useLiveQuery<Row>(
    "service-requests", { query: "include=resident&take=400", tables: ["ServiceRequest"] }
  );
  const residentsQ = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });

  // When a role-scoped portal (Housekeeping / Maintenance) passes `categories`,
  // the whole board — tickets, stats, filters — is restricted to those categories.
  const tickets = useMemo<ServiceTicket[]>(
    () => rows.map(adaptTicket).filter((t) => !categories || categories.includes(t.category)),
    [rows, categories]
  );
  const residents = useMemo<ResidentOpt[]>(() => residentsQ.data.map(adaptResident), [residentsQ.data]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [starting, setStarting] = useState<ServiceTicket | null>(null);
  const [completing, setCompleting] = useState<ServiceTicket | null>(null);
  const perPage = 12;
  const tableScrollRef = useWheelToPage<HTMLDivElement>();

  // shadcn feedback: toasts (success/error) + promise-based confirm dialog.
  const { toasts, toast, dismiss } = useToast();
  const { confirm, confirmDialog } = useConfirm();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter(t => {
      if (q && !t.residentName.toLowerCase().includes(q) && !t.roomNumber.toLowerCase().includes(q) && !t.details.toLowerCase().includes(q) && !t.subType.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      return true;
    });
  }, [tickets, search, statusFilter, categoryFilter, priorityFilter]);

  const stats = useMemo(() => {
    const rated = tickets.filter(t => t.rating >= 1);
    const done30 = tickets.filter(t => ["COMPLETED", "CONFIRMED"].includes(t.status) && isLast30Days(t.completedAt));
    return {
      open: tickets.filter(t => ["OPEN", "ASSIGNED"].includes(t.status)).length,
      inProgress: tickets.filter(t => t.status === "IN_PROGRESS").length,
      emergency: tickets.filter(t => t.priority === "EMERGENCY" && !["COMPLETED", "CONFIRMED", "CANCELLED"].includes(t.status)).length,
      done30: done30.length,
      billed30: tickets.filter(t => t.billed && isLast30Days(t.completedAt)).reduce((s, t) => s + t.charge, 0),
      avgRating: rated.length ? rated.reduce((s, t) => s + t.rating, 0) / rated.length : 0,
    };
  }, [tickets]);

  const categoryChart = useMemo(() =>
    Object.keys(CATEGORY_META).map(c => ({
      name: CATEGORY_META[c].label,
      tickets: tickets.filter(t => t.category === c).length,
    })).filter(d => d.tickets > 0),
  [tickets]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  /* ── Workflow actions ── */

  const handleCreate = async () => {
    if (!form.residentId || !form.details) {
      toast("error", "Missing Fields", "Resident and request details are required.");
      return;
    }
    const team = autoAssignTeam(form.category, form.subType);
    if (!(await confirm({
      title: "Create Service Ticket?",
      description: `Auto-assigns to ${TEAM_LABEL[team]}.`,
      confirmText: "Create Ticket",
    }))) return;
    try {
      const resident = residents.find(r => r.id === form.residentId);
      await createRecord("service-requests", {
        residentId: form.residentId,
        roomNumber: resident?.roomNumber || null,
        category: form.category,
        subType: form.subType || null,
        details: form.details,
        source: form.source,
        priority: form.priority,
        status: "ASSIGNED",
        assignedTeam: team,
        billable: form.billable,
        charge: form.billable && form.charge !== "" ? Number(form.charge) || 0 : null,
        photoProofUrl: form.photo || null,
      });
      await refetch();
      setShowCreate(false);
      setForm(emptyForm);
      toast("success", "Ticket Created", `Assigned to ${TEAM_LABEL[team]}.`);
    } catch (err) {
      toast("error", "Create Failed", err instanceof Error ? err.message : "Could not create ticket.");
    }
  };

  // Opens the shadcn Start Work dialog; the update runs in submitStart.
  const handleStart = (t: ServiceTicket) => setStarting(t);

  const submitStart = async (worker: string) => {
    const t = starting;
    if (!t) return;
    setStarting(null);
    setBusyId(t.id);
    try {
      await updateRecord("service-requests", t.id, {
        status: "IN_PROGRESS",
        assignedTo: worker || null,
        startedAt: new Date().toISOString(),
      });
      await refetch();
    } catch (err) {
      toast("error", "Update Failed", err instanceof Error ? err.message : "Could not start work.");
    } finally {
      setBusyId(null);
    }
  };

  // Opens the shadcn Complete-with-Photo-Proof dialog; the update runs in submitComplete.
  const handleComplete = (t: ServiceTicket) => setCompleting(t);

  const submitComplete = async (photo: string, charge: number) => {
    const t = completing;
    if (!t) return;
    setCompleting(null);
    setBusyId(t.id);
    try {
      const billable = charge > 0;
      await updateRecord("service-requests", t.id, {
        status: "COMPLETED",
        completedAt: new Date().toISOString(),
        photoProofUrl: photo || null,
        billable,
        charge: billable ? charge : null,
        billed: billable,
      });
      // Billable services post straight into the invoice pipeline as a ServiceCharge.
      if (billable) {
        await createRecord("service-charges", {
          residentId: t.residentId,
          description: `${CATEGORY_META[t.category]?.label ?? t.category}${t.subType ? ` — ${t.subType}` : ""} (Ticket ${t.id.slice(0, 8)})`,
          amount: charge,
          serviceDate: new Date().toISOString(),
          category: "Hotel Services",
        });
      }
      await refetch();
      toast(
        "success",
        "Ticket Completed",
        billable
          ? `₱${charge.toLocaleString()} posted to the resident's invoice pipeline. Resident notified to confirm & rate.`
          : "Resident notified to confirm & rate the service.",
      );
    } catch (err) {
      toast("error", "Complete Failed", err instanceof Error ? err.message : "Could not complete ticket.");
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (t: ServiceTicket) => {
    if (!(await confirm({
      title: "Cancel Ticket?",
      description: `Cancel this ${CATEGORY_META[t.category]?.label ?? t.category} request for ${t.residentName}?`,
      confirmText: "Cancel Ticket",
      destructive: true,
    }))) return;
    setBusyId(t.id);
    try {
      await updateRecord("service-requests", t.id, { status: "CANCELLED" });
      await refetch();
    } catch (err) {
      toast("error", "Cancel Failed", err instanceof Error ? err.message : "Could not cancel ticket.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (t: ServiceTicket) => {
    if (!(await confirm({
      title: "Delete Ticket?",
      description: "Remove this ticket permanently?",
      confirmText: "Delete",
      destructive: true,
    }))) return;
    try {
      await deleteRecord("service-requests", t.id);
      await refetch();
    } catch (err) {
      toast("error", "Delete Failed", err instanceof Error ? err.message : "Could not delete ticket.");
    }
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value;
    setForm(f => {
      const next = { ...f, [field]: value };
      // Keep subType valid when the category changes.
      if (field === "category") next.subType = CATEGORY_META[String(value)]?.subTypes[0] ?? "";
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Resident Services
          </h1>
          <p className="text-gray-600">Hotel-style ticket desk — aircon/HVAC · housekeeping · room service · laundry · repairs</p>
        </div>
        <div className="flex gap-2">
          <RefreshButton onRefresh={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium" />
          {/* Tickets originate from residents or the Facility Admin front desk — crew
              portals (scoped via `categories`) work the queue but don't raise tickets. */}
          {!categories && (
            <button onClick={() => { setForm(emptyForm); setShowCreate(true); }} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
              <Plus className="w-4 h-4" /> New Ticket (Front Desk)
            </button>
          )}
        </div>
      </div>

      {/* Stat Boxes */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatBox label="Open Tickets" value={String(stats.open)} icon={Ticket} color="blue" />
        <StatBox label="In Progress" value={String(stats.inProgress)} icon={Timer} color="amber" />
        <StatBox label="Active Emergencies" value={String(stats.emergency)} icon={ConciergeBell} color="red" />
        <StatBox label="Completed (30d)" value={String(stats.done30)} icon={CheckCircle2} color="green" />
        <StatBox label="Billed (30d)" value={`₱${Math.round(stats.billed30).toLocaleString()}`} icon={CircleDollarSign} color="amber" />
        <StatBox label="Avg Satisfaction" value={stats.avgRating ? `${stats.avgRating.toFixed(1)} ★` : "—"} icon={Star} color="purple" />
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          {["all", ...STATUSES].map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
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
            <input type="text" placeholder="Search resident, room, or details…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
          </div>
          <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
            <option value="all">All Categories</option>
            {Object.entries(CATEGORY_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
          <select value={priorityFilter} onChange={e => { setPriorityFilter(e.target.value); setPage(1); }}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
            <option value="all">All Priorities</option>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* Ticket table */}
      {loading && tickets.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading service tickets...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No service tickets match your filters.</div>
      ) : (
        <div ref={tableScrollRef} className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Category</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Resident · Room</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Details</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Source</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Priority</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Team</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Charge</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">Rating</th>
                {/* Actions only for crew portals (Housekeeping/Maintenance); Facility
                    Admin front desk submits tickets but doesn't work them. */}
                {categories && <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.map(t => {
                const meta = CATEGORY_META[t.category] ?? CATEGORY_META.HOUSEKEEPING;
                const CatIcon = meta.icon;
                const busy = busyId === t.id;
                return (
                  <tr key={t.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${meta.cls}`}>
                        <CatIcon className="w-3 h-3" /> {meta.label}
                      </span>
                      {t.subType && <p className="text-[11px] text-gray-500 mt-0.5">{t.subType}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{t.residentName}</p>
                      <p className="text-xs text-gray-500">Room {t.roomNumber || "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs max-w-[220px]">
                      <p className="truncate" title={t.details}>{t.details || "—"}</p>
                      {t.photoProofUrl && (
                        <a href={t.photoProofUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 mt-0.5">
                          <Camera className="w-3 h-3" /> Photo proof
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{SOURCE_LABEL[t.source] ?? t.source}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${PRIORITY_PILL[t.priority] ?? PRIORITY_PILL.ROUTINE}`}>{t.priority}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {t.assignedTeam ? TEAM_LABEL[t.assignedTeam] ?? t.assignedTeam : "—"}
                      {t.assignedTo && <p className="text-[11px] text-gray-400">{t.assignedTo}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${REQUEST_STATUS_PILL[t.status] ?? "bg-gray-100 text-gray-700"}`}>
                        {t.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 font-medium">
                      {t.charge ? `₱${t.charge.toLocaleString()}` : "—"}
                      {t.billed && <p className="text-[10px] text-green-600 font-semibold">POSTED</p>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {t.rating >= 1 ? (
                        <span className="inline-flex items-center gap-0.5 text-amber-500 font-semibold text-xs" title={t.ratingComment}>
                          {t.rating} <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                        </span>
                      ) : t.status === "COMPLETED" ? (
                        <span className="text-[10px] text-gray-400">awaiting</span>
                      ) : "—"}
                    </td>
                    {categories && (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1 flex-wrap">
                        {busy ? (
                          <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                        ) : (
                          <>
                            {["OPEN", "ASSIGNED"].includes(t.status) && (
                              <button onClick={() => handleStart(t)} className="p-1.5 rounded hover:bg-amber-100 text-amber-600 transition" title="Start Work"><Play className="w-4 h-4" /></button>
                            )}
                            {t.status === "IN_PROGRESS" && (
                              <button onClick={() => handleComplete(t)} className="p-1.5 rounded hover:bg-green-100 text-green-600 transition" title="Complete with Photo Proof"><CheckCircle2 className="w-4 h-4" /></button>
                            )}
                            {t.status === "COMPLETED" && (
                              <span className="p-1.5 text-emerald-600" title="Awaiting resident confirmation"><UserCheck className="w-4 h-4" /></span>
                            )}
                            {!["COMPLETED", "CONFIRMED", "CANCELLED"].includes(t.status) && (
                              <button onClick={() => handleCancel(t)} className="p-1.5 rounded hover:bg-red-100 text-red-500 transition" title="Cancel"><Ban className="w-4 h-4" /></button>
                            )}
                            <button onClick={() => handleDelete(t)} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
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
      {filtered.length > perPage && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm text-gray-600">{filtered.length} tickets total</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Previous</button>
            <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Next</button>
          </div>
        </div>
      )}

      {/* Service Analytics */}
      {categoryChart.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="w-4 h-4 text-yellow-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Service Analytics — Tickets per Category</h3>
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryChart} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" fontSize={10} tickLine={false} axisLine={false} width={130} />
                <Tooltip />
                <Bar dataKey="tickets" name="Tickets" fill="#f59e0b" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold">New Service Ticket</h2>
              <button onClick={() => setShowCreate(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Resident</label>
                  <select value={form.residentId} onChange={set("residentId")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    <option value="">Select resident…</option>
                    {residents.map(r => <option key={r.id} value={r.id}>{r.name} — Room {r.roomNumber}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Category</label>
                  <select value={form.category} onChange={set("category")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    {Object.entries(CATEGORY_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Sub-type</label>
                  <select value={form.subType} onChange={set("subType")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    {(CATEGORY_META[form.category]?.subTypes ?? []).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Priority</label>
                  <select value={form.priority} onChange={set("priority")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Source</label>
                  <select value={form.source} onChange={set("source")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    <option value="FRONT_DESK">Front Desk</option>
                    <option value="CALL_BELL">Call Bell</option>
                    <option value="AI_COMPANION">AI Companion Voice</option>
                    <option value="RESIDENT_PORTAL">Resident Portal</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Request Details</label>
                  <textarea value={form.details} onChange={set("details")} rows={3} placeholder="e.g. Aircon not cooling; please check the filter." className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Photo (optional)</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* capture="environment" opens the rear camera on a phone. */}
                    <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 cursor-pointer">
                      <Camera className="w-4 h-4" /> Take Photo
                      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; const url = await downscaleImage(f); setForm(p => ({ ...p, photo: url })); }} />
                    </label>
                    <label className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
                      <Upload className="w-4 h-4" /> Upload
                      <input type="file" accept="image/*" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; const url = await downscaleImage(f); setForm(p => ({ ...p, photo: url })); }} />
                    </label>
                    {form.photo && (
                      <span className="inline-flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={form.photo} alt="ticket" className="h-12 w-12 object-cover rounded border border-gray-200" />
                        <button type="button" onClick={() => setForm(p => ({ ...p, photo: "" }))} className="text-xs text-red-600 hover:underline">Remove</button>
                      </span>
                    )}
                  </div>
                </div>
                <div className="col-span-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-800">
                  Auto-assign: <strong>{TEAM_LABEL[autoAssignTeam(form.category, form.subType)]}</strong>
                </div>
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setShowCreate(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
              <button onClick={handleCreate} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">Create Ticket</button>
            </div>
          </div>
        </div>
      )}

      {/* shadcn work-order dialogs (replace the old SweetAlert2 popups) */}
      <StartWorkDialog
        open={!!starting}
        onOpenChange={(o) => { if (!o) setStarting(null); }}
        context={starting ? `${CATEGORY_META[starting.category]?.label ?? starting.category} — ${starting.residentName} (Room ${starting.roomNumber})` : undefined}
        defaultWorker={starting?.assignedTo || ""}
        onSubmit={submitStart}
      />
      <CompleteTicketDialog
        open={!!completing}
        onOpenChange={(o) => { if (!o) setCompleting(null); }}
        defaultPhotoUrl={completing?.photoProofUrl || ""}
        defaultCharge={completing?.charge || 0}
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
