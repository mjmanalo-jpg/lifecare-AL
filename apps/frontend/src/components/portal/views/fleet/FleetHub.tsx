"use client";

import { useMemo, useState } from "react";
import {
  Wrench, Fuel, ClipboardList, Route, Search, X, RefreshCw, Eye,
  ChevronLeft, ChevronRight, Bus, CalendarClock, ClipboardCheck, Clock,
  CircleDollarSign, PackageSearch, Play, CheckCircle2, Ban, AlertTriangle,
  Gauge, Loader2, Droplets, Hash, TrendingUp, Leaf, MapPin, User,
  UserCheck, Repeat, Accessibility, Siren, Stethoscope, HeartPulse,
  TreePine, Truck, ShieldCheck, DollarSign, Check, BanIcon, Navigation,
  Undo2, Flag, Radio, Receipt, Calendar, Edit, Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

/* ── Helpers ── */
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : v == null ? d : String(v));
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const bool = (v: unknown): boolean => v === true;
const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;
const fmtDT = (iso: string) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
const fmtDate = (iso: string) => (iso ? new Date(iso).toLocaleDateString() : "—");
const fmtCurrency = (n: number) => `₱${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const isThisMonth = (iso: string) => {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
};
const isLast30Days = (iso: string) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !isNaN(t) && Date.now() - t <= 30 * DAY_MS && t <= Date.now() + DAY_MS;
};
const toLocalInput = (iso: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const toLocalInputValue = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

type TabKey = "maintenance" | "fuel" | "requests" | "trips";

/* ── Maintenance ── */
const MAINT_STATUSES = ["SCHEDULED", "OPEN", "IN_PROGRESS", "AWAITING_PARTS", "COMPLETED", "CANCELLED"];
const MAINT_TYPES = ["PREVENTIVE", "REPAIR", "INSPECTION"];
const MAINT_STATUS_STYLES: Record<string, string> = {
  SCHEDULED: "bg-gray-100 text-gray-700", OPEN: "bg-blue-100 text-blue-700",
  IN_PROGRESS: "bg-amber-100 text-amber-700", AWAITING_PARTS: "bg-purple-100 text-purple-700",
  COMPLETED: "bg-green-100 text-green-700", CANCELLED: "bg-red-100 text-red-700",
};
const MAINT_TYPE_META: Record<string, { icon: LucideIcon; cls: string }> = {
  PREVENTIVE: { icon: CalendarClock, cls: "bg-blue-100 text-blue-700" },
  REPAIR: { icon: Wrench, cls: "bg-red-100 text-red-700" },
  INSPECTION: { icon: ClipboardCheck, cls: "bg-purple-100 text-purple-700" },
};

type Row = Record<string, unknown>;
const rel = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});

const adaptWorkOrder = (r: Row) => {
  const vehicle = rel(r.vehicle);
  return {
    id: String(r.id ?? ""), vehicleId: String(r.vehicleId ?? ""),
    vehicleName: String(vehicle.name ?? "—"), vehiclePlate: String(vehicle.licensePlate ?? ""),
    type: String(r.type ?? "REPAIR"), status: String(r.status ?? "OPEN"),
    title: String(r.title ?? "Work order"), description: String(r.description ?? ""),
    scheduledDate: r.scheduledDate ? String(r.scheduledDate) : "",
    completedDate: r.completedDate ? String(r.completedDate) : "",
    odometerAt: Number(r.odometerAt ?? 0), cost: Number(r.cost ?? 0),
    vendor: String(r.vendor ?? ""), downtimeHours: Number(r.downtimeHours ?? 0),
    notes: String(r.notes ?? ""),
  };
};
type WorkOrder = ReturnType<typeof adaptWorkOrder>;

/* ── Fuel ── */
const FUEL_TYPE_STYLES: Record<string, string> = {
  Diesel: "bg-amber-100 text-amber-700", Gasoline: "bg-blue-100 text-blue-700",
  "Electric kWh": "bg-green-100 text-green-700",
};
const adaptFuelLog = (r: Row) => {
  const vehicle = rel(r.vehicle);
  const driver = rel(r.driver);
  return {
    id: String(r.id ?? ""), vehicleId: String(r.vehicleId ?? ""),
    vehicleName: String(vehicle.name ?? "—"), vehiclePlate: String(vehicle.licensePlate ?? ""),
    driverName: String(driver.name ?? ""), logDate: r.logDate ? String(r.logDate) : "",
    odometer: Number(r.odometer ?? 0), liters: Number(r.liters ?? 0),
    cost: Number(r.cost ?? 0), fuelType: String(r.fuelType ?? "Diesel"),
    notes: String(r.notes ?? ""),
  };
};
type FuelLogEntry = ReturnType<typeof adaptFuelLog>;

/* ── Transport Requests ── */
const REQ_TYPE_META: Record<string, { label: string; icon: LucideIcon; color: string; pill: string }> = {
  MEDICAL_APPOINTMENT: { label: "Medical", icon: Stethoscope, color: "#3b82f6", pill: "bg-blue-50 text-blue-700 border-blue-200" },
  DIALYSIS: { label: "Dialysis", icon: Droplets, color: "#06b6d4", pill: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  THERAPY: { label: "Therapy", icon: HeartPulse, color: "#ec4899", pill: "bg-pink-50 text-pink-700 border-pink-200" },
  FAMILY_OUTING: { label: "Family", icon: TreePine, color: "#22c55e", pill: "bg-green-50 text-green-700 border-green-200" },
  EMERGENCY_TRANSFER: { label: "Emergency", icon: Siren, color: "#ef4444", pill: "bg-red-50 text-red-700 border-red-200" },
  OTHER: { label: "Other", icon: Bus, color: "#6b7280", pill: "bg-gray-50 text-gray-700 border-gray-200" },
};
const REQ_TYPES = Object.keys(REQ_TYPE_META);
const PRIORITY_PILL: Record<string, string> = {
  EMERGENCY: "bg-red-100 text-red-700 border-red-300 animate-pulse",
  HIGH: "bg-orange-50 text-orange-700 border-orange-200",
  NORMAL: "bg-blue-50 text-blue-700 border-blue-200",
  LOW: "bg-gray-100 text-gray-600 border-gray-200",
};
const STATUS_PILL: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-blue-50 text-blue-700 border-blue-200",
  SCHEDULED: "bg-purple-50 text-purple-700 border-purple-200",
  DECLINED: "bg-red-50 text-red-700 border-red-200",
  COMPLETED: "bg-green-50 text-green-700 border-green-200",
  CANCELLED: "bg-gray-100 text-gray-500 border-gray-200",
};
const REQ_STATUS_CHIPS = ["all", "PENDING", "APPROVED", "SCHEDULED", "DECLINED", "COMPLETED", "CANCELLED"];
const adaptRequest = (r: Row) => {
  const resident = rec(r.resident);
  const name = resident ? `${str(resident.firstName)} ${str(resident.lastName)}`.trim() : "";
  return {
    id: str(r.id), residentId: str(r.residentId), residentName: name || "Unknown",
    roomNumber: resident ? str(resident.roomNumber, "—") : "—",
    type: str(r.type, "OTHER"), destination: str(r.destination, "—"),
    purpose: str(r.purpose), requestedDate: str(r.requestedDate),
    returnRequired: bool(r.returnRequired), wheelchairNeeded: bool(r.wheelchairNeeded),
    escortRequired: bool(r.escortRequired), escortRole: str(r.escortRole),
    priority: str(r.priority, "NORMAL"), status: str(r.status, "PENDING"),
    source: str(r.source, "PORTAL"), notes: str(r.notes),
    declineReason: str(r.declineReason), hasTrip: !!rec(r.trip), raw: r,
  };
};
type TransportRequest = ReturnType<typeof adaptRequest>;

/* ── Trips ── */
const TRIP_STEPS = ["SCHEDULED", "INSPECTION", "EN_ROUTE", "ARRIVED", "RETURNING", "COMPLETED"];
const TRIP_STEP_LABELS: Record<string, string> = {
  SCHEDULED: "Scheduled", INSPECTION: "Inspection", EN_ROUTE: "En Route",
  ARRIVED: "Arrived", RETURNING: "Returning", COMPLETED: "Completed",
};
const TRIP_STATUS_PILL: Record<string, string> = {
  SCHEDULED: "bg-blue-50 text-blue-700 border-blue-200",
  INSPECTION: "bg-amber-50 text-amber-700 border-amber-200",
  EN_ROUTE: "bg-yellow-100 text-yellow-800 border-yellow-300",
  ARRIVED: "bg-purple-50 text-purple-700 border-purple-200",
  RETURNING: "bg-cyan-50 text-cyan-700 border-cyan-200",
  COMPLETED: "bg-green-50 text-green-700 border-green-200",
  CANCELLED: "bg-gray-100 text-gray-500 border-gray-200",
};
const TRIP_STATUS_CHIPS = ["all", "SCHEDULED", "INSPECTION", "EN_ROUTE", "ARRIVED", "RETURNING", "COMPLETED", "CANCELLED"];
const TRIP_ACTIVE = ["SCHEDULED", "INSPECTION", "EN_ROUTE", "ARRIVED", "RETURNING"];
const adaptTrip = (r: Row) => {
  const resident = rec(r.resident);
  const vehicle = rec(r.vehicle);
  const driver = rec(r.driver);
  const name = resident ? `${str(resident.firstName)} ${str(resident.lastName)}`.trim() : "";
  return {
    id: str(r.id), requestId: str(r.requestId), residentId: str(r.residentId),
    residentName: name || "Unknown", roomNumber: resident ? str(resident.roomNumber, "—") : "—",
    sponsorId: resident ? str(resident.sponsorId) : "",
    vehicleId: str(r.vehicleId), vehicleName: vehicle ? str(vehicle.name, "—") : "—",
    vehiclePlate: vehicle ? str(vehicle.licensePlate, "—") : "—",
    vehicleStatus: vehicle ? str(vehicle.status) : "",
    vehicleOdometer: vehicle ? num(vehicle.odometer) : 0,
    driverId: str(r.driverId), driverName: driver ? str(driver.name, "—") : "—",
    driverTripHours: driver ? num(driver.tripHours) : 0,
    escortName: str(r.escortName), escortRole: str(r.escortRole),
    status: str(r.status, "SCHEDULED"), destination: str(r.destination, "—"),
    origin: str(r.origin, "Facility"), scheduledAt: str(r.scheduledAt),
    departedAt: str(r.departedAt), arrivedAt: str(r.arrivedAt),
    returnDepartedAt: str(r.returnDepartedAt), completedAt: str(r.completedAt),
    distanceKm: num(r.distanceKm),
    inspectionDone: bool(r.inspectionDone), familyNotified: bool(r.familyNotified),
    billed: bool(r.billed), charge: r.charge == null ? null : num(r.charge),
    notes: str(r.notes), raw: r,
  };
};
type Trip = ReturnType<typeof adaptTrip>;

/* ── Vehicle / Driver for selects ── */
const adaptVehicle = (r: Row) => ({
  id: str(r.id), name: str(r.name, "Vehicle"), licensePlate: str(r.licensePlate, ""),
  type: str(r.type, "SHUTTLE"), status: str(r.status, "AVAILABLE"),
  capacity: num(r.capacity), wheelchairCapacity: num(r.wheelchairCapacity),
  odometer: num(r.odometer), nextServiceDate: r.nextServiceDate ? String(r.nextServiceDate) : "",
  nextServiceOdometer: num(r.nextServiceOdometer),
});
type Vehicle = ReturnType<typeof adaptVehicle>;

const adaptDriver = (r: Row) => ({
  id: str(r.id), name: str(r.name, "Driver"), licenseNumber: str(r.licenseNumber, ""),
  licenseExpiry: str(r.licenseExpiry), certifications: str(r.certifications),
  safetyScore: num(r.safetyScore), tripHours: num(r.tripHours),
  isActive: bool(r.isActive),
});
type Driver = ReturnType<typeof adaptDriver>;

const adaptResident = (r: Row) => ({
  id: str(r.id), name: `${str(r.firstName)} ${str(r.lastName)}`.trim() || "Unknown",
  roomNumber: str(r.roomNumber, "—"),
});

/* ══════════════════════════════════════════════════════════════════════════════ */
/*                            MAIN HUB COMPONENT                                */
/* ══════════════════════════════════════════════════════════════════════════════ */

interface FleetHubProps {
  initialTab?: TabKey;
}

export default function FleetHub({ initialTab = "maintenance" }: FleetHubProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [viewRow, setViewRow] = useState<Record<string, unknown> | null>(null);

  return (
    <div className="space-y-5">
      {/* Tab Content — standalone, no tab bar */}
      {activeTab === "maintenance" && <MaintenanceTab onView={setViewRow} />}
      {activeTab === "fuel" && <FuelTab onView={setViewRow} />}
      {activeTab === "requests" && <RequestsTab onView={setViewRow} />}
      {activeTab === "trips" && <TripsTab onView={setViewRow} />}

      {/* View Modal */}
      {viewRow && <ViewModal row={viewRow} onClose={() => setViewRow(null)} />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════ */
/*                          MAINTENANCE TAB                                     */
/* ══════════════════════════════════════════════════════════════════════════════ */

function MaintenanceTab({ onView }: { onView: (r: Record<string, unknown>) => void }) {
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
  const [createForm, setCreateForm] = useState({ vehicleId: "", type: "PREVENTIVE", status: "SCHEDULED", title: "", description: "", scheduledDate: "", vendor: "", odometerAt: "", cost: "", downtimeHours: "", notes: "" });
  const [editForm, setEditForm] = useState(createForm);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const perPage = 10;

  const refreshAll = async () => { await refetch(); await vehiclesQ.refetch(); };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter(w => {
      if (q && !w.title.toLowerCase().includes(q) && !w.vendor.toLowerCase().includes(q) && !w.vehicleName.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && w.status !== statusFilter) return false;
      if (typeFilter !== "all" && w.type !== typeFilter) return false;
      if (vehicleFilter !== "all" && w.vehicleId !== vehicleFilter) return false;
      return true;
    });
  }, [orders, search, statusFilter, typeFilter, vehicleFilter]);

  const stats = useMemo(() => ({
    open: orders.filter(w => ["SCHEDULED", "OPEN"].includes(w.status)).length,
    inProgress: orders.filter(w => w.status === "IN_PROGRESS").length,
    completed30: orders.filter(w => w.status === "COMPLETED" && isLast30Days(w.completedDate)).length,
    cost30: orders.filter(w => isLast30Days(w.completedDate || w.scheduledDate)).reduce((s, w) => s + w.cost, 0),
  }), [orders]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const buildPayload = (f: typeof createForm) => ({
    vehicleId: f.vehicleId, type: f.type, status: f.status, title: f.title, description: f.description,
    scheduledDate: f.scheduledDate ? new Date(f.scheduledDate).toISOString() : null,
    vendor: f.vendor, odometerAt: f.odometerAt !== "" ? Number(f.odometerAt) || 0 : null,
    cost: f.cost !== "" ? Number(f.cost) || 0 : null,
    downtimeHours: f.downtimeHours !== "" ? Number(f.downtimeHours) || 0 : null, notes: f.notes,
  });

  const handleCreate = async () => {
    if (!createForm.vehicleId || !createForm.title) { Swal.fire({ title: "Missing Fields", text: "Vehicle and title are required.", icon: "warning" }); return; }
    const confirmed = await Swal.fire({ title: "Create Work Order?", icon: "question", showCancelButton: true, confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280", confirmButtonText: "Create" });
    if (!confirmed.isConfirmed) return;
    try {
      await createRecord("vehicle-maintenance", buildPayload(createForm));
      await refreshAll(); setShowCreate(false); setCreateForm({ vehicleId: "", type: "PREVENTIVE", status: "SCHEDULED", title: "", description: "", scheduledDate: "", vendor: "", odometerAt: "", cost: "", downtimeHours: "", notes: "" });
      Swal.fire({ title: "Created", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not create.", icon: "error" }); }
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    const confirmed = await Swal.fire({ title: "Save Changes?", icon: "question", showCancelButton: true, confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280", confirmButtonText: "Save" });
    if (!confirmed.isConfirmed) return;
    try {
      await updateRecord("vehicle-maintenance", editing.id, buildPayload(editForm));
      await refreshAll(); setEditing(null);
      Swal.fire({ title: "Saved", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) { Swal.fire({ title: "Save Failed", text: err instanceof Error ? err.message : "Could not update.", icon: "error" }); }
  };

  const handleDelete = async (w: WorkOrder) => {
    const confirmed = await Swal.fire({ title: "Delete?", text: `Remove "${w.title}"?`, icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete" });
    if (!confirmed.isConfirmed) return;
    try { await deleteRecord("vehicle-maintenance", w.id); await refetch(); Swal.fire({ title: "Deleted", icon: "success", timer: 1500, showConfirmButton: false }); } catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Error", icon: "error" }); }
  };

  const handleStatusChange = async (w: WorkOrder, newStatus: string) => {
    setBusyId(w.id);
    try {
      if (newStatus === "IN_PROGRESS" && w.vehicleId) await updateRecord("vehicles", w.vehicleId, { status: "MAINTENANCE" });
      await updateRecord("vehicle-maintenance", w.id, { status: newStatus, ...(newStatus === "COMPLETED" ? { completedDate: new Date().toISOString() } : {}) });
      if (newStatus === "COMPLETED" && w.vehicleId) await updateRecord("vehicles", w.vehicleId, { status: "AVAILABLE", lastServiceDate: new Date().toISOString() });
      await refreshAll();
    } catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Error", icon: "error" }); }
    setBusyId(null);
  };

  const startEditing = (w: WorkOrder) => {
    setEditing(w);
    setEditForm({ vehicleId: w.vehicleId, type: w.type, status: w.status, title: w.title, description: w.description, scheduledDate: w.scheduledDate ? w.scheduledDate.split("T")[0] : "", vendor: w.vendor, odometerAt: w.odometerAt ? String(w.odometerAt) : "", cost: w.cost ? String(w.cost) : "", downtimeHours: w.downtimeHours ? String(w.downtimeHours) : "", notes: w.notes });
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Open Orders" value={String(stats.open)} icon={Wrench} color="blue" />
        <StatBox label="In Progress" value={String(stats.inProgress)} icon={Play} color="amber" />
        <StatBox label="Completed (30d)" value={String(stats.completed30)} icon={CheckCircle2} color="green" />
        <StatBox label="Cost (30d)" value={fmtCurrency(stats.cost30)} icon={CircleDollarSign} color="purple" />
      </div>

      {/* Toolbar */}
      <div className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          {["all", ...MAINT_STATUSES].map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${statusFilter === s ? "bg-yellow-400 text-black border-yellow-400" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
              {s === "all" ? "All" : s.replace(/_/g, " ")}
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-start sm:items-center">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Search title, vendor, vehicle…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
          </div>
          <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
            <option value="all">All Types</option>
            {MAINT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={vehicleFilter} onChange={e => { setVehicleFilter(e.target.value); setPage(1); }}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
            <option value="all">All Vehicles</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.name} ({v.licensePlate})</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={() => void refreshAll()} className="flex items-center gap-2 px-3 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm"><RefreshCw className="w-4 h-4" /></button>
            <button onClick={() => { setCreateForm({ vehicleId: "", type: "PREVENTIVE", status: "SCHEDULED", title: "", description: "", scheduledDate: "", vendor: "", odometerAt: "", cost: "", downtimeHours: "", notes: "" }); setShowCreate(true); }}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition text-sm active:scale-95">
              <ClipboardList className="w-4 h-4" /> New
            </button>
          </div>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* Table / Cards */}
      {loading && orders.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading work orders...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No work orders match your filters.</div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <Th>Type</Th><Th>Title</Th><Th>Vehicle</Th><Th>Vendor</Th><Th>Scheduled</Th><Th>Status</Th><Th align="right">Cost</Th><Th align="center">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginated.map(w => {
                  const meta = MAINT_TYPE_META[w.type] || MAINT_TYPE_META.REPAIR;
                  const TypeIcon = meta.icon;
                  return (
                    <tr key={w.id} className="hover:bg-gray-50 transition">
                      <Td><span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${meta.cls}`}><TypeIcon className="w-3 h-3" /> {w.type}</span></Td>
                      <Td className="font-medium text-gray-900 max-w-[200px] truncate" title={w.title}>{w.title}</Td>
                      <Td className="text-xs">{w.vehicleName}{w.vehiclePlate ? ` · ${w.vehiclePlate}` : ""}</Td>
                      <Td className="text-xs">{w.vendor || "—"}</Td>
                      <Td className="text-xs">{fmtDate(w.scheduledDate)}</Td>
                      <Td><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${MAINT_STATUS_STYLES[w.status] || ""}`}>{w.status.replace(/_/g, " ")}</span></Td>
                      <Td align="right" className="font-medium">{w.cost ? fmtCurrency(w.cost) : "—"}</Td>
                      <Td>
                        <div className="flex items-center justify-center gap-1">
                          {busyId === w.id ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : (
                            <>
                              <button onClick={() => onView({ ...w, _tab: "maintenance" })} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                              {w.status === "OPEN" && <button onClick={() => handleStatusChange(w, "IN_PROGRESS")} className="p-1.5 rounded hover:bg-amber-100 text-amber-600 transition" title="Start"><Play className="w-4 h-4" /></button>}
                              {["IN_PROGRESS", "AWAITING_PARTS"].includes(w.status) && <button onClick={() => handleStatusChange(w, "COMPLETED")} className="p-1.5 rounded hover:bg-green-100 text-green-600 transition" title="Complete"><CheckCircle2 className="w-4 h-4" /></button>}
                              <button onClick={() => startEditing(w)} className="p-1.5 rounded hover:bg-yellow-100 text-yellow-600 transition" title="Edit"><Edit className="w-4 h-4" /></button>
                              <button onClick={() => handleDelete(w)} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
                            </>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {paginated.map(w => {
              const meta = MAINT_TYPE_META[w.type] || MAINT_TYPE_META.REPAIR;
              const TypeIcon = meta.icon;
              return (
                <div key={w.id} className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${meta.cls}`}><TypeIcon className="w-3 h-3" /> {w.type}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${MAINT_STATUS_STYLES[w.status] || ""}`}>{w.status.replace(/_/g, " ")}</span>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{w.cost ? fmtCurrency(w.cost) : "—"}</span>
                  </div>
                  <p className="font-medium text-gray-900 text-sm truncate">{w.title}</p>
                  <p className="text-xs text-gray-500">{w.vehicleName} · {fmtDate(w.scheduledDate)} {w.vendor ? `· ${w.vendor}` : ""}</p>
                  <div className="flex gap-1 pt-1">
                    <button onClick={() => onView({ ...w, _tab: "maintenance" })} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition"><Eye className="w-3 h-3" /> View</button>
                    <button onClick={() => startEditing(w)} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-yellow-600 bg-yellow-50 hover:bg-yellow-100 rounded transition"><Edit className="w-3 h-3" /> Edit</button>
                    <button onClick={() => handleDelete(w)} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded transition"><Trash2 className="w-3 h-3" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Pagination */}
      <Pagination page={page} totalPages={totalPages} total={filtered.length} label="work orders" setPage={setPage} />

      {/* Create Modal */}
      {showCreate && (
        <MaintFormModal title="New Work Order" form={createForm} onChange={setCreateForm} onSave={handleCreate} onCancel={() => setShowCreate(false)} vehicles={vehicles} />
      )}
      {editing && (
        <MaintFormModal title="Edit Work Order" form={editForm} onChange={setEditForm} onSave={handleSaveEdit} onCancel={() => setEditing(null)} vehicles={vehicles} />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════ */
/*                             FUEL TAB                                          */
/* ══════════════════════════════════════════════════════════════════════════════ */

function FuelTab({ onView }: { onView: (r: Record<string, unknown>) => void }) {
  const { data: logRows, loading, error, refetch } = useLiveQuery<Row>(
    "fuel-logs", { query: "include=vehicle,driver&take=300", tables: ["FuelLog", "Vehicle"] }
  );
  const vehiclesQ = useLiveQuery<Row>("vehicles", { query: "take=300", tables: ["Vehicle"] });
  const driversQ = useLiveQuery<Row>("drivers", { query: "take=300", tables: ["Driver"] });

  const logs = useMemo<FuelLogEntry[]>(() => logRows.map(adaptFuelLog).sort((a, b) => new Date(b.logDate || 0).getTime() - new Date(a.logDate || 0).getTime()), [logRows]);
  const vehicles = useMemo<Vehicle[]>(() => vehiclesQ.data.map(adaptVehicle), [vehiclesQ.data]);
  const drivers = useMemo(() => driversQ.data.map(adaptDriver).filter((d: ReturnType<typeof adaptDriver>) => d.isActive), [driversQ.data]);

  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(() => ({ vehicleId: "", driverId: "", logDate: toLocalInputValue(new Date()), odometer: "", liters: "", cost: "", fuelType: "Diesel", notes: "" }));
  const [page, setPage] = useState(1);
  const perPage = 10;

  const refreshAll = async () => { await refetch(); await vehiclesQ.refetch(); };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter(l => {
      if (q && !l.vehicleName.toLowerCase().includes(q) && !l.vehiclePlate.toLowerCase().includes(q) && !l.driverName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, search]);

  const stats = useMemo(() => {
    const month = logs.filter(l => isThisMonth(l.logDate));
    const liters = month.reduce((s, l) => s + l.liters, 0);
    const cost = month.reduce((s, l) => s + l.cost, 0);
    return { liters, cost, avgPerLiter: liters > 0 ? cost / liters : 0, fillUps: month.length };
  }, [logs]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const handleCreate = async () => {
    if (!form.vehicleId || !form.odometer || !form.liters) { Swal.fire({ title: "Missing Fields", text: "Vehicle, odometer, and liters required.", icon: "warning" }); return; }
    const confirmed = await Swal.fire({ title: "Log Fuel-Up?", icon: "question", showCancelButton: true, confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280", confirmButtonText: "Log" });
    if (!confirmed.isConfirmed) return;
    try {
      const odometer = Math.round(Number(form.odometer) || 0);
      await createRecord("fuel-logs", { vehicleId: form.vehicleId, driverId: form.driverId || null, logDate: form.logDate ? new Date(form.logDate).toISOString() : new Date().toISOString(), odometer, liters: Number(form.liters) || 0, cost: Number(form.cost) || 0, fuelType: form.fuelType, notes: form.notes });
      const sv = vehicles.find(v => v.id === form.vehicleId);
      if (sv && odometer > sv.odometer) await updateRecord("vehicles", sv.id, { odometer, fuelLevel: 100 });
      await refreshAll(); setShowCreate(false); setForm({ vehicleId: "", driverId: "", logDate: toLocalInputValue(new Date()), odometer: "", liters: "", cost: "", fuelType: "Diesel", notes: "" });
      Swal.fire({ title: "Logged", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Error", icon: "error" }); }
  };

  const handleDelete = async (log: FuelLogEntry) => {
    const confirmed = await Swal.fire({ title: "Delete?", text: `Remove ${log.liters}L fill-up for ${log.vehicleName}?`, icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete" });
    if (!confirmed.isConfirmed) return;
    try { await deleteRecord("fuel-logs", log.id); await refetch(); Swal.fire({ title: "Deleted", icon: "success", timer: 1500, showConfirmButton: false }); } catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Error", icon: "error" }); }
  };

  const setField = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [field]: e.target.value }));

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Liters (Month)" value={stats.liters.toLocaleString(undefined, { maximumFractionDigits: 1 })} icon={Droplets} color="blue" />
        <StatBox label="Cost (Month)" value={fmtCurrency(stats.cost)} icon={CircleDollarSign} color="amber" />
        <StatBox label="Avg ₱/L" value={stats.avgPerLiter > 0 ? `₱${stats.avgPerLiter.toFixed(2)}` : "—"} icon={Fuel} color="purple" />
        <StatBox label="Fill-Ups (Month)" value={String(stats.fillUps)} icon={Hash} color="green" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-start sm:items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search vehicle, plate, driver…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
        <div className="flex gap-2">
          <button onClick={() => void refreshAll()} className="flex items-center gap-2 px-3 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => { setForm({ vehicleId: "", driverId: "", logDate: toLocalInputValue(new Date()), odometer: "", liters: "", cost: "", fuelType: "Diesel", notes: "" }); setShowCreate(true); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition text-sm active:scale-95">
            <Fuel className="w-4 h-4" /> Log Fuel-Up
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* Table / Cards */}
      {loading && logs.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading fuel logs...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No fuel logs found.</div>
      ) : (
        <>
          <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <Th>Date</Th><Th>Vehicle</Th><Th>Driver</Th><Th align="right">Odometer</Th><Th align="right">Liters</Th><Th align="right">Cost</Th><Th align="right">₱/L</Th><Th>Fuel</Th><Th align="center">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginated.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50 transition">
                    <Td className="text-xs whitespace-nowrap">{fmtDT(log.logDate)}</Td>
                    <Td className="font-medium text-gray-900">{log.vehicleName} <span className="text-xs text-gray-400 font-normal">{log.vehiclePlate}</span></Td>
                    <Td className="text-xs">{log.driverName || "—"}</Td>
                    <Td align="right">{log.odometer ? `${log.odometer.toLocaleString()} km` : "—"}</Td>
                    <Td align="right" className="font-medium">{log.liters.toLocaleString(undefined, { maximumFractionDigits: 1 })}</Td>
                    <Td align="right" className="font-medium">{fmtCurrency(log.cost)}</Td>
                    <Td align="right">{log.liters > 0 ? `₱${(log.cost / log.liters).toFixed(2)}` : "—"}</Td>
                    <Td><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${FUEL_TYPE_STYLES[log.fuelType] || "bg-gray-100 text-gray-700"}`}>{log.fuelType}</span></Td>
                    <Td>
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => onView({ ...log, _tab: "fuel" })} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(log)} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {paginated.map(log => (
              <div key={log.id} className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${FUEL_TYPE_STYLES[log.fuelType] || "bg-gray-100 text-gray-700"}`}>{log.fuelType}</span>
                  <span className="text-sm font-semibold text-gray-900">{fmtCurrency(log.cost)}</span>
                </div>
                <p className="font-medium text-gray-900 text-sm">{log.vehicleName} <span className="text-xs text-gray-400">{log.vehiclePlate}</span></p>
                <p className="text-xs text-gray-500">{log.liters}L · {log.odometer.toLocaleString()} km · {log.driverName || "No driver"} · {fmtDT(log.logDate)}</p>
                <div className="flex gap-1 pt-1">
                  <button onClick={() => onView({ ...log, _tab: "fuel" })} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition"><Eye className="w-3 h-3" /> View</button>
                  <button onClick={() => handleDelete(log)} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded transition"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <Pagination page={page} totalPages={totalPages} total={filtered.length} label="fuel logs" setPage={setPage} />

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold">Log Fuel-Up</h2>
              <button onClick={() => setShowCreate(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-semibold text-gray-700 mb-1">Vehicle</label>
                  <select value={form.vehicleId} onChange={setField("vehicleId")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none"><option value="">Select…</option>{vehicles.map(v => <option key={v.id} value={v.id}>{v.name} ({v.licensePlate})</option>)}</select></div>
                <div><label className="block text-sm font-semibold text-gray-700 mb-1">Driver</label>
                  <select value={form.driverId} onChange={setField("driverId")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none"><option value="">None</option>{drivers.map((d: ReturnType<typeof adaptDriver>) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
                <div><label className="block text-sm font-semibold text-gray-700 mb-1">Date &amp; Time</label>
                  <input type="datetime-local" value={form.logDate} onChange={setField("logDate")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
                <div><label className="block text-sm font-semibold text-gray-700 mb-1">Odometer (km)</label>
                  <input type="number" min="0" value={form.odometer} onChange={setField("odometer")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
                <div><label className="block text-sm font-semibold text-gray-700 mb-1">Liters</label>
                  <input type="number" min="0" step="0.1" value={form.liters} onChange={setField("liters")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
                <div><label className="block text-sm font-semibold text-gray-700 mb-1">Cost (₱)</label>
                  <input type="number" min="0" step="0.01" value={form.cost} onChange={setField("cost")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
                <div><label className="block text-sm font-semibold text-gray-700 mb-1">Fuel Type</label>
                  <select value={form.fuelType} onChange={setField("fuelType")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none"><option>Diesel</option><option>Gasoline</option><option>Electric kWh</option></select></div>
                <div className="col-span-2"><label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
                  <textarea value={form.notes} onChange={setField("notes")} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setShowCreate(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
              <button onClick={handleCreate} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">Log Fuel-Up</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════ */
/*                          REQUESTS TAB                                         */
/* ══════════════════════════════════════════════════════════════════════════════ */

function RequestsTab({ onView }: { onView: (r: Record<string, unknown>) => void }) {
  const { data: requestRows, loading, error, refetch } = useLiveQuery<Row>(
    "transport-requests", { query: "include=resident,trip&take=300", tables: ["TransportRequest", "Trip", "Resident"] }
  );
  const { data: residentRows } = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });

  const requests = useMemo<TransportRequest[]>(() => requestRows.map(adaptRequest), [requestRows]);
  const residents = useMemo(() => residentRows.map(adaptResident), [residentRows]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const perPage = 10;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests
      .filter(r => {
        if (statusFilter !== "all" && r.status !== statusFilter) return false;
        if (typeFilter !== "all" && r.type !== typeFilter) return false;
        if (q && !r.residentName.toLowerCase().includes(q) && !r.destination.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const pa = a.status === "PENDING" ? 0 : 1;
        const pb = b.status === "PENDING" ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return new Date(a.requestedDate).getTime() - new Date(b.requestedDate).getTime();
      });
  }, [requests, search, statusFilter, typeFilter]);

  const stats = useMemo(() => ({
    pending: requests.filter(r => r.status === "PENDING").length,
    approved: requests.filter(r => r.status === "APPROVED").length,
    scheduled: requests.filter(r => r.status === "SCHEDULED").length,
    completed: requests.filter(r => r.status === "COMPLETED").length,
  }), [requests]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const handleApprove = async (req: TransportRequest) => {
    const confirmed = await Swal.fire({ title: "Approve?", text: `Approve transport for ${req.residentName}?`, icon: "question", showCancelButton: true, confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280", confirmButtonText: "Approve" });
    if (!confirmed.isConfirmed) return;
    try { await updateRecord("transport-requests", req.id, { status: "APPROVED", reviewedBy: "Dispatcher", reviewedAt: new Date().toISOString() }); await refetch(); Swal.fire({ title: "Approved", icon: "success", timer: 1500, showConfirmButton: false }); } catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Error", icon: "error" }); }
  };

  const handleDecline = async (req: TransportRequest) => {
    const result = await Swal.fire({ title: "Decline?", text: `Decline transport for ${req.residentName}?`, input: "text", inputLabel: "Reason", icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Decline", inputValidator: (v) => (!v ? "Reason required" : null) });
    if (!result.isConfirmed) return;
    try { await updateRecord("transport-requests", req.id, { status: "DECLINED", declineReason: String(result.value || ""), reviewedBy: "Dispatcher", reviewedAt: new Date().toISOString() }); await refetch(); Swal.fire({ title: "Declined", icon: "success", timer: 1500, showConfirmButton: false }); } catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Error", icon: "error" }); }
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Pending" value={String(stats.pending)} icon={Clock} color="amber" />
        <StatBox label="Approved" value={String(stats.approved)} icon={Check} color="blue" />
        <StatBox label="Scheduled" value={String(stats.scheduled)} icon={Truck} color="purple" />
        <StatBox label="Completed" value={String(stats.completed)} icon={CheckCircle2} color="green" />
      </div>

      {/* Toolbar */}
      <div className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          {REQ_STATUS_CHIPS.map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${statusFilter === s ? "bg-yellow-400 text-black border-yellow-400" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
              {s === "all" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-start sm:items-center">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Search resident or destination…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
          </div>
          <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
            <option value="all">All Types</option>
            {REQ_TYPES.map(t => <option key={t} value={t}>{REQ_TYPE_META[t].label}</option>)}
          </select>
          <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* Table / Cards */}
      {loading && requests.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading requests...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No requests match.</div>
      ) : (
        <>
          <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <Th>Resident</Th><Th>Type</Th><Th>Destination</Th><Th>Requested</Th><Th>Priority</Th><Th>Status</Th><Th align="center">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginated.map(req => {
                  const meta = REQ_TYPE_META[req.type] || REQ_TYPE_META.OTHER;
                  const TypeIcon = meta.icon;
                  return (
                    <tr key={req.id} className={`hover:bg-gray-50 transition ${req.priority === "EMERGENCY" && !["COMPLETED", "DECLINED", "CANCELLED"].includes(req.status) ? "bg-red-50/40" : ""}`}>
                      <Td><div className="font-medium text-gray-900">{req.residentName}</div><div className="text-xs text-gray-500">Rm {req.roomNumber}</div></Td>
                      <Td><span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${meta.pill}`}><TypeIcon className="w-3 h-3" /> {meta.label}</span></Td>
                      <Td className="text-xs"><span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-gray-400 flex-shrink-0" />{req.destination}</span></Td>
                      <Td className="text-xs">{fmtDT(req.requestedDate)}</Td>
                      <Td><span className={`inline-block px-2 py-0.5 rounded-full border text-xs font-semibold ${PRIORITY_PILL[req.priority] || PRIORITY_PILL.NORMAL}`}>{req.priority}</span></Td>
                      <Td><span className={`inline-block px-2 py-0.5 rounded-full border text-xs font-semibold ${STATUS_PILL[req.status] || STATUS_PILL.PENDING}`}>{req.status}</span></Td>
                      <Td>
                        <div className="flex items-center justify-center gap-1.5">
                          <button onClick={() => onView({ ...req, raw: req.raw, _tab: "requests" })} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                          {req.status === "PENDING" && <button onClick={() => handleApprove(req)} className="p-1.5 rounded hover:bg-green-100 text-green-600 transition" title="Approve"><Check className="w-4 h-4" /></button>}
                          {req.status === "PENDING" && <button onClick={() => handleDecline(req)} className="p-1.5 rounded hover:bg-red-100 text-red-500 transition" title="Decline"><BanIcon className="w-4 h-4" /></button>}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {paginated.map(req => {
              const meta = REQ_TYPE_META[req.type] || REQ_TYPE_META.OTHER;
              const TypeIcon = meta.icon;
              return (
                <div key={req.id} className={`bg-white rounded-lg border border-gray-200 p-4 space-y-2 ${req.priority === "EMERGENCY" ? "border-l-4 border-l-red-500" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${meta.pill}`}><TypeIcon className="w-3 h-3" /> {meta.label}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_PILL[req.status] || STATUS_PILL.PENDING}`}>{req.status}</span>
                  </div>
                  <p className="font-medium text-gray-900 text-sm">{req.residentName} <span className="text-xs text-gray-400">Rm {req.roomNumber}</span></p>
                  <p className="text-xs text-gray-600 flex items-center gap-1"><MapPin className="w-3 h-3 text-gray-400" /> {req.destination}</p>
                  <p className="text-xs text-gray-500">{fmtDT(req.requestedDate)} · <span className={`font-semibold ${req.priority === "EMERGENCY" ? "text-red-600" : ""}`}>{req.priority}</span></p>
                  <div className="flex gap-1 pt-1">
                    <button onClick={() => onView({ ...req, raw: req.raw, _tab: "requests" })} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition"><Eye className="w-3 h-3" /> View</button>
                    {req.status === "PENDING" && <button onClick={() => handleApprove(req)} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-green-600 bg-green-50 hover:bg-green-100 rounded transition"><Check className="w-3 h-3" /> Approve</button>}
                    {req.status === "PENDING" && <button onClick={() => handleDecline(req)} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded transition"><BanIcon className="w-3 h-3" /> Decline</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <Pagination page={page} totalPages={totalPages} total={filtered.length} label="requests" setPage={setPage} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════ */
/*                             TRIPS TAB                                         */
/* ══════════════════════════════════════════════════════════════════════════════ */

function TripsTab({ onView }: { onView: (r: Record<string, unknown>) => void }) {
  const { data: tripRows, loading, error, refetch } = useLiveQuery<Row>(
    "trips", { query: "include=resident,vehicle,driver&take=300", tables: ["Trip", "Vehicle", "Driver", "Resident"], pollMs: 10000 }
  );
  const trips = useMemo<Trip[]>(() => tripRows.map(adaptTrip), [tripRows]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const perPage = 10;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rank: Record<string, number> = { EN_ROUTE: 0, RETURNING: 1, ARRIVED: 2, INSPECTION: 3, SCHEDULED: 4, COMPLETED: 5, CANCELLED: 6 };
    return trips
      .filter(t => {
        if (statusFilter !== "all" && t.status !== statusFilter) return false;
        if (q && !t.residentName.toLowerCase().includes(q) && !t.destination.toLowerCase().includes(q) && !t.driverName.toLowerCase().includes(q) && !t.vehicleName.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const ra = rank[a.status] ?? 4;
        const rb = rank[b.status] ?? 4;
        if (ra !== rb) return ra - rb;
        return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
      });
  }, [trips, search, statusFilter]);

  const stats = useMemo(() => {
    const today = new Date().toDateString();
    return {
      scheduled: trips.filter(t => ["SCHEDULED", "INSPECTION"].includes(t.status)).length,
      inTransit: trips.filter(t => ["EN_ROUTE", "ARRIVED", "RETURNING"].includes(t.status)).length,
      completedToday: trips.filter(t => t.status === "COMPLETED" && t.completedAt && new Date(t.completedAt).toDateString() === today).length,
      cancelled: trips.filter(t => t.status === "CANCELLED").length,
    };
  }, [trips]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const handleDepart = async (trip: Trip) => {
    const confirmed = await Swal.fire({ title: "Depart?", text: `Start trip to ${trip.destination}?`, icon: "question", showCancelButton: true, confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280", confirmButtonText: "Depart" });
    if (!confirmed.isConfirmed) return;
    try {
      await updateRecord("trips", trip.id, { status: "EN_ROUTE", departedAt: new Date().toISOString(), familyNotified: true });
      if (trip.vehicleId) await updateRecord("vehicles", trip.vehicleId, { status: "ON_TRIP" });
      await refetch();
      Swal.fire({ title: "Departed", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Error", icon: "error" }); }
  };

  const handleArrive = async (trip: Trip) => {
    try { await updateRecord("trips", trip.id, { status: "ARRIVED", arrivedAt: new Date().toISOString() }); await refetch(); Swal.fire({ title: "Arrived", icon: "success", timer: 1500, showConfirmButton: false }); } catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Error", icon: "error" }); }
  };

  const handleStartReturn = async (trip: Trip) => {
    try { await updateRecord("trips", trip.id, { status: "RETURNING", returnDepartedAt: new Date().toISOString() }); await refetch(); Swal.fire({ title: "Return started", icon: "success", timer: 1500, showConfirmButton: false }); } catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Error", icon: "error" }); }
  };

  const handleComplete = async (trip: Trip) => {
    const confirmed = await Swal.fire({ title: "Complete Trip?", text: `Drop-off for ${trip.residentName}?`, icon: "question", showCancelButton: true, confirmButtonColor: "#22c55e", cancelButtonColor: "#6b7280", confirmButtonText: "Confirm" });
    if (!confirmed.isConfirmed) return;
    try {
      const now = new Date().toISOString();
      await updateRecord("trips", trip.id, { status: "COMPLETED", completedAt: now, billed: true });
      if (trip.vehicleId) await updateRecord("vehicles", trip.vehicleId, { status: "AVAILABLE", odometer: trip.vehicleOdometer + Math.round(trip.distanceKm || 0) });
      if (trip.requestId) await updateRecord("transport-requests", trip.requestId, { status: "COMPLETED" });
      await refetch();
      Swal.fire({ title: "Completed", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Error", icon: "error" }); }
  };

  const handleCancel = async (trip: Trip) => {
    const result = await Swal.fire({ title: "Cancel Trip?", text: `Cancel trip for ${trip.residentName}?`, input: "text", inputLabel: "Reason", icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Cancel Trip", inputValidator: (v) => (!v ? "Reason required" : null) });
    if (!result.isConfirmed) return;
    try {
      await updateRecord("trips", trip.id, { status: "CANCELLED", notes: trip.notes ? `${trip.notes} | Cancelled: ${result.value}` : `Cancelled: ${result.value}` });
      if (trip.vehicleId && trip.vehicleStatus === "ON_TRIP") await updateRecord("vehicles", trip.vehicleId, { status: "AVAILABLE" });
      await refetch(); Swal.fire({ title: "Cancelled", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) { Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Error", icon: "error" }); }
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Scheduled" value={String(stats.scheduled)} icon={Calendar} color="blue" />
        <StatBox label="In Transit" value={String(stats.inTransit)} icon={Navigation} color="amber" />
        <StatBox label="Completed Today" value={String(stats.completedToday)} icon={CheckCircle2} color="green" />
        <StatBox label="Cancelled" value={String(stats.cancelled)} icon={Ban} color="red" />
      </div>

      {/* Toolbar */}
      <div className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          {TRIP_STATUS_CHIPS.map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${statusFilter === s ? "bg-yellow-400 text-black border-yellow-400" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
              {s === "all" ? "All" : TRIP_STEP_LABELS[s] || s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-start sm:items-center">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Search resident, destination, driver, vehicle…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
          </div>
          <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* Table / Cards */}
      {loading && trips.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading trips...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No trips match.</div>
      ) : (
        <>
          <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <Th>Resident</Th><Th>Route</Th><Th>Vehicle</Th><Th>Driver</Th><Th>Scheduled</Th><Th>Status</Th><Th align="right">Charge</Th><Th align="center">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginated.map(trip => (
                  <tr key={trip.id} className="hover:bg-gray-50 transition">
                    <Td><div className="font-medium text-gray-900">{trip.residentName}</div><div className="text-xs text-gray-500">Rm {trip.roomNumber}</div></Td>
                    <Td className="text-xs"><span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-gray-400 flex-shrink-0" />{trip.origin} → {trip.destination}</span></Td>
                    <Td className="text-xs">{trip.vehicleName} <span className="text-gray-400">{trip.vehiclePlate}</span></Td>
                    <Td className="text-xs">{trip.driverName}</Td>
                    <Td className="text-xs">{fmtDT(trip.scheduledAt)}</Td>
                    <Td><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${TRIP_STATUS_PILL[trip.status] || TRIP_STATUS_PILL.SCHEDULED}`}>{TRIP_STEP_LABELS[trip.status] || trip.status}</span></Td>
                    <Td align="right" className="font-medium">{trip.charge != null ? fmtCurrency(trip.charge) : "—"}</Td>
                    <Td>
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => onView({ ...trip, raw: trip.raw, _tab: "trips" })} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                        {trip.status === "INSPECTION" && <button onClick={() => handleDepart(trip)} className="p-1.5 rounded hover:bg-amber-100 text-amber-600 transition" title="Depart"><Play className="w-4 h-4" /></button>}
                        {trip.status === "EN_ROUTE" && <button onClick={() => handleArrive(trip)} className="p-1.5 rounded hover:bg-purple-100 text-purple-600 transition" title="Arrive"><Flag className="w-4 h-4" /></button>}
                        {trip.status === "ARRIVED" && <button onClick={() => handleStartReturn(trip)} className="p-1.5 rounded hover:bg-cyan-100 text-cyan-600 transition" title="Return"><Undo2 className="w-4 h-4" /></button>}
                        {["ARRIVED", "RETURNING"].includes(trip.status) && <button onClick={() => handleComplete(trip)} className="p-1.5 rounded hover:bg-green-100 text-green-600 transition" title="Complete"><CheckCircle2 className="w-4 h-4" /></button>}
                        {TRIP_ACTIVE.includes(trip.status) && <button onClick={() => handleCancel(trip)} className="p-1.5 rounded hover:bg-red-100 text-red-500 transition" title="Cancel"><Ban className="w-4 h-4" /></button>}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {paginated.map(trip => (
              <div key={trip.id} className={`bg-white rounded-lg border border-gray-200 p-4 space-y-2 ${["EN_ROUTE", "RETURNING"].includes(trip.status) ? "border-l-4 border-l-yellow-400" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${TRIP_STATUS_PILL[trip.status] || TRIP_STATUS_PILL.SCHEDULED}`}>{TRIP_STEP_LABELS[trip.status] || trip.status}</span>
                  <span className="text-sm font-semibold text-gray-900">{trip.charge != null ? fmtCurrency(trip.charge) : "—"}</span>
                </div>
                <p className="font-medium text-gray-900 text-sm">{trip.residentName} <span className="text-xs text-gray-400">Rm {trip.roomNumber}</span></p>
                <p className="text-xs text-gray-600 flex items-center gap-1"><MapPin className="w-3 h-3 text-gray-400" /> {trip.origin} → {trip.destination}</p>
                <p className="text-xs text-gray-500">{trip.vehicleName} · {trip.driverName} · {fmtDT(trip.scheduledAt)}</p>
                <div className="flex gap-1 pt-1 flex-wrap">
                  <button onClick={() => onView({ ...trip, raw: trip.raw, _tab: "trips" })} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition"><Eye className="w-3 h-3" /> View</button>
                  {trip.status === "INSPECTION" && <button onClick={() => handleDepart(trip)} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded transition"><Play className="w-3 h-3" /> Depart</button>}
                  {trip.status === "EN_ROUTE" && <button onClick={() => handleArrive(trip)} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 rounded transition"><Flag className="w-3 h-3" /> Arrive</button>}
                  {["ARRIVED", "RETURNING"].includes(trip.status) && <button onClick={() => handleComplete(trip)} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-green-500 hover:bg-green-600 rounded transition"><CheckCircle2 className="w-3 h-3" /> Done</button>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <Pagination page={page} totalPages={totalPages} total={filtered.length} label="trips" setPage={setPage} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════ */
/*                           VIEW MODAL                                          */
/* ══════════════════════════════════════════════════════════════════════════════ */

function ViewModal({ row, onClose }: { row: Record<string, unknown>; onClose: () => void }) {
  const tab = str(row._tab);
  const title = tab === "maintenance" ? "Work Order Details" : tab === "fuel" ? "Fuel Log Details" : tab === "requests" ? "Transport Request Details" : "Trip Details";

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-4">
          {tab === "maintenance" && <MaintenanceDetail row={row} />}
          {tab === "fuel" && <FuelDetail row={row} />}
          {tab === "requests" && <RequestDetail row={row} />}
          {tab === "trips" && <TripDetail row={row} />}
        </div>
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 bg-gray-200 text-gray-700 hover:bg-gray-300 rounded-lg transition font-medium text-sm">Close</button>
        </div>
      </div>
    </div>
  );
}

function MaintenanceDetail({ row }: { row: Record<string, unknown> }) {
  const meta = MAINT_TYPE_META[str(row.type)] || MAINT_TYPE_META.REPAIR;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${meta.cls}`}><meta.icon className="w-3.5 h-3.5" /> {str(row.type)}</span>
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${MAINT_STATUS_STYLES[str(row.status)] || ""}`}>{str(row.status).replace(/_/g, " ")}</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <VF label="Title" value={str(row.title)} /><VF label="Vehicle" value={`${str(row.vehicleName)} ${row.vehiclePlate ? `(${str(row.vehiclePlate)})` : ""}`} />
        <VF label="Scheduled" value={fmtDate(str(row.scheduledDate))} /><VF label="Completed" value={fmtDate(str(row.completedDate))} />
        <VF label="Vendor" value={str(row.vendor) || "—"} /><VF label="Odometer" value={row.odometerAt ? `${Number(row.odometerAt).toLocaleString()} km` : "—"} />
        <VF label="Cost" value={row.cost ? fmtCurrency(Number(row.cost)) : "—"} /><VF label="Downtime" value={row.downtimeHours ? `${row.downtimeHours} h` : "—"} />
      </div>
      {str(row.description) && <div><p className="text-xs font-semibold text-gray-600 mb-1">Description</p><p className="text-sm text-gray-800 bg-gray-50 p-3 rounded border border-gray-200">{str(row.description)}</p></div>}
      {str(row.notes) && <div><p className="text-xs font-semibold text-gray-600 mb-1">Notes</p><p className="text-sm text-gray-800 bg-gray-50 p-3 rounded border border-gray-200">{str(row.notes)}</p></div>}
    </div>
  );
}

function FuelDetail({ row }: { row: Record<string, unknown> }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${FUEL_TYPE_STYLES[str(row.fuelType)] || "bg-gray-100 text-gray-700"}`}>{str(row.fuelType)}</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <VF label="Vehicle" value={`${str(row.vehicleName)} ${row.vehiclePlate ? `(${str(row.vehiclePlate)})` : ""}`} />
        <VF label="Driver" value={str(row.driverName) || "—"} />
        <VF label="Date" value={fmtDT(str(row.logDate))} />
        <VF label="Odometer" value={row.odometer ? `${Number(row.odometer).toLocaleString()} km` : "—"} />
        <VF label="Liters" value={row.liters ? `${Number(row.liters).toLocaleString(undefined, { maximumFractionDigits: 1 })} L` : "—"} />
        <VF label="Cost" value={row.cost ? fmtCurrency(Number(row.cost)) : "—"} />
        <VF label="Cost/Liter" value={row.liters && Number(row.liters) > 0 ? `₱${(Number(row.cost) / Number(row.liters)).toFixed(2)}` : "—"} />
      </div>
      {str(row.notes) && <div><p className="text-xs font-semibold text-gray-600 mb-1">Notes</p><p className="text-sm text-gray-800 bg-gray-50 p-3 rounded border border-gray-200">{str(row.notes)}</p></div>}
    </div>
  );
}

function RequestDetail({ row }: { row: Record<string, unknown> }) {
  const meta = REQ_TYPE_META[str(row.type)] || REQ_TYPE_META.OTHER;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium ${meta.pill}`}><meta.icon className="w-3 h-3" /> {meta.label}</span>
        <span className={`px-2.5 py-1 rounded-full border text-xs font-semibold ${PRIORITY_PILL[str(row.priority)] || PRIORITY_PILL.NORMAL}`}>{str(row.priority)}</span>
        <span className={`px-2.5 py-1 rounded-full border text-xs font-semibold ${STATUS_PILL[str(row.status)] || STATUS_PILL.PENDING}`}>{str(row.status)}</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <VF label="Resident" value={`${str(row.residentName)} · Room ${str(row.roomNumber)}`} />
        <VF label="Destination" value={str(row.destination)} />
        <VF label="Requested" value={fmtDT(str(row.requestedDate))} />
        <VF label="Source" value={str(row.source).replace(/_/g, " ")} />
        <VF label="Purpose" value={str(row.purpose) || "—"} />
        <VF label="Wheelchair" value={row.wheelchairNeeded ? "Yes" : "No"} />
        <VF label="Escort" value={row.escortRequired ? `Yes (${str(row.escortRole)})` : "No"} />
        <VF label="Return Trip" value={row.returnRequired ? "Yes" : "No"} />
      </div>
      {str(row.notes) && <div><p className="text-xs font-semibold text-gray-600 mb-1">Notes</p><p className="text-sm text-gray-800 bg-gray-50 p-3 rounded border border-gray-200">{str(row.notes)}</p></div>}
      {str(row.declineReason) && <div><p className="text-xs font-semibold text-red-600 mb-1">Decline Reason</p><p className="text-sm text-red-700 bg-red-50 p-3 rounded border border-red-200">{str(row.declineReason)}</p></div>}
    </div>
  );
}

function TripDetail({ row }: { row: Record<string, unknown> }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`px-2.5 py-1 rounded-full border text-xs font-semibold ${TRIP_STATUS_PILL[str(row.status)] || TRIP_STATUS_PILL.SCHEDULED}`}>{TRIP_STEP_LABELS[str(row.status)] || str(row.status)}</span>
        {row.billed && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 text-[11px] font-semibold"><Receipt className="w-3 h-3" /> Billed</span>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <VF label="Resident" value={`${str(row.residentName)} · Room ${str(row.roomNumber)}`} />
        <VF label="Destination" value={str(row.destination)} />
        <VF label="Origin" value={str(row.origin)} />
        <VF label="Vehicle" value={`${str(row.vehicleName)} (${str(row.vehiclePlate)})`} />
        <VF label="Driver" value={str(row.driverName)} />
        {str(row.escortName) && <VF label="Escort" value={`${str(row.escortName)}${row.escortRole ? ` (${str(row.escortRole)})` : ""}`} />}
        <VF label="Scheduled" value={fmtDT(str(row.scheduledAt))} />
        <VF label="Departed" value={fmtDT(str(row.departedAt))} />
        <VF label="Arrived" value={fmtDT(str(row.arrivedAt))} />
        <VF label="Completed" value={fmtDT(str(row.completedAt))} />
        <VF label="Distance" value={row.distanceKm ? `${Number(row.distanceKm).toFixed(1)} km` : "—" } />
        <VF label="Charge" value={row.charge != null ? fmtCurrency(Number(row.charge)) : "—"} />
      </div>
      {str(row.notes) && <div><p className="text-xs font-semibold text-gray-600 mb-1">Notes</p><p className="text-sm text-gray-800 bg-gray-50 p-3 rounded border border-gray-200">{str(row.notes)}</p></div>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════ */
/*                          SHARED SUB-COMPONENTS                                */
/* ══════════════════════════════════════════════════════════════════════════════ */

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
    <div className={`rounded-lg border p-3 ${c}`}>
      <div className="flex items-center justify-between mb-0.5">
        <p className="text-[11px] font-semibold text-gray-600 truncate">{label}</p>
        <Icon className={`w-3.5 h-3.5 ${c.split(" ")[0]} flex-shrink-0`} />
      </div>
      <p className={`text-xl sm:text-2xl font-bold ${c.split(" ")[0]}`}>{value}</p>
    </div>
  );
}

function Pagination({ page, totalPages, total, label, setPage }: { page: number; totalPages: number; total: number; label: string; setPage: (fn: (p: number) => number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div className="text-sm text-gray-600">{total} {label} total</div>
      <div className="flex items-center gap-2">
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
          className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm font-medium">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="px-3 py-2 text-sm font-medium text-gray-700">{page} / {totalPages}</span>
        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
          className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm font-medium">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" | "center" }) {
  const cls = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return <th className={`${cls} px-4 py-3 font-semibold text-gray-700`}>{children}</th>;
}

function Td({ children, align, className = "", title }: { children: React.ReactNode; align?: "left" | "right" | "center"; className?: string; title?: string }) {
  const cls = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return <td className={`${cls} px-4 py-3 text-gray-600 ${className}`} title={title}>{children}</td>;
}

function VF({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 p-3 rounded border border-gray-200">
      <p className="text-[11px] text-gray-500 font-semibold mb-0.5">{label}</p>
      <p className="text-sm font-medium text-gray-900">{value}</p>
    </div>
  );
}

function MaintFormModal({ title, form, onChange, onSave, onCancel, vehicles }: {
  title: string; form: { vehicleId: string; type: string; status: string; title: string; description: string; scheduledDate: string; vendor: string; odometerAt: string; cost: string; downtimeHours: string; notes: string };
  onChange: (f: typeof form) => void; onSave: () => void; onCancel: () => void; vehicles: Vehicle[];
}) {
  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange({ ...form, [field]: e.target.value });
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onCancel} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><label className="block text-sm font-semibold text-gray-700 mb-1">Vehicle</label>
              <select value={form.vehicleId} onChange={set("vehicleId")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none"><option value="">Select…</option>{vehicles.map(v => <option key={v.id} value={v.id}>{v.name} ({v.licensePlate})</option>)}</select></div>
            <div><label className="block text-sm font-semibold text-gray-700 mb-1">Type</label>
              <select value={form.type} onChange={set("type")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">{MAINT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className="block text-sm font-semibold text-gray-700 mb-1">Status</label>
              <select value={form.status} onChange={set("status")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">{MAINT_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select></div>
            <div className="col-span-2"><label className="block text-sm font-semibold text-gray-700 mb-1">Title</label>
              <input type="text" value={form.title} onChange={set("title")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" placeholder="e.g. Brake pad replacement" /></div>
            <div className="col-span-2"><label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
              <textarea value={form.description} onChange={set("description")} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
            <div><label className="block text-sm font-semibold text-gray-700 mb-1">Scheduled Date</label>
              <input type="date" value={form.scheduledDate} onChange={set("scheduledDate")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
            <div><label className="block text-sm font-semibold text-gray-700 mb-1">Vendor</label>
              <input type="text" value={form.vendor} onChange={set("vendor")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" placeholder="Vendor or garage" /></div>
            <div><label className="block text-sm font-semibold text-gray-700 mb-1">Odometer (km)</label>
              <input type="number" min="0" value={form.odometerAt} onChange={set("odometerAt")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
            <div><label className="block text-sm font-semibold text-gray-700 mb-1">Cost (₱)</label>
              <input type="number" min="0" step="0.01" value={form.cost} onChange={set("cost")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
            <div><label className="block text-sm font-semibold text-gray-700 mb-1">Downtime Hours</label>
              <input type="number" min="0" step="0.5" value={form.downtimeHours} onChange={set("downtimeHours")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
            <div className="col-span-2"><label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
              <textarea value={form.notes} onChange={set("notes")} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
          </div>
        </div>
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
          <button onClick={onCancel} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
          <button onClick={onSave} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">{title.includes("Edit") ? "Save Changes" : "Create"}</button>
        </div>
      </div>
    </div>
  );
}
