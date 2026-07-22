"use client";

import { useMemo, useState } from "react";
import {
  Wrench, RefreshCw, Plus, X, Edit, Trash2, Search, CalendarClock,
  ClipboardCheck, Clock, CircleDollarSign, PackageSearch, Play,
  CheckCircle2, Ban, AlertTriangle, Gauge, Bus, Loader2,
  type LucideIcon,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

/* ── Constants ── */

const STATUSES = ["SCHEDULED", "OPEN", "IN_PROGRESS", "AWAITING_PARTS", "COMPLETED", "CANCELLED"];
const TYPES = ["PREVENTIVE", "REPAIR", "INSPECTION"];

const STATUS_STYLES: Record<string, string> = {
  SCHEDULED: "bg-gray-100 text-gray-700",
  OPEN: "bg-blue-100 text-blue-700",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  AWAITING_PARTS: "bg-purple-100 text-purple-700",
  COMPLETED: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-700",
};

const TYPE_META: Record<string, { icon: LucideIcon; cls: string }> = {
  PREVENTIVE: { icon: CalendarClock, cls: "bg-blue-100 text-blue-700" },
  REPAIR: { icon: Wrench, cls: "bg-red-100 text-red-700" },
  INSPECTION: { icon: ClipboardCheck, cls: "bg-purple-100 text-purple-700" },
};

const DAY_MS = 86400000;

/* ── Adapt helpers ── */

type Row = Record<string, unknown>;

const rel = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});

const adaptWorkOrder = (r: Row) => {
  const vehicle = rel(r.vehicle);
  return {
    id: String(r.id ?? ""),
    vehicleId: String(r.vehicleId ?? ""),
    vehicleName: String(vehicle.name ?? "—"),
    vehiclePlate: String(vehicle.licensePlate ?? ""),
    type: String(r.type ?? "REPAIR"),
    status: String(r.status ?? "OPEN"),
    title: String(r.title ?? "Work order"),
    description: String(r.description ?? ""),
    scheduledDate: r.scheduledDate ? String(r.scheduledDate) : "",
    completedDate: r.completedDate ? String(r.completedDate) : "",
    odometerAt: Number(r.odometerAt ?? 0),
    cost: Number(r.cost ?? 0),
    vendor: String(r.vendor ?? ""),
    downtimeHours: Number(r.downtimeHours ?? 0),
    notes: String(r.notes ?? ""),
  };
};
type WorkOrder = ReturnType<typeof adaptWorkOrder>;

const adaptVehicle = (r: Row) => ({
  id: String(r.id ?? ""),
  name: String(r.name ?? "Vehicle"),
  licensePlate: String(r.licensePlate ?? ""),
  status: String(r.status ?? "AVAILABLE"),
  odometer: Number(r.odometer ?? 0),
  nextServiceDate: r.nextServiceDate ? String(r.nextServiceDate) : "",
  nextServiceOdometer: Number(r.nextServiceOdometer ?? 0),
});
type Vehicle = ReturnType<typeof adaptVehicle>;

const emptyForm = {
  vehicleId: "", type: "PREVENTIVE", status: "SCHEDULED", title: "",
  description: "", scheduledDate: "", vendor: "", odometerAt: "",
  cost: "", downtimeHours: "", notes: "",
};

const isLast30Days = (iso: string) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !isNaN(t) && Date.now() - t <= 30 * DAY_MS && t <= Date.now() + DAY_MS;
};

