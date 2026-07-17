"use client";

import { useMemo, useState } from "react";
import {
  Bus, Accessibility, Ambulance, Car, Search, AlertTriangle, Plus, X, Edit,
  Trash2, RefreshCw, LayoutGrid, Table2, Eye, Calendar, Hash, Gauge, Fuel,
  Users, ShieldCheck, ShieldAlert, Wrench, FileText, Satellite,
  type LucideIcon,
} from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
} from "recharts";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

/* ── Model adapter ── */

function adaptVehicle(r: Record<string, unknown>) {
  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    licensePlate: String(r.licensePlate ?? ""),
    type: String(r.type ?? "SEDAN"),
    status: String(r.status ?? "AVAILABLE"),
    make: String(r.make ?? ""),
    model: String(r.model ?? ""),
    year: Number(r.year ?? 0),
    vin: String(r.vin ?? ""),
    capacity: Number(r.capacity ?? 0),
    wheelchairCapacity: Number(r.wheelchairCapacity ?? 0),
    odometer: Number(r.odometer ?? 0),
    fuelLevel: Number(r.fuelLevel ?? 0),
    insuranceProvider: String(r.insuranceProvider ?? ""),
    insurancePolicyNumber: String(r.insurancePolicyNumber ?? ""),
    insuranceExpiry: r.insuranceExpiry ? String(r.insuranceExpiry) : "",
    registrationExpiry: r.registrationExpiry ? String(r.registrationExpiry) : "",
    lastServiceDate: r.lastServiceDate ? String(r.lastServiceDate) : "",
    nextServiceDate: r.nextServiceDate ? String(r.nextServiceDate) : "",
    nextServiceOdometer: r.nextServiceOdometer != null ? Number(r.nextServiceOdometer) : null,
    gpsDeviceId: String(r.gpsDeviceId ?? ""),
    notes: String(r.notes ?? ""),
    raw: r,
  };
}

type Vehicle = ReturnType<typeof adaptVehicle>;

/* ── Constants ── */

const TYPES = ["SHUTTLE", "WHEELCHAIR_VAN", "AMBULANCE", "SEDAN"];
const STATUSES = ["AVAILABLE", "ON_TRIP", "MAINTENANCE", "OUT_OF_SERVICE"];

const TYPE_ICONS: Record<string, LucideIcon> = {
  SHUTTLE: Bus, WHEELCHAIR_VAN: Accessibility, AMBULANCE: Ambulance, SEDAN: Car,
};

const STATUS_PILLS: Record<string, string> = {
  AVAILABLE: "bg-green-100 text-green-700",
  ON_TRIP: "bg-blue-100 text-blue-700",
  MAINTENANCE: "bg-amber-100 text-amber-700",
  OUT_OF_SERVICE: "bg-red-100 text-red-700",
};

const STATUS_COLORS: Record<string, string> = {
  AVAILABLE: "#22c55e", ON_TRIP: "#3b82f6", MAINTENANCE: "#f59e0b", OUT_OF_SERVICE: "#ef4444",
};

const label = (s: string) => s.replace(/_/g, " ");

/* ── Compliance helpers ── */

type ExpiryState = { state: "none" | "ok" | "expiring" | "expired"; days: number };

function expiryState(iso: string): ExpiryState {
  if (!iso) return { state: "none", days: 0 };
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (days < 0) return { state: "expired", days };
  if (days <= 30) return { state: "expiring", days };
  return { state: "ok", days };
}

function hasComplianceAlert(v: Vehicle) {
  const ins = expiryState(v.insuranceExpiry).state;
  const reg = expiryState(v.registrationExpiry).state;
  return ins === "expired" || ins === "expiring" || reg === "expired" || reg === "expiring";
}

const emptyForm = {
  name: "", licensePlate: "", type: "SHUTTLE", status: "AVAILABLE",
  make: "", model: "", year: "", vin: "", capacity: "0", wheelchairCapacity: "0",
  odometer: "0", fuelLevel: "100", insuranceProvider: "", insurancePolicyNumber: "",
  insuranceExpiry: "", registrationExpiry: "", lastServiceDate: "", nextServiceDate: "",
  nextServiceOdometer: "", gpsDeviceId: "", notes: "",
};

