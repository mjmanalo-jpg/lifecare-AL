"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState } from "react";
import {
  Bus, Search, AlertTriangle, Plus, X, RefreshCw, Check, Ban, Siren,
  Stethoscope, Droplets, HeartPulse, TreePine, Accessibility, UserCheck,
  Repeat, MapPin, Calendar, ClipboardList, Truck, ShieldCheck, User,
  DollarSign, Hash, CheckCircle2, XCircle, Clock,
  type LucideIcon,
} from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
} from "recharts";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { useFacilityConfig } from "@/lib/useFacilityConfig";
import { createRecord, updateRecord } from "@/lib/api";

/* ── Safe coercion helpers ── */
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : v == null ? d : String(v));
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const bool = (v: unknown): boolean => v === true;
const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/* ── Adapters ── */
function adaptRequest(row: Record<string, unknown>) {
  const resident = rec(row.resident);
  const name = resident ? `${str(resident.firstName)} ${str(resident.lastName)}`.trim() : "";
  return {
    id: str(row.id),
    residentId: str(row.residentId),
    residentName: name || "Unknown Resident",
    roomNumber: resident ? str(resident.roomNumber, "—") : "—",
    type: str(row.type, "OTHER"),
    destination: str(row.destination, "—"),
    pickupLocation: str(row.pickupLocation, "Golden Hearth Facility"),
    dropoffLocation: str(row.dropoffLocation) || str(row.destination, "—"),
    purpose: str(row.purpose),
    requestedDate: str(row.requestedDate),
    createdAt: str(row.createdAt),
    returnRequired: bool(row.returnRequired),
    wheelchairNeeded: bool(row.wheelchairNeeded),
    escortRequired: bool(row.escortRequired),
    escortRole: str(row.escortRole),
    priority: str(row.priority, "NORMAL"),
    status: str(row.status, "PENDING"),
    source: str(row.source, "PORTAL"),
    notes: str(row.notes),
    declineReason: str(row.declineReason),
    hasTrip: !!rec(row.trip),
    raw: row,
  };
}
type TransportRequest = ReturnType<typeof adaptRequest>;

function adaptResident(row: Record<string, unknown>) {
  return {
    id: str(row.id),
    name: `${str(row.firstName)} ${str(row.lastName)}`.trim() || "Unknown",
    roomNumber: str(row.roomNumber, "—"),
  };
}

function adaptVehicle(row: Record<string, unknown>) {
  return {
    id: str(row.id),
    name: str(row.name, "Vehicle"),
    licensePlate: str(row.licensePlate, "—"),
    type: str(row.type, "SHUTTLE"),
    status: str(row.status, "AVAILABLE"),
    capacity: num(row.capacity),
    wheelchairCapacity: num(row.wheelchairCapacity),
  };
}
type Vehicle = ReturnType<typeof adaptVehicle>;

function adaptDriver(row: Record<string, unknown>) {
  return {
    id: str(row.id),
    name: str(row.name, "Driver"),
    phone: str(row.phone),
    licenseNumber: str(row.licenseNumber, "—"),
    licenseExpiry: str(row.licenseExpiry),
    certifications: str(row.certifications),
    safetyScore: num(row.safetyScore),
    tripHours: num(row.tripHours),
    isActive: bool(row.isActive),
  };
}
type Driver = ReturnType<typeof adaptDriver>;