export default function FleetMaintenance() {
  const { data: woRows, loading, error, refetch } = useLiveQuery<Row>(
    "vehicle-maintenance", { query: "include=vehicle&take=300", tables: ["VehicleMaintenance", "Vehicle"] }
  );
  const vehiclesQ = useLiveQuery<Row>("vehicles", { query: "take=300", tables: ["Vehicle"] });

  const orders = useMemo<WorkOrder[]>(() => woRows.map(adaptWorkOrder), [woRows]);
  const vehicles = useMemo<Vehicle[]>(() => vehiclesQ.data.map(adaptVehicle), [vehiclesQ.data]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [vehicleFilter, setVehicleFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<WorkOrder | null>(null);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState(emptyForm);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const perPage = 12;

  const refreshAll = async () => { await refetch(); await vehiclesQ.refetch(); };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter(w => {
      if (q && !w.title.toLowerCase().includes(q) && !w.vendor.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && w.status !== statusFilter) return false;
      if (typeFilter !== "all" && w.type !== typeFilter) return false;
      if (vehicleFilter !== "all" && w.vehicleId !== vehicleFilter) return false;
      return true;
    });
  }, [orders, search, statusFilter, typeFilter, vehicleFilter]);

  const stats = useMemo(() => {
    const completed30 = orders.filter(w => w.status === "COMPLETED" && isLast30Days(w.completedDate));
    const recent = orders.filter(w => isLast30Days(w.completedDate || w.scheduledDate));
    return {
      open: orders.filter(w => ["SCHEDULED", "OPEN"].includes(w.status)).length,
      inProgress: orders.filter(w => w.status === "IN_PROGRESS").length,
      awaitingParts: orders.filter(w => w.status === "AWAITING_PARTS").length,
      completed30: completed30.length,
      cost30: recent.reduce((s, w) => s + w.cost, 0),
      downtime30: recent.reduce((s, w) => s + w.downtimeHours, 0),
    };
  }, [orders]);

  const preventiveDue = useMemo(() =>
    vehicles.filter(v => {
      // eslint-disable-next-line react-hooks/purity
      const dateDue = v.nextServiceDate && new Date(v.nextServiceDate).getTime() < Date.now();
      const odoDue = v.nextServiceOdometer > 0 && v.odometer >= v.nextServiceOdometer;
      return dateDue || odoDue;
    }),
  [vehicles]);

  const downtimeChart = useMemo(() =>
    vehicles
      .map(v => ({
        name: v.name,
        hours: orders.filter(w => w.vehicleId === v.id).reduce((s, w) => s + w.downtimeHours, 0),
      }))
      .filter(d => d.hours > 0)
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 10),
  [vehicles, orders]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  /* ── Form payload ── */
  const buildPayload = (form: typeof emptyForm) => ({
    vehicleId: form.vehicleId,
    type: form.type,
    status: form.status,
    title: form.title,
    description: form.description,
    scheduledDate: form.scheduledDate ? new Date(form.scheduledDate).toISOString() : null,
    vendor: form.vendor,
    odometerAt: form.odometerAt !== "" ? Number(form.odometerAt) || 0 : null,
    cost: form.cost !== "" ? Number(form.cost) || 0 : null,
    downtimeHours: form.downtimeHours !== "" ? Number(form.downtimeHours) || 0 : null,
    notes: form.notes,
  });

  /* ── CRUD ── */
  const handleCreate = async () => {
    if (!createForm.vehicleId || !createForm.title) {
      Swal.fire({ title: "Missing Fields", text: "Vehicle and title are required.", icon: "warning" });
      return;
    }
    const confirmed = await Swal.fire({
      title: "Create Work Order?", icon: "question", showCancelButton: true,
      confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280", confirmButtonText: "Create",
    });
    if (!confirmed.isConfirmed) return;
    try {
      await createRecord("vehicle-maintenance", buildPayload(createForm));
      await refreshAll();
      setShowCreate(false);
      setCreateForm(emptyForm);
      Swal.fire({ title: "Created", text: `Work order "${createForm.title}" created.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Create Failed", text: err instanceof Error ? err.message : "Could not create work order.", icon: "error" });
    }
  };

  const startEditing = (w: WorkOrder) => {
    setEditing(w);
    setEditForm({
      vehicleId: w.vehicleId, type: w.type, status: w.status, title: w.title,
      description: w.description,
      scheduledDate: w.scheduledDate ? w.scheduledDate.split("T")[0] : "",
      vendor: w.vendor,
      odometerAt: w.odometerAt ? String(w.odometerAt) : "",
      cost: w.cost ? String(w.cost) : "",
      downtimeHours: w.downtimeHours ? String(w.downtimeHours) : "",
      notes: w.notes,
    });
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    const confirmed = await Swal.fire({
      title: "Save Changes?", icon: "question", showCancelButton: true,
      confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280", confirmButtonText: "Save",
    });
    if (!confirmed.isConfirmed) return;
    try {
      await updateRecord("vehicle-maintenance", editing.id, buildPayload(editForm));
      await refreshAll();
      setEditing(null);
      Swal.fire({ title: "Saved", text: "Work order updated.", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Save Failed", text: err instanceof Error ? err.message : "Could not update work order.", icon: "error" });
    }
  };

  const handleDelete = async (w: WorkOrder) => {
    const confirmed = await Swal.fire({
      title: "Delete Work Order?", text: `Remove "${w.title}"?`, icon: "warning",
      showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete",
    });
    if (!confirmed.isConfirmed) return;
    try {
      await deleteRecord("vehicle-maintenance", w.id);
      await refreshAll();
      Swal.fire({ title: "Deleted", text: "Work order removed.", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Delete Failed", text: err instanceof Error ? err.message : "Could not delete work order.", icon: "error" });
    }
  };

  /* ── Status actions with vehicle side-effects ── */
  const handleStartWork = async (w: WorkOrder) => {
    const confirmed = await Swal.fire({
      title: "Start Work?", text: `"${w.title}" — the vehicle will be marked as under MAINTENANCE.`,
      icon: "question", showCancelButton: true,
      confirmButtonColor: "#f59e0b", cancelButtonColor: "#6b7280", confirmButtonText: "Start Work",
    });
    if (!confirmed.isConfirmed) return;
    setBusyId(w.id);
    try {
      await updateRecord("vehicle-maintenance", w.id, { status: "IN_PROGRESS" });
      if (w.vehicleId) await updateRecord("vehicles", w.vehicleId, { status: "MAINTENANCE" });
      await refreshAll();
      Swal.fire({ title: "In Progress", text: `${w.vehicleName} is now in the garage.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Update Failed", text: err instanceof Error ? err.message : "Could not start work.", icon: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const handleAwaitingParts = async (w: WorkOrder) => {
    const confirmed = await Swal.fire({
      title: "Awaiting Parts?", text: `Mark "${w.title}" as waiting for parts?`,
      icon: "question", showCancelButton: true,
      confirmButtonColor: "#8b5cf6", cancelButtonColor: "#6b7280", confirmButtonText: "Awaiting Parts",
    });
    if (!confirmed.isConfirmed) return;
    setBusyId(w.id);
    try {
      await updateRecord("vehicle-maintenance", w.id, { status: "AWAITING_PARTS" });
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Update Failed", text: err instanceof Error ? err.message : "Could not update status.", icon: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const handleComplete = async (w: WorkOrder) => {
    const result = await Swal.fire({
      title: "Complete Work Order",
      html:
        `<p class="swal2-text" style="font-size:14px;margin-bottom:10px">"${w.title}" — enter final figures:</p>` +
        `<input id="swal-cost" type="number" min="0" step="0.01" class="swal2-input" placeholder="Final cost (₱)" value="${w.cost || ""}">` +
        `<input id="swal-downtime" type="number" min="0" step="0.5" class="swal2-input" placeholder="Downtime hours" value="${w.downtimeHours || ""}">`,
      icon: "question", showCancelButton: true,
      confirmButtonColor: "#22c55e", cancelButtonColor: "#6b7280", confirmButtonText: "Complete",
      preConfirm: () => ({
        cost: Number((document.getElementById("swal-cost") as HTMLInputElement | null)?.value ?? 0) || 0,
        downtimeHours: Number((document.getElementById("swal-downtime") as HTMLInputElement | null)?.value ?? 0) || 0,
      }),
    });
    if (!result.isConfirmed) return;
    const { cost, downtimeHours } = (result.value as { cost: number; downtimeHours: number }) ?? { cost: 0, downtimeHours: 0 };
    setBusyId(w.id);
    try {
      const now = new Date();
      const nowIso = now.toISOString();
      await updateRecord("vehicle-maintenance", w.id, {
        status: "COMPLETED", completedDate: nowIso, cost, downtimeHours,
      });
      if (w.vehicleId) {
        const vehicle = vehicles.find(v => v.id === w.vehicleId);
        const baseOdo = w.odometerAt || vehicle?.odometer || 0;
        await updateRecord("vehicles", w.vehicleId, {
          status: "AVAILABLE",
          lastServiceDate: nowIso,
          ...(w.type === "PREVENTIVE"
            ? {
                nextServiceDate: new Date(now.getTime() + 90 * DAY_MS).toISOString(),
                nextServiceOdometer: baseOdo + 5000,
              }
            : {}),
        });
      }
      await refreshAll();
      Swal.fire({ title: "Work order closed — vehicle back in service", icon: "success", timer: 2000, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Complete Failed", text: err instanceof Error ? err.message : "Could not complete work order.", icon: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (w: WorkOrder) => {
    const confirmed = await Swal.fire({
      title: "Cancel Work Order?", text: `Cancel "${w.title}"?`, icon: "warning",
      showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Cancel Order",
    });
    if (!confirmed.isConfirmed) return;
    setBusyId(w.id);
    try {
      await updateRecord("vehicle-maintenance", w.id, { status: "CANCELLED" });
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Cancel Failed", text: err instanceof Error ? err.message : "Could not cancel work order.", icon: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const scheduleService = (v: Vehicle) => {
    setCreateForm({
      ...emptyForm,
      vehicleId: v.id,
      type: "PREVENTIVE",
      status: "SCHEDULED",
      title: `Preventive service — ${v.name}`,
      odometerAt: String(v.odometer || ""),
      scheduledDate: new Date().toISOString().split("T")[0],
    });
    setShowCreate(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Fleet Maintenance
          </h1>
          <p className="text-gray-600">Preventive schedule · repair work orders · garage &amp; vendor service</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void refreshAll()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={() => { setCreateForm(emptyForm); setShowCreate(true); }} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
            <Plus className="w-4 h-4" /> New Work Order
          </button>
        </div>
      </div>

      {/* Stat Boxes */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatBox label="Open Orders" value={String(stats.open)} icon={Wrench} color="blue" />
        <StatBox label="In Progress" value={String(stats.inProgress)} icon={Play} color="amber" />
        <StatBox label="Awaiting Parts" value={String(stats.awaitingParts)} icon={PackageSearch} color="purple" />
        <StatBox label="Completed (30d)" value={String(stats.completed30)} icon={CheckCircle2} color="green" />
        <StatBox label="Total Cost (30d)" value={`₱${Math.round(stats.cost30).toLocaleString()}`} icon={CircleDollarSign} color="amber" />
        <StatBox label="Downtime (30d)" value={`${stats.downtime30} h`} icon={Clock} color="red" />
      </div>

      {/* Preventive Due panel */}
      {preventiveDue.length > 0 && (
        <div className="bg-white rounded-lg border border-red-200 ring-1 ring-red-100 p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Preventive Maintenance Due</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">{preventiveDue.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {preventiveDue.map(v => {
              const odoDue = v.nextServiceOdometer > 0 && v.odometer >= v.nextServiceOdometer;
              return (
                <div key={v.id} className="border border-gray-200 rounded-lg p-3 flex items-center gap-3">
                  <Bus className="w-5 h-5 text-red-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{v.name} <span className="text-xs text-gray-400 font-normal">{v.licensePlate}</span></p>
                    <p className="text-xs text-gray-500 truncate">
                      {odoDue
                        ? `${v.odometer.toLocaleString()} km ≥ ${v.nextServiceOdometer.toLocaleString()} km`
                        : v.nextServiceDate ? `Due ${new Date(v.nextServiceDate).toLocaleDateString()}` : "Service due"}
                    </p>
                  </div>
                  <button onClick={() => scheduleService(v)} className="px-3 py-1.5 text-xs font-semibold bg-yellow-400 hover:bg-yellow-500 text-black rounded-lg transition whitespace-nowrap">
                    Schedule Service
                  </button>
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
            <input type="text" placeholder="Search title or vendor…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
          </div>
          <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
            <option value="all">All Types</option>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={vehicleFilter} onChange={e => { setVehicleFilter(e.target.value); setPage(1); }}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
            <option value="all">All Vehicles</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.name} ({v.licensePlate})</option>)}
          </select>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* Table */}
      {loading && orders.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading work orders...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No work orders match your filters.</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Title</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Vehicle</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Garage / Vendor Service</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Scheduled</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Cost</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Downtime</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Odometer</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.map(w => {
                const meta = TYPE_META[w.type] || TYPE_META.REPAIR;
                const TypeIcon = meta.icon;
                const busy = busyId === w.id;
                return (
                  <tr key={w.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${meta.cls}`}>
                        <TypeIcon className="w-3 h-3" /> {w.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-[220px] truncate" title={w.title}>{w.title}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{w.vehicleName}{w.vehiclePlate ? ` · ${w.vehiclePlate}` : ""}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{w.vendor || "—"}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{w.scheduledDate ? new Date(w.scheduledDate).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_STYLES[w.status] || "bg-gray-100 text-gray-700"}`}>
                        {w.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 font-medium">{w.cost ? `₱${w.cost.toLocaleString()}` : "—"}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{w.downtimeHours ? `${w.downtimeHours} h` : "—"}</td>
                    <td className="px-4 py-3 text-right text-gray-600 text-xs">{w.odometerAt ? `${w.odometerAt.toLocaleString()} km` : "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1 flex-wrap">
                        {busy ? (
                          <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                        ) : (
                          <>
                            {["SCHEDULED", "OPEN", "AWAITING_PARTS"].includes(w.status) && (
                              <button onClick={() => handleStartWork(w)} className="p-1.5 rounded hover:bg-amber-100 text-amber-600 transition" title="Start Work"><Play className="w-4 h-4" /></button>
                            )}
                            {w.status === "IN_PROGRESS" && (
                              <button onClick={() => handleAwaitingParts(w)} className="p-1.5 rounded hover:bg-purple-100 text-purple-600 transition" title="Awaiting Parts"><PackageSearch className="w-4 h-4" /></button>
                            )}
                            {["IN_PROGRESS", "AWAITING_PARTS"].includes(w.status) && (
                              <button onClick={() => handleComplete(w)} className="p-1.5 rounded hover:bg-green-100 text-green-600 transition" title="Complete"><CheckCircle2 className="w-4 h-4" /></button>
                            )}
                            {!["COMPLETED", "CANCELLED"].includes(w.status) && (
                              <button onClick={() => handleCancel(w)} className="p-1.5 rounded hover:bg-red-100 text-red-500 transition" title="Cancel"><Ban className="w-4 h-4" /></button>
                            )}
                            <button onClick={() => startEditing(w)} className="p-1.5 rounded hover:bg-yellow-100 text-yellow-600 transition" title="Edit"><Edit className="w-4 h-4" /></button>
                            <button onClick={() => handleDelete(w)} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
                          </>
                        )}
                      </div>
                    </td>
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
          <div className="text-sm text-gray-600">{filtered.length} work orders total</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Previous</button>
            <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Next</button>
          </div>
        </div>
      )}

      {/* Downtime Report chart */}
      {downtimeChart.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Gauge className="w-4 h-4 text-yellow-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Downtime Report — Hours per Vehicle</h3>
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={downtimeChart} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" fontSize={10} tickLine={false} axisLine={false} width={110} />
                <Tooltip />
                <Bar dataKey="hours" name="Downtime (h)" fill="#f59e0b" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <WorkOrderFormModal title="New Work Order" form={createForm} onChange={setCreateForm} onSave={handleCreate}
          onCancel={() => setShowCreate(false)} saveLabel="Create Order" vehicles={vehicles} />
      )}

      {/* Edit Modal */}
      {editing && (
        <WorkOrderFormModal title="Edit Work Order" form={editForm} onChange={setEditForm} onSave={handleSaveEdit}
          onCancel={() => setEditing(null)} saveLabel="Save Changes" vehicles={vehicles} />
      )}
    </div>
  );
}

/* ── Sub-components ── */

function StatBox({ label, value, icon: Icon, color }: { label: string; value: string; icon: LucideIcon; color: string }) {
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

function WorkOrderFormModal({ title, form, onChange, onSave, onCancel, saveLabel, vehicles }: {
  title: string;
  form: typeof emptyForm;
  onChange: (f: typeof emptyForm) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
  vehicles: Vehicle[];
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Vehicle</label>
              <select value={form.vehicleId} onChange={set("vehicleId")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                <option value="">Select vehicle…</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.name} ({v.licensePlate})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Type</label>
              <select value={form.type} onChange={set("type")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Status</label>
              <select value={form.status} onChange={set("status")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Title</label>
              <input type="text" value={form.title} onChange={set("title")} placeholder="e.g. Brake pad replacement" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
              <textarea value={form.description} onChange={set("description")} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Scheduled Date</label>
              <input type="date" value={form.scheduledDate} onChange={set("scheduledDate")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Garage / Vendor</label>
              <input type="text" value={form.vendor} onChange={set("vendor")} placeholder="Vendor or in-house garage" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Odometer At (km)</label>
              <input type="number" min="0" value={form.odometerAt} onChange={set("odometerAt")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Cost (₱)</label>
              <input type="number" min="0" step="0.01" value={form.cost} onChange={set("cost")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Downtime Hours</label>
              <input type="number" min="0" step="0.5" value={form.downtimeHours} onChange={set("downtimeHours")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div className="sm:col-span-2">
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