export default function FleetVehicles() {
  const { data: vehicleRows, loading, error, refetch } = useLiveQuery<Record<string, unknown>>(
    "vehicles", { query: "take=300", tables: ["Vehicle"] }
  );
  const vehicles = useMemo<Vehicle[]>(() => vehicleRows.map(adaptVehicle), [vehicleRows]);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAlertsOnly, setShowAlertsOnly] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [viewing, setViewing] = useState<Vehicle | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState(emptyForm);
  const [page, setPage] = useState(1);
  const perPage = 24;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vehicles.filter(v => {
      if (q && !v.name.toLowerCase().includes(q) && !v.licensePlate.toLowerCase().includes(q) && !v.make.toLowerCase().includes(q) && !v.model.toLowerCase().includes(q)) return false;
      if (typeFilter !== "all" && v.type !== typeFilter) return false;
      if (statusFilter !== "all" && v.status !== statusFilter) return false;
      if (showAlertsOnly && !hasComplianceAlert(v)) return false;
      return true;
    });
  }, [vehicles, search, typeFilter, statusFilter, showAlertsOnly]);

  const stats = useMemo(() => ({
    total: vehicles.length,
    available: vehicles.filter(v => v.status === "AVAILABLE").length,
    onTrip: vehicles.filter(v => v.status === "ON_TRIP").length,
    maintenance: vehicles.filter(v => v.status === "MAINTENANCE").length,
    outOfService: vehicles.filter(v => v.status === "OUT_OF_SERVICE").length,
    alerts: vehicles.filter(hasComplianceAlert).length,
  }), [vehicles]);

  const statusDist = useMemo(() => {
    return STATUSES.map(s => ({
      name: label(s),
      value: vehicles.filter(v => v.status === s).length,
      color: STATUS_COLORS[s] || "#6b7280",
    })).filter(d => d.value > 0);
  }, [vehicles]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const start = (page - 1) * perPage;
  const paginated = filtered.slice(start, start + perPage);

  const handleStatusChange = async (v: Vehicle, status: string) => {
    try {
      await updateRecord("vehicles", v.id, { status });
      await refetch();
      if (viewing && viewing.id === v.id) setViewing({ ...viewing, status });
    } catch (err) {
      Swal.fire({ title: "Update Failed", text: err instanceof Error ? err.message : "Could not update status.", icon: "error" });
    }
  };

  const buildPayload = (form: typeof emptyForm) => ({
    name: form.name, licensePlate: form.licensePlate, type: form.type, status: form.status,
    make: form.make, model: form.model,
    year: Number(form.year) || null, vin: form.vin,
    capacity: Number(form.capacity) || 0,
    wheelchairCapacity: Number(form.wheelchairCapacity) || 0,
    odometer: Number(form.odometer) || 0,
    fuelLevel: Math.max(0, Math.min(100, Number(form.fuelLevel) || 0)),
    insuranceProvider: form.insuranceProvider, insurancePolicyNumber: form.insurancePolicyNumber,
    insuranceExpiry: form.insuranceExpiry ? new Date(form.insuranceExpiry).toISOString() : null,
    registrationExpiry: form.registrationExpiry ? new Date(form.registrationExpiry).toISOString() : null,
    lastServiceDate: form.lastServiceDate ? new Date(form.lastServiceDate).toISOString() : null,
    nextServiceDate: form.nextServiceDate ? new Date(form.nextServiceDate).toISOString() : null,
    nextServiceOdometer: form.nextServiceOdometer ? Number(form.nextServiceOdometer) || null : null,
    gpsDeviceId: form.gpsDeviceId, notes: form.notes,
  });

  const handleCreate = async () => {
    if (!createForm.name || !createForm.licensePlate) {
      Swal.fire({ title: "Missing Fields", text: "Vehicle name and license plate are required.", icon: "warning" });
      return;
    }
    const confirmed = await Swal.fire({
      title: "Add Vehicle?", icon: "question", showCancelButton: true,
      confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280", confirmButtonText: "Add",
    });
    if (!confirmed.isConfirmed) return;
    try {
      await createRecord("vehicles", buildPayload(createForm));
      await refetch();
      setShowCreate(false);
      setCreateForm(emptyForm);
      Swal.fire({ title: "Added", text: `${createForm.name} added to the fleet.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Add Failed", text: err instanceof Error ? err.message : "Could not add vehicle.", icon: "error" });
    }
  };

  const startEditing = (v: Vehicle) => {
    setEditing(v);
    setEditForm({
      name: v.name, licensePlate: v.licensePlate, type: v.type, status: v.status,
      make: v.make, model: v.model, year: v.year ? String(v.year) : "", vin: v.vin,
      capacity: String(v.capacity), wheelchairCapacity: String(v.wheelchairCapacity),
      odometer: String(v.odometer), fuelLevel: String(v.fuelLevel),
      insuranceProvider: v.insuranceProvider, insurancePolicyNumber: v.insurancePolicyNumber,
      insuranceExpiry: v.insuranceExpiry ? v.insuranceExpiry.split("T")[0] : "",
      registrationExpiry: v.registrationExpiry ? v.registrationExpiry.split("T")[0] : "",
      lastServiceDate: v.lastServiceDate ? v.lastServiceDate.split("T")[0] : "",
      nextServiceDate: v.nextServiceDate ? v.nextServiceDate.split("T")[0] : "",
      nextServiceOdometer: v.nextServiceOdometer != null ? String(v.nextServiceOdometer) : "",
      gpsDeviceId: v.gpsDeviceId, notes: v.notes,
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
      await updateRecord("vehicles", editing.id, buildPayload(editForm));
      await refetch();
      setEditing(null);
      Swal.fire({ title: "Saved", text: `${editForm.name} updated.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Save Failed", text: err instanceof Error ? err.message : "Could not update vehicle.", icon: "error" });
    }
  };

  const handleDelete = async (v: Vehicle) => {
    const confirmed = await Swal.fire({
      title: "Delete Vehicle?", text: `Remove "${v.name}" (${v.licensePlate})?`, icon: "warning",
      showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete",
    });
    if (!confirmed.isConfirmed) return;
    try {
      await deleteRecord("vehicles", v.id);
      await refetch();
      Swal.fire({ title: "Deleted", text: `${v.name} removed.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Delete Failed", text: err instanceof Error ? err.message : "Could not delete vehicle.", icon: "error" });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Vehicle Fleet
          </h1>
          <p className="text-gray-600">Manage vehicles, availability, and insurance/registration compliance</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
            <Plus className="w-4 h-4" /> Add Vehicle
          </button>
        </div>
      </div>

      {/* Stat Boxes */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatBox label="Total Vehicles" value={String(stats.total)} icon={Bus} color="blue" />
        <StatBox label="Available" value={String(stats.available)} icon={ShieldCheck} color="green" />
        <StatBox label="On Trip" value={String(stats.onTrip)} icon={Car} color="blue" />
        <StatBox label="In Maintenance" value={String(stats.maintenance)} icon={Wrench} color="amber" />
        <StatBox label="Out of Service" value={String(stats.outOfService)} icon={AlertTriangle} color="red" />
        <StatBox label="Compliance Alerts" value={String(stats.alerts)} icon={ShieldAlert} color="purple" />
      </div>

      {/* Chart */}
      {statusDist.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Gauge className="w-4 h-4 text-yellow-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Fleet by Status</h3>
          </div>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusDist} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2}>
                  {statusDist.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="middle" align="right" layout="vertical" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search name, plate, make, model…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
        <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
          <option value="all">All Types</option>
          {TYPES.map(t => <option key={t} value={t}>{label(t)}</option>)}
        </select>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
          <option value="all">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        <label className="flex items-center gap-2 px-3 py-2.5 bg-white border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition text-sm select-none">
          <input type="checkbox" checked={showAlertsOnly} onChange={e => { setShowAlertsOnly(e.target.checked); setPage(1); }} className="rounded" />
          <ShieldAlert className="w-4 h-4 text-red-500" /> Compliance alerts only
        </label>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          <button onClick={() => { setViewMode("grid"); setPage(1); }}
            className={`px-3 py-2.5 text-sm transition ${viewMode === "grid" ? "bg-yellow-400 text-black font-semibold" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button onClick={() => { setViewMode("table"); setPage(1); }}
            className={`px-3 py-2.5 text-sm transition ${viewMode === "table" ? "bg-yellow-400 text-black font-semibold" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            <Table2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {loading && vehicles.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading fleet...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No vehicles match your filters.</div>
      ) : viewMode === "grid" ? (
        /* ── Grid View ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {paginated.map(v => {
            const TypeIcon = TYPE_ICONS[v.type] || Car;
            const alert = hasComplianceAlert(v);
            return (
              <div key={v.id} className={`bg-white rounded-lg border overflow-hidden hover:shadow-md transition group ${alert ? "border-red-300 ring-1 ring-red-200" : "border-gray-200"}`}>
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="p-1.5 rounded-lg bg-yellow-50 text-yellow-600 flex-shrink-0"><TypeIcon className="w-4 h-4" /></div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-gray-900 text-sm truncate">{v.name}</h3>
                        <p className="text-xs text-gray-500 truncate">{[v.make, v.model, v.year || ""].filter(Boolean).join(" ")}</p>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${STATUS_PILLS[v.status] || "bg-gray-100 text-gray-700"}`}>{label(v.status)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500 mb-2 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-mono font-medium">{v.licensePlate || "—"}</span>
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" />{v.capacity}</span>
                    <span className="flex items-center gap-1"><Accessibility className="w-3 h-3" />{v.wheelchairCapacity}</span>
                    <span className="flex items-center gap-1"><Gauge className="w-3 h-3" />{v.odometer.toLocaleString()} km</span>
                  </div>

                  {/* Fuel level */}
                  <div className="mb-2">
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-0.5">
                      <span className="flex items-center gap-1"><Fuel className="w-3 h-3" /> Fuel</span>
                      <span className="font-medium">{v.fuelLevel}%</span>
                    </div>
                    <FuelBar level={v.fuelLevel} />
                  </div>

                  {/* Compliance badges */}
                  <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                    <ExpiryBadge label="Insurance" iso={v.insuranceExpiry} />
                    <ExpiryBadge label="Registration" iso={v.registrationExpiry} />
                  </div>

                  <div className="flex gap-1.5">
                    <button onClick={() => setViewing(v)} className="flex-1 px-2 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition flex items-center justify-center gap-1">
                      <Eye className="w-3 h-3" /> View
                    </button>
                    <button onClick={() => startEditing(v)} className="flex-1 px-2 py-1.5 text-xs font-medium text-yellow-600 bg-yellow-50 hover:bg-yellow-100 rounded transition flex items-center justify-center gap-1">
                      <Edit className="w-3 h-3" /> Edit
                    </button>
                    <button onClick={() => handleDelete(v)} className="px-2 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded transition">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Table View ── */
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Vehicle</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Plate</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Cap / WC</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Odometer</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Fuel</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Compliance</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.map(v => (
                <tr key={v.id} className={`hover:bg-gray-50 transition ${hasComplianceAlert(v) ? "bg-red-50/40" : ""}`}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{v.name}</p>
                    <p className="text-xs text-gray-500">{[v.make, v.model, v.year || ""].filter(Boolean).join(" ")}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{v.licensePlate}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{label(v.type)}</td>
                  <td className="px-4 py-3">
                    <select value={v.status} onChange={e => handleStatusChange(v, e.target.value)}
                      className={`px-2 py-1 rounded-lg text-xs font-semibold border-0 outline-none cursor-pointer ${STATUS_PILLS[v.status] || "bg-gray-100 text-gray-700"}`}>
                      {STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{v.capacity} / {v.wheelchairCapacity}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{v.odometer.toLocaleString()} km</td>
                  <td className="px-4 py-3 min-w-[90px]">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1"><FuelBar level={v.fuelLevel} /></div>
                      <span className="text-xs text-gray-600 font-medium">{v.fuelLevel}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 flex-wrap">
                      <ExpiryBadge label="Ins" iso={v.insuranceExpiry} />
                      <ExpiryBadge label="Reg" iso={v.registrationExpiry} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setViewing(v)} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                      <button onClick={() => startEditing(v)} className="p-1.5 rounded hover:bg-yellow-100 text-yellow-600 transition" title="Edit"><Edit className="w-4 h-4" /></button>
                      <button onClick={() => handleDelete(v)} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {filtered.length > perPage && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm text-gray-600">{filtered.length} vehicles total</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Previous</button>
            <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Next</button>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className={`sticky top-0 bg-gradient-to-r ${hasComplianceAlert(viewing) ? "from-red-400 to-red-500" : "from-blue-400 to-blue-500"} text-white p-5 flex items-center justify-between z-10`}>
              <div>
                <h2 className="text-xl font-bold">{viewing.name}</h2>
                <p className="text-sm text-white/80">{viewing.licensePlate} &middot; {label(viewing.type)}</p>
              </div>
              <button onClick={() => setViewing(null)} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Status quick change */}
              <div className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-200 rounded-lg p-3">
                <span className="text-sm font-semibold text-gray-700">Status</span>
                <select value={viewing.status} onChange={e => handleStatusChange(viewing, e.target.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold border-0 outline-none cursor-pointer ${STATUS_PILLS[viewing.status] || "bg-gray-100 text-gray-700"}`}>
                  {STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}
                </select>
              </div>

              {/* Fuel level */}
              <div>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-semibold text-gray-700 flex items-center gap-1"><Fuel className="w-4 h-4" /> Fuel Level</span>
                  <span className="font-bold text-gray-900">{viewing.fuelLevel}%</span>
                </div>
                <FuelBar level={viewing.fuelLevel} tall />
              </div>

              {/* Compliance */}
              <div className="flex items-center gap-2 flex-wrap">
                <ExpiryBadge label="Insurance" iso={viewing.insuranceExpiry} />
                <ExpiryBadge label="Registration" iso={viewing.registrationExpiry} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <DetailField icon={Car} label="Make / Model" value={[viewing.make, viewing.model].filter(Boolean).join(" ") || "—"} />
                <DetailField icon={Calendar} label="Year" value={viewing.year ? String(viewing.year) : "—"} />
                <DetailField icon={Hash} label="VIN" value={viewing.vin || "—"} />
                <DetailField icon={Users} label="Capacity" value={`${viewing.capacity} seats / ${viewing.wheelchairCapacity} WC`} />
                <DetailField icon={Gauge} label="Odometer" value={`${viewing.odometer.toLocaleString()} km`} />
                <DetailField icon={Satellite} label="GPS Device" value={viewing.gpsDeviceId || "—"} />
                <DetailField icon={ShieldCheck} label="Insurance Provider" value={viewing.insuranceProvider || "—"} />
                <DetailField icon={FileText} label="Policy #" value={viewing.insurancePolicyNumber || "—"} />
                <DetailField icon={Calendar} label="Insurance Expiry" value={viewing.insuranceExpiry ? new Date(viewing.insuranceExpiry).toLocaleDateString() : "—"} />
                <DetailField icon={Calendar} label="Registration Expiry" value={viewing.registrationExpiry ? new Date(viewing.registrationExpiry).toLocaleDateString() : "—"} />
                <DetailField icon={Wrench} label="Last Service" value={viewing.lastServiceDate ? new Date(viewing.lastServiceDate).toLocaleDateString() : "—"} />
                <DetailField icon={Wrench} label="Next Service" value={viewing.nextServiceDate ? new Date(viewing.nextServiceDate).toLocaleDateString() : viewing.nextServiceOdometer != null ? `@ ${viewing.nextServiceOdometer.toLocaleString()} km` : "—"} />
              </div>

              {viewing.notes && (
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded">
                  <p className="text-xs font-semibold text-yellow-700 mb-1">Notes</p>
                  <p className="text-sm text-gray-900">{viewing.notes}</p>
                </div>
              )}
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setViewing(null)} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium">Close</button>
              <div className="flex gap-2">
                <button onClick={() => { setViewing(null); startEditing(viewing); }} className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white font-semibold rounded-lg transition text-sm">
                  <Edit className="w-4 h-4 inline mr-1" /> Edit
                </button>
                <button onClick={() => { handleDelete(viewing); setViewing(null); }} className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg transition text-sm">
                  <Trash2 className="w-4 h-4 inline mr-1" /> Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && <VehicleFormModal title="Add Vehicle" form={createForm} onChange={setCreateForm} onSave={handleCreate} onCancel={() => setShowCreate(false)} saveLabel="Add Vehicle" />}

      {/* Edit Modal */}
      {editing && <VehicleFormModal title="Edit Vehicle" form={editForm} onChange={setEditForm} onSave={handleSaveEdit} onCancel={() => setEditing(null)} saveLabel="Save Changes" />}
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

function DetailField({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="bg-gray-50 p-3 rounded border border-gray-200">
      <p className="text-xs text-gray-600 font-semibold flex items-center gap-1 mb-0.5"><Icon className="w-3 h-3" />{label}</p>
      <p className="text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function FuelBar({ level, tall }: { level: number; tall?: boolean }) {
  const pct = Math.max(0, Math.min(100, level));
  const color = pct > 50 ? "bg-green-500" : pct >= 20 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className={`${tall ? "h-3" : "h-1.5"} bg-gray-100 rounded-full overflow-hidden`}>
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ExpiryBadge({ label, iso }: { label: string; iso: string }) {
  const { state, days } = expiryState(iso);
  if (state === "none") {
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-500">{label}: —</span>;
  }
  if (state === "expired") {
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">{label}: Expired</span>;
  }
  if (state === "expiring") {
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700">{label}: Expires in {days}d</span>;
  }
  return <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700">{label}: OK</span>;
}

function VehicleFormModal({ title, form, onChange, onSave, onCancel, saveLabel }: {
  title: string;
  form: typeof emptyForm;
  onChange: (f: typeof emptyForm) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
}) {
  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange({ ...form, [field]: e.target.value });
  const input = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none";
  const select = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onCancel} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Vehicle Name</label>
              <input type="text" value={form.name} onChange={set("name")} className={input} placeholder="Shuttle 1" />
            </div>
            <div>
              <label className={lbl}>License Plate</label>
              <input type="text" value={form.licensePlate} onChange={set("licensePlate")} className={input} placeholder="ABC-1234" />
            </div>
            <div>
              <label className={lbl}>Type</label>
              <select value={form.type} onChange={set("type")} className={select}>
                {TYPES.map(t => <option key={t} value={t}>{label(t)}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Status</label>
              <select value={form.status} onChange={set("status")} className={select}>
                {STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Make</label>
              <input type="text" value={form.make} onChange={set("make")} className={input} placeholder="Toyota" />
            </div>
            <div>
              <label className={lbl}>Model</label>
              <input type="text" value={form.model} onChange={set("model")} className={input} placeholder="HiAce" />
            </div>
            <div>
              <label className={lbl}>Year</label>
              <input type="number" min="1980" max="2100" value={form.year} onChange={set("year")} className={input} />
            </div>
            <div>
              <label className={lbl}>VIN</label>
              <input type="text" value={form.vin} onChange={set("vin")} className={input} />
            </div>
            <div>
              <label className={lbl}>Seat Capacity</label>
              <input type="number" min="0" value={form.capacity} onChange={set("capacity")} className={input} />
            </div>
            <div>
              <label className={lbl}>Wheelchair Capacity</label>
              <input type="number" min="0" value={form.wheelchairCapacity} onChange={set("wheelchairCapacity")} className={input} />
            </div>
            <div>
              <label className={lbl}>Odometer (km)</label>
              <input type="number" min="0" value={form.odometer} onChange={set("odometer")} className={input} />
            </div>
            <div>
              <label className={lbl}>Fuel Level (%)</label>
              <input type="number" min="0" max="100" value={form.fuelLevel} onChange={set("fuelLevel")} className={input} />
            </div>
            <div>
              <label className={lbl}>Insurance Provider</label>
              <input type="text" value={form.insuranceProvider} onChange={set("insuranceProvider")} className={input} />
            </div>
            <div>
              <label className={lbl}>Insurance Policy #</label>
              <input type="text" value={form.insurancePolicyNumber} onChange={set("insurancePolicyNumber")} className={input} />
            </div>
            <div>
              <label className={lbl}>Insurance Expiry</label>
              <input type="date" value={form.insuranceExpiry} onChange={set("insuranceExpiry")} className={input} />
            </div>
            <div>
              <label className={lbl}>Registration Expiry</label>
              <input type="date" value={form.registrationExpiry} onChange={set("registrationExpiry")} className={input} />
            </div>
            <div>
              <label className={lbl}>Last Service Date</label>
              <input type="date" value={form.lastServiceDate} onChange={set("lastServiceDate")} className={input} />
            </div>
            <div>
              <label className={lbl}>Next Service Date</label>
              <input type="date" value={form.nextServiceDate} onChange={set("nextServiceDate")} className={input} />
            </div>
            <div>
              <label className={lbl}>Next Service Odometer (km)</label>
              <input type="number" min="0" value={form.nextServiceOdometer} onChange={set("nextServiceOdometer")} className={input} />
            </div>
            <div>
              <label className={lbl}>GPS Device ID</label>
              <input type="text" value={form.gpsDeviceId} onChange={set("gpsDeviceId")} className={input} />
            </div>
            <div className="sm:col-span-2">
              <label className={lbl}>Notes</label>
              <textarea value={form.notes} onChange={set("notes")} rows={2} className={input} />
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