/* ── Constants ── */
const TYPE_META: Record<string, { label: string; icon: LucideIcon; color: string; pill: string }> = {
  MEDICAL_APPOINTMENT: { label: "Medical Appointment", icon: Stethoscope, color: "#3b82f6", pill: "bg-blue-50 text-blue-700 border-blue-200" },
  DIALYSIS: { label: "Dialysis", icon: Droplets, color: "#06b6d4", pill: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  THERAPY: { label: "Therapy", icon: HeartPulse, color: "#ec4899", pill: "bg-pink-50 text-pink-700 border-pink-200" },
  FAMILY_OUTING: { label: "Family Outing", icon: TreePine, color: "#22c55e", pill: "bg-green-50 text-green-700 border-green-200" },
  EMERGENCY_TRANSFER: { label: "Emergency Transfer", icon: Siren, color: "#ef4444", pill: "bg-red-50 text-red-700 border-red-200" },
  OTHER: { label: "Other", icon: Bus, color: "#6b7280", pill: "bg-gray-50 text-gray-700 border-gray-200" },
};
const TYPES = Object.keys(TYPE_META);

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
const STATUS_CHIPS = ["all", "PENDING", "APPROVED", "SCHEDULED", "DECLINED", "COMPLETED", "CANCELLED"];

const DEFAULT_CHARGE: Record<string, number> = {
  EMERGENCY_TRANSFER: 250, MEDICAL_APPOINTMENT: 75, DIALYSIS: 60,
  THERAPY: 60, FAMILY_OUTING: 50, OTHER: 50,
};

const emptyRequestForm = {
  residentId: "", type: "MEDICAL_APPOINTMENT",
  pickupLocation: "Golden Hearth Facility", dropoffLocation: "", purpose: "",
  requestedDate: "", returnRequired: true, wheelchairNeeded: false,
  escortRequired: false, escortRole: "NURSE", priority: "NORMAL", notes: "",
};
type RequestForm = typeof emptyRequestForm;

const emptyAssignForm = {
  vehicleId: "", driverId: "", escortName: "", escortRole: "NURSE",
  scheduledAt: "", distanceKm: "", charge: "50",
};

/* ── Date helpers ── */
function toLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fmtDT = (iso: string) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

function licenseState(expiry: string): { label: string; cls: string; expired: boolean } {
  if (!expiry) return { label: "Unknown", cls: "bg-gray-100 text-gray-600", expired: false };
  const days = Math.floor((new Date(expiry).getTime() - Date.now()) / 86400000);
  if (days < 0) return { label: "Expired", cls: "bg-red-100 text-red-700", expired: true };
  if (days <= 30) return { label: `Expiring in ${days}d`, cls: "bg-amber-100 text-amber-700", expired: false };
  return { label: "Valid", cls: "bg-green-100 text-green-700", expired: false };
}

export default function FleetRequests() {
  const { data: requestRows, loading, error, refetch } = useLiveQuery<Record<string, unknown>>(
    "transport-requests", { query: "include=resident,trip&take=300", tables: ["TransportRequest", "Trip", "Resident"] }
  );
  const { data: residentRows } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "take=300", tables: ["Resident"] }
  );
  const { data: vehicleRows, refetch: refetchVehicles } = useLiveQuery<Record<string, unknown>>(
    "vehicles", { query: "take=300", tables: ["Vehicle"] }
  );
  const { data: driverRows } = useLiveQuery<Record<string, unknown>>(
    "drivers", { query: "take=300", tables: ["Driver"] }
  );
  const { facilityName } = useFacilityConfig();

  const requests = useMemo<TransportRequest[]>(() => requestRows.map(adaptRequest), [requestRows]);
  const residents = useMemo(() => residentRows.map(adaptResident), [residentRows]);
  const vehicles = useMemo<Vehicle[]>(() => vehicleRows.map(adaptVehicle), [vehicleRows]);
  const drivers = useMemo<Driver[]>(() => driverRows.map(adaptDriver), [driverRows]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<RequestForm>(emptyRequestForm);
  const [assigning, setAssigning] = useState<TransportRequest | null>(null);
  const [assignForm, setAssignForm] = useState(emptyAssignForm);
  const [page, setPage] = useState(1);
  const perPage = 15;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests
      .filter(r => {
        if (statusFilter !== "all" && r.status !== statusFilter) return false;
        if (typeFilter !== "all" && r.type !== typeFilter) return false;
        if (q && !r.residentName.toLowerCase().includes(q) && !r.destination.toLowerCase().includes(q)) return false;
        return true;
      })
      // Most recently submitted request first (falls back to the requested
      // pickup date when a row has no createdAt).
      .sort((a, b) => {
        const ta = new Date(a.createdAt || a.requestedDate).getTime();
        const tb = new Date(b.createdAt || b.requestedDate).getTime();
        return tb - ta;
      });
  }, [requests, search, statusFilter, typeFilter]);

  const stats = useMemo(() => ({
    pending: requests.filter(r => r.status === "PENDING").length,
    approved: requests.filter(r => r.status === "APPROVED").length,
    scheduled: requests.filter(r => r.status === "SCHEDULED").length,
    emergency: requests.filter(r => r.priority === "EMERGENCY" && !["COMPLETED", "DECLINED", "CANCELLED"].includes(r.status)).length,
    completed: requests.filter(r => r.status === "COMPLETED").length,
    declined: requests.filter(r => r.status === "DECLINED").length,
  }), [requests]);

  const typeDist = useMemo(() => {
    return TYPES.map(t => ({
      name: TYPE_META[t].label,
      value: requests.filter(r => r.type === t).length,
      color: TYPE_META[t].color,
    })).filter(d => d.value > 0);
  }, [requests]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const start = (page - 1) * perPage;
  const paginated = filtered.slice(start, start + perPage);

  const availableVehicles = useMemo(() => vehicles.filter(v => v.status === "AVAILABLE"), [vehicles]);
  const activeDrivers = useMemo(() => drivers.filter(d => d.isActive), [drivers]);
  const selectedVehicle = availableVehicles.find(v => v.id === assignForm.vehicleId) || null;
  const selectedDriver = activeDrivers.find(d => d.id === assignForm.driverId) || null;

  /* ── Handlers ── */
  const openNewRequest = () => {
    setCreateForm({ ...emptyRequestForm, requestedDate: toLocalInput(new Date().toISOString()) });
    setShowCreate(true);
  };

  const openEmergencyTransfer = () => {
    setCreateForm({
      ...emptyRequestForm,
      type: "EMERGENCY_TRANSFER",
      priority: "EMERGENCY",
      pickupLocation: "Golden Hearth Facility",
      dropoffLocation: "Nearest Hospital — ER",
      requestedDate: toLocalInput(new Date().toISOString()),
    });
    setShowCreate(true);
  };

  const handleCreate = async () => {
    if (!createForm.residentId || !createForm.dropoffLocation || !createForm.requestedDate) {
      Swal.fire({ title: "Missing Fields", text: "Resident, drop-off and requested date are required.", icon: "warning" });
      return;
    }
    const confirmed = await Swal.fire({
      title: createForm.priority === "EMERGENCY" ? "Submit Emergency Transfer?" : "Submit Request?",
      icon: "question", showCancelButton: true,
      confirmButtonColor: createForm.priority === "EMERGENCY" ? "#ef4444" : "#fbbf24",
      cancelButtonColor: "#6b7280", confirmButtonText: "Submit",
    });
    if (!confirmed.isConfirmed) return;
    try {
      await createRecord("transport-requests", {
        residentId: createForm.residentId,
        type: createForm.type,
        pickupLocation: createForm.pickupLocation,
        dropoffLocation: createForm.dropoffLocation,
        destination: createForm.dropoffLocation,
        purpose: createForm.purpose,
        requestedDate: new Date(createForm.requestedDate).toISOString(),
        returnRequired: createForm.returnRequired,
        wheelchairNeeded: createForm.wheelchairNeeded,
        escortRequired: createForm.escortRequired,
        escortRole: createForm.escortRequired ? createForm.escortRole : null,
        priority: createForm.priority,
        status: "PENDING",
        source: "FRONT_DESK",
        notes: createForm.notes,
      });
      await refetch();
      setShowCreate(false);
      setCreateForm(emptyRequestForm);
      Swal.fire({ title: "Request Submitted", text: "Dispatchers have been notified.", icon: "success", timer: 1800, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Submit Failed", text: err instanceof Error ? err.message : "Could not create request.", icon: "error" });
    }
  };

  const openAssign = (req: TransportRequest) => {
    setAssigning(req);
    setAssignForm({
      vehicleId: "", driverId: "", escortName: "",
      escortRole: req.escortRole || "NURSE",
      scheduledAt: toLocalInput(req.requestedDate) || toLocalInput(new Date().toISOString()),
      distanceKm: "",
      charge: String(DEFAULT_CHARGE[req.type] ?? 50),
    });
  };

  const handleApprove = async (req: TransportRequest) => {
    const confirmed = await Swal.fire({
      title: "Approve Request?",
      text: `Approve transport for ${req.residentName} to ${req.destination}? You will assign a vehicle and driver next.`,
      icon: "question", showCancelButton: true,
      confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280", confirmButtonText: "Approve",
    });
    if (!confirmed.isConfirmed) return;
    try {
      await updateRecord("transport-requests", req.id, {
        status: "APPROVED", reviewedBy: "Dispatcher", reviewedAt: new Date().toISOString(),
      });
      await refetch();
      openAssign({ ...req, status: "APPROVED" });
    } catch (err) {
      Swal.fire({ title: "Approve Failed", text: err instanceof Error ? err.message : "Could not approve request.", icon: "error" });
    }
  };

  const handleDecline = async (req: TransportRequest) => {
    const result = await Swal.fire({
      title: "Decline Request",
      text: `Decline transport for ${req.residentName}?`,
      input: "text",
      inputLabel: "Reason for declining",
      inputPlaceholder: "e.g. No vehicle available at requested time",
      icon: "warning", showCancelButton: true,
      confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Decline",
      inputValidator: (v) => (!v ? "A decline reason is required." : null),
    });
    if (!result.isConfirmed) return;
    try {
      await updateRecord("transport-requests", req.id, {
        status: "DECLINED", declineReason: String(result.value || ""),
        reviewedBy: "Dispatcher", reviewedAt: new Date().toISOString(),
      });
      await refetch();
      Swal.fire({ title: "Declined", text: "The request has been declined.", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Decline Failed", text: err instanceof Error ? err.message : "Could not decline request.", icon: "error" });
    }
  };

  const handleAssign = async () => {
    if (!assigning) return;
    if (!assignForm.vehicleId || !assignForm.driverId || !assignForm.scheduledAt) {
      Swal.fire({ title: "Missing Fields", text: "Vehicle, driver and schedule are required.", icon: "warning" });
      return;
    }
    const drv = activeDrivers.find(d => d.id === assignForm.driverId);
    if (drv && licenseState(drv.licenseExpiry).expired) {
      Swal.fire({ title: "License Expired", text: `${drv.name}'s driver license is expired. Choose another driver.`, icon: "warning" });
      return;
    }
    if (assigning.escortRequired && !assignForm.escortName.trim()) {
      Swal.fire({ title: "Escort Required", text: "This request requires an escort — enter the escort name.", icon: "warning" });
      return;
    }
    const confirmed = await Swal.fire({
      title: "Schedule Trip?",
      text: `Dispatch ${assigning.residentName} to ${assigning.destination}. The family sponsor will be notified.`,
      icon: "question", showCancelButton: true,
      confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280", confirmButtonText: "Schedule Trip",
    });
    if (!confirmed.isConfirmed) return;
    try {
      await createRecord("trips", {
        requestId: assigning.id,
        residentId: assigning.residentId,
        vehicleId: assignForm.vehicleId,
        driverId: assignForm.driverId,
        escortName: assigning.escortRequired ? assignForm.escortName.trim() : null,
        escortRole: assigning.escortRequired ? assignForm.escortRole : null,
        pickupLocation: assigning.pickupLocation,
        dropoffLocation: assigning.dropoffLocation,
        destination: assigning.dropoffLocation,
        origin: assigning.pickupLocation || facilityName || "Facility",
        scheduledAt: new Date(assignForm.scheduledAt).toISOString(),
        distanceKm: assignForm.distanceKm ? Number(assignForm.distanceKm) : null,
        charge: Number(assignForm.charge) || 0,
        status: "SCHEDULED",
        notes: assigning.purpose,
      });
      await updateRecord("transport-requests", assigning.id, { status: "SCHEDULED" });
      // Vehicle stays AVAILABLE until the trip actually departs.
      await refetch();
      await refetchVehicles();

      // Best-effort SMS to the assigned driver (who may not be a system user).
      // No-op when no SMS provider is configured; never blocks the dispatch.
      if (selectedDriver?.phone) {
        const when = new Date(assignForm.scheduledAt).toLocaleString();
        void fetch("/api/sms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            to: selectedDriver.phone,
            message: `Transport booked: bring ${assigning.residentName} to ${assigning.dropoffLocation || assigning.destination} on ${when}. — ${facilityName || "Facility"}`,
          }),
        }).catch(() => { /* SMS is best-effort */ });
      }

      setAssigning(null);
      Swal.fire({ title: "Trip Scheduled", text: `Trip scheduled — family notified${selectedDriver?.phone ? " and driver texted" : ""}.`, icon: "success", timer: 2000, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Scheduling Failed", text: err instanceof Error ? err.message : "Could not schedule trip.", icon: "error" });
    }
  };

  const wheelchairMismatch = !!(assigning?.wheelchairNeeded && selectedVehicle && selectedVehicle.wheelchairCapacity === 0);
  const driverLic = selectedDriver ? licenseState(selectedDriver.licenseExpiry) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Transport Requests
          </h1>
          <p className="text-gray-600">Dispatcher review, priority &amp; approval</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <RefreshButton onRefresh={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium" />
          <button onClick={openEmergencyTransfer} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
            <Siren className="w-4 h-4" /> Emergency Transfer
          </button>
          <button onClick={openNewRequest} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
            <Plus className="w-4 h-4" /> New Request
          </button>
        </div>
      </div>

      {/* Stat Boxes */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        <StatBox label="Pending" value={String(stats.pending)} icon={Clock} color="amber" />
        <StatBox label="Approved" value={String(stats.approved)} icon={Check} color="blue" />
        <StatBox label="Scheduled" value={String(stats.scheduled)} icon={Truck} color="purple" />
        <StatBox label="Emergency" value={String(stats.emergency)} icon={Siren} color="red" />
        <StatBox label="Completed" value={String(stats.completed)} icon={CheckCircle2} color="green" />
        <StatBox label="Declined" value={String(stats.declined)} icon={XCircle} color="red" />
      </div>

      {/* Chart */}
      {typeDist.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <ClipboardList className="w-4 h-4 text-yellow-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Requests by Type</h3>
          </div>
          <div className="h-[170px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={typeDist} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={35} outerRadius={60} paddingAngle={2}>
                  {typeDist.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip />
                <Legend layout="vertical" align="right" verticalAlign="middle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          {STATUS_CHIPS.map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                statusFilter === s
                  ? "bg-yellow-400 text-black border-yellow-400"
                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              }`}>
              {s === "all" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Search resident or destination…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
          </div>
          <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
            <option value="all">All Types</option>
            {TYPES.map(t => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {loading && requests.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading transport requests...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No requests match your filters.</div>
      ) : (
        /* ── Request Table ── */
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Resident</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Destination</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Requested</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Priority</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Flags</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Source</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.map(req => {
                const meta = TYPE_META[req.type] || TYPE_META.OTHER;
                const TypeIcon = meta.icon;
                return (
                  <tr key={req.id} className={`hover:bg-gray-50 transition ${req.priority === "EMERGENCY" && !["COMPLETED", "DECLINED", "CANCELLED"].includes(req.status) ? "bg-red-50/40" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{req.residentName}</div>
                      <div className="text-xs text-gray-500">Room {req.roomNumber}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${meta.pill}`}>
                        <TypeIcon className="w-3 h-3" /> {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <div className="flex items-center gap-1 text-xs">
                        <MapPin className="w-3 h-3 text-green-500 flex-shrink-0" />
                        <span className="truncate max-w-[130px]" title={req.pickupLocation}>{req.pickupLocation}</span>
                        <span className="text-gray-400">→</span>
                        <MapPin className="w-3 h-3 text-red-500 flex-shrink-0" />
                        <span className="truncate max-w-[130px] font-medium" title={req.dropoffLocation}>{req.dropoffLocation}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{fmtDT(req.requestedDate)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full border text-xs font-semibold ${PRIORITY_PILL[req.priority] || PRIORITY_PILL.NORMAL}`}>
                        {req.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-gray-500">
                        {req.wheelchairNeeded && <span title="Wheelchair needed"><Accessibility className="w-4 h-4 text-blue-500" /></span>}
                        {req.escortRequired && <span title={`Escort required${req.escortRole ? ` (${req.escortRole})` : ""}`}><UserCheck className="w-4 h-4 text-purple-500" /></span>}
                        {req.returnRequired && <span title="Round trip"><Repeat className="w-4 h-4 text-green-500" /></span>}
                        {!req.wheelchairNeeded && !req.escortRequired && !req.returnRequired && <span className="text-xs">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-semibold tracking-wide">{req.source.replace(/_/g, " ")}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full border text-xs font-semibold ${STATUS_PILL[req.status] || STATUS_PILL.PENDING}`}>
                        {req.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        {req.status === "PENDING" && (
                          <>
                            <button onClick={() => handleApprove(req)} className="px-2.5 py-1.5 text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100 rounded transition flex items-center gap-1">
                              <Check className="w-3 h-3" /> Approve
                            </button>
                            <button onClick={() => handleDecline(req)} className="px-2.5 py-1.5 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded transition flex items-center gap-1">
                              <Ban className="w-3 h-3" /> Decline
                            </button>
                          </>
                        )}
                        {req.status === "APPROVED" && (
                          <button onClick={() => openAssign(req)} className="px-2.5 py-1.5 text-xs font-semibold text-black bg-yellow-400 hover:bg-yellow-500 rounded transition flex items-center gap-1">
                            <Truck className="w-3 h-3" /> Assign Vehicle &amp; Driver
                          </button>
                        )}
                        {req.status === "DECLINED" && req.declineReason && (
                          <span className="text-[11px] text-red-500 italic max-w-[160px] truncate" title={req.declineReason}>{req.declineReason}</span>
                        )}
                        {!["PENDING", "APPROVED"].includes(req.status) && !req.declineReason && <span className="text-xs text-gray-400">—</span>}
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
          <div className="text-sm text-gray-600">{filtered.length} requests total</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Previous</button>
            <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Next</button>
          </div>
        </div>
      )}

      {/* New Request Modal */}
      {showCreate && (
        <RequestFormModal
          title={createForm.priority === "EMERGENCY" ? "Emergency Transfer" : "New Transport Request"}
          form={createForm}
          residents={residents}
          onChange={setCreateForm}
          onSave={handleCreate}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Assignment Modal */}
      {assigning && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90dvh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
              <div>
                <h2 className="text-xl font-bold">Assign Vehicle &amp; Driver</h2>
                <p className="text-sm text-black/70">{assigning.residentName} → {assigning.destination}</p>
              </div>
              <button onClick={() => setAssigning(null)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              {/* Request summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                <DetailField icon={User} label="Resident" value={`${assigning.residentName} · Rm ${assigning.roomNumber}`} />
                <DetailField icon={ClipboardList} label="Type" value={(TYPE_META[assigning.type] || TYPE_META.OTHER).label} />
                <DetailField icon={Calendar} label="Requested" value={fmtDT(assigning.requestedDate)} />
                <DetailField icon={AlertTriangle} label="Priority" value={assigning.priority} />
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-600 flex-wrap">
                {assigning.wheelchairNeeded && <span className="flex items-center gap-1 text-blue-600 font-medium"><Accessibility className="w-3.5 h-3.5" /> Wheelchair needed</span>}
                {assigning.escortRequired && <span className="flex items-center gap-1 text-purple-600 font-medium"><UserCheck className="w-3.5 h-3.5" /> Escort required</span>}
                {assigning.returnRequired && <span className="flex items-center gap-1 text-green-600 font-medium"><Repeat className="w-3.5 h-3.5" /> Round trip</span>}
              </div>

              {/* Vehicle */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Vehicle (available only)</label>
                <select value={assignForm.vehicleId} onChange={e => setAssignForm(f => ({ ...f, vehicleId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                  <option value="">Select a vehicle…</option>
                  {availableVehicles.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {v.licensePlate} · {v.type.replace(/_/g, " ")} · cap {v.capacity}
                      {assigning.wheelchairNeeded && v.wheelchairCapacity === 0 ? " — ⚠ no wheelchair capacity" : ""}
                    </option>
                  ))}
                </select>
                {availableVehicles.length === 0 && (
                  <p className="text-xs text-red-500 mt-1">No vehicles are currently available.</p>
                )}
                {wheelchairMismatch && (
                  <div className="mt-2 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg px-3 py-2 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    This request needs wheelchair transport, but the selected vehicle has no wheelchair capacity.
                  </div>
                )}
              </div>

              {/* Driver */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Driver (active only)</label>
                <select value={assignForm.driverId} onChange={e => setAssignForm(f => ({ ...f, driverId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                  <option value="">Select a driver…</option>
                  {activeDrivers.map(d => <option key={d.id} value={d.id}>{d.name} · safety {d.safetyScore}</option>)}
                </select>
                {selectedDriver && driverLic && (
                  <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-yellow-500" /> License &amp; Certification Check
                    </p>
                    <div className="flex items-center gap-2 flex-wrap text-xs text-gray-700">
                      <span className="font-mono">{selectedDriver.licenseNumber}</span>
                      <span className="text-gray-400">·</span>
                      <span>Expires {selectedDriver.licenseExpiry ? new Date(selectedDriver.licenseExpiry).toLocaleDateString() : "—"}</span>
                      <span className={`px-2 py-0.5 rounded-full font-semibold ${driverLic.cls}`}>{driverLic.label}</span>
                    </div>
                    {selectedDriver.certifications && (
                      <div className="flex gap-1.5 flex-wrap">
                        {selectedDriver.certifications.split(",").map(c => c.trim()).filter(Boolean).map(c => (
                          <span key={c} className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-semibold">{c}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Escort */}
              {assigning.escortRequired && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Escort Name</label>
                    <input type="text" value={assignForm.escortName} onChange={e => setAssignForm(f => ({ ...f, escortName: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Escort Role</label>
                    <select value={assignForm.escortRole} onChange={e => setAssignForm(f => ({ ...f, escortRole: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                      <option value="NURSE">Nurse</option>
                      <option value="CAREGIVER">Caregiver</option>
                    </select>
                  </div>
                  <p className="sm:col-span-2 text-xs text-gray-500 -mt-2">Nurse / Caregiver if required</p>
                </div>
              )}

              {/* Schedule + billing */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Scheduled At</label>
                  <input type="datetime-local" value={assignForm.scheduledAt} onChange={e => setAssignForm(f => ({ ...f, scheduledAt: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Distance (km)</label>
                  <input type="number" min="0" step="0.1" value={assignForm.distanceKm} onChange={e => setAssignForm(f => ({ ...f, distanceKm: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" placeholder="optional" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Charge</label>
                  <div className="relative">
                    <DollarSign className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
                    <input type="number" min="0" step="0.01" value={assignForm.charge} onChange={e => setAssignForm(f => ({ ...f, charge: e.target.value }))}
                      className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                  </div>
                </div>
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setAssigning(null)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
              <button onClick={handleAssign} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm flex items-center gap-2">
                <Truck className="w-4 h-4" /> Schedule Trip
              </button>
            </div>
          </div>
        </div>
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

function DetailField({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="bg-gray-50 p-3 rounded border border-gray-200">
      <p className="text-xs text-gray-600 font-semibold flex items-center gap-1 mb-0.5"><Icon className="w-3 h-3" />{label}</p>
      <p className="text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function RequestFormModal({ title, form, residents, onChange, onSave, onCancel }: {
  title: string;
  form: RequestForm;
  residents: { id: string; name: string; roomNumber: string }[];
  onChange: (f: RequestForm) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (field: keyof RequestForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange({ ...form, [field]: e.target.value });
  const setBool = (field: keyof RequestForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...form, [field]: e.target.checked });
  const isEmergency = form.priority === "EMERGENCY";

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90dvh] overflow-y-auto">
        <div className={`sticky top-0 bg-gradient-to-r ${isEmergency ? "from-red-500 to-red-600 text-white" : "from-blue-500 to-indigo-600 text-black"} p-5 flex items-center justify-between z-10`}>
          <h2 className="text-xl font-bold flex items-center gap-2">{isEmergency && <Siren className="w-5 h-5" />}{title}</h2>
          <button onClick={onCancel} className={`p-2 rounded-lg transition ${isEmergency ? "hover:bg-white/20" : "hover:bg-yellow-600/20"}`}><X className="w-6 h-6" /></button>
        </div>
        <div className="p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Resident</label>
              <select value={form.residentId} onChange={set("residentId")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                <option value="">Select resident…</option>
                {residents.map(r => <option key={r.id} value={r.id}>{r.name} — Room {r.roomNumber}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Type</label>
              <select value={form.type} onChange={set("type")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                {TYPES.map(t => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Priority</label>
              <select value={form.priority} onChange={set("priority")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="EMERGENCY">Emergency</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Pickup Location</label>
              <input type="text" value={form.pickupLocation} onChange={set("pickupLocation")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" placeholder="e.g. Golden Hearth Facility" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Drop-off Location</label>
              <input type="text" value={form.dropoffLocation} onChange={set("dropoffLocation")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" placeholder="e.g. St. Luke's Medical Center" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Purpose</label>
              <input type="text" value={form.purpose} onChange={set("purpose")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" placeholder="e.g. Cardiology follow-up" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Requested Date &amp; Time</label>
              <input type="datetime-local" value={form.requestedDate} onChange={set("requestedDate")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
            <div className="sm:col-span-2 flex flex-wrap gap-3">
              <label className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-100 transition text-sm select-none">
                <input type="checkbox" checked={form.returnRequired} onChange={setBool("returnRequired")} className="rounded" />
                <Repeat className="w-4 h-4 text-green-500" /> Return trip required
              </label>
              <label className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-100 transition text-sm select-none">
                <input type="checkbox" checked={form.wheelchairNeeded} onChange={setBool("wheelchairNeeded")} className="rounded" />
                <Accessibility className="w-4 h-4 text-blue-500" /> Wheelchair needed
              </label>
              <label className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-100 transition text-sm select-none">
                <input type="checkbox" checked={form.escortRequired} onChange={setBool("escortRequired")} className="rounded" />
                <UserCheck className="w-4 h-4 text-purple-500" /> Escort required
              </label>
            </div>
            {form.escortRequired && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Escort Role</label>
                <select value={form.escortRole} onChange={set("escortRole")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                  <option value="NURSE">Nurse</option>
                  <option value="CAREGIVER">Caregiver</option>
                </select>
              </div>
            )}
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
              <textarea value={form.notes} onChange={set("notes")} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
            </div>
          </div>
        </div>
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
          <button onClick={onCancel} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
          <button onClick={onSave} className={`px-5 py-2 font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm ${isEmergency ? "bg-gradient-to-r from-red-500 to-red-600 text-white" : "bg-gradient-to-r from-blue-500 to-indigo-600 text-black"}`}>
            {isEmergency ? "Submit Emergency Transfer" : "Submit Request"}
          </button>
        </div>
      </div>
    </div>
  );
}
