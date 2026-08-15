"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bus, Search, X, RefreshCw, Siren, MapPin, ClipboardCheck, Navigation,
  CheckCircle2, Ban, Truck, User, Clock, Undo2, Flag, Radio, Receipt,
  DollarSign, UserCheck, Calendar, ChevronDown, ChevronUp, PlayCircle,
  type LucideIcon,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord } from "@/lib/api";
import { FACILITY_LAT, FACILITY_LNG } from "@/lib/facilityLocation";

/* ── Safe coercion helpers ── */
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : v == null ? d : String(v));
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const bool = (v: unknown): boolean => v === true;
const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/* ── Adapter ── */
function adaptTrip(row: Record<string, unknown>) {
  const resident = rec(row.resident);
  const vehicle = rec(row.vehicle);
  const driver = rec(row.driver);
  const name = resident ? `${str(resident.firstName)} ${str(resident.lastName)}`.trim() : "";
  return {
    id: str(row.id),
    requestId: str(row.requestId),
    residentId: str(row.residentId),
    residentName: name || "Unknown Resident",
    roomNumber: resident ? str(resident.roomNumber, "—") : "—",
    sponsorId: resident ? str(resident.sponsorId) : "",
    vehicleId: str(row.vehicleId),
    vehicleName: vehicle ? str(vehicle.name, "—") : "—",
    vehiclePlate: vehicle ? str(vehicle.licensePlate, "—") : "—",
    vehicleStatus: vehicle ? str(vehicle.status) : "",
    vehicleOdometer: vehicle ? num(vehicle.odometer) : 0,
    driverId: str(row.driverId),
    driverName: driver ? str(driver.name, "—") : "—",
    driverTripHours: driver ? num(driver.tripHours) : 0,
    escortName: str(row.escortName),
    escortRole: str(row.escortRole),
    status: str(row.status, "SCHEDULED"),
    destination: str(row.destination, "—"),
    origin: str(row.origin, "Home"),
    pickupLocation: str(row.pickupLocation) || str(row.origin, "Facility"),
    dropoffLocation: str(row.dropoffLocation) || str(row.destination, "—"),
    scheduledAt: str(row.scheduledAt),
    departedAt: str(row.departedAt),
    arrivedAt: str(row.arrivedAt),
    returnDepartedAt: str(row.returnDepartedAt),
    completedAt: str(row.completedAt),
    distanceKm: num(row.distanceKm),
    currentLat: row.currentLat == null ? null : num(row.currentLat),
    currentLng: row.currentLng == null ? null : num(row.currentLng),
    lastPingAt: str(row.lastPingAt),
    inspectionDone: bool(row.inspectionDone),
    inspectionChecklist: str(row.inspectionChecklist),
    familyNotified: bool(row.familyNotified),
    billed: bool(row.billed),
    charge: row.charge == null ? null : num(row.charge),
    notes: str(row.notes),
    raw: row,
  };
}
type Trip = ReturnType<typeof adaptTrip>;

/* ── Constants ── */
const STEPS = ["SCHEDULED", "INSPECTION", "EN_ROUTE", "ARRIVED", "RETURNING", "COMPLETED"];
const STEP_LABELS: Record<string, string> = {
  SCHEDULED: "Scheduled", INSPECTION: "Inspection", EN_ROUTE: "En Route",
  ARRIVED: "Arrived", RETURNING: "Returning", COMPLETED: "Completed",
};

const STATUS_PILL: Record<string, string> = {
  SCHEDULED: "bg-blue-50 text-blue-700 border-blue-200",
  INSPECTION: "bg-amber-50 text-amber-700 border-amber-200",
  EN_ROUTE: "bg-yellow-100 text-yellow-800 border-yellow-300",
  ARRIVED: "bg-purple-50 text-purple-700 border-purple-200",
  RETURNING: "bg-cyan-50 text-cyan-700 border-cyan-200",
  COMPLETED: "bg-green-50 text-green-700 border-green-200",
  CANCELLED: "bg-gray-100 text-gray-500 border-gray-200",
};
const STATUS_CHIPS = ["all", "SCHEDULED", "INSPECTION", "EN_ROUTE", "ARRIVED", "RETURNING", "COMPLETED", "CANCELLED"];
const ACTIVE_STATUSES = ["SCHEDULED", "INSPECTION", "EN_ROUTE", "ARRIVED", "RETURNING"];

const INSPECTION_ITEMS = [
  "Tires & wheels", "Brakes", "Lights & signals", "Fuel level",
  "Wheelchair lift & securement", "Seatbelts & restraints",
  "First-aid kit & O2", "Interior sanitized",
];

const BASE_LAT = FACILITY_LAT;
const BASE_LNG = FACILITY_LNG;
const ASSUMED_TRIP_MS = 30 * 60 * 1000; // assumed leg duration for progress/ETA

/* ── Time helpers ── */
const fmtDT = (iso: string) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

function timeAgo(iso: string): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function legProgress(trip: Trip): number {
  const anchor = trip.status === "RETURNING" ? trip.returnDepartedAt : trip.departedAt;
  if (!anchor) return 0.05;
  const frac = (Date.now() - new Date(anchor).getTime()) / ASSUMED_TRIP_MS;
  return Math.min(0.95, Math.max(0.05, frac));
}

/** Point along the SVG route's cubic bezier at parameter t (0..1). */
function bezierPoint(t: number): { x: number; y: number } {
  const p0 = { x: 24, y: 96 }, p1 = { x: 130, y: 18 }, p2 = { x: 270, y: 18 }, p3 = { x: 376, y: 96 };
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function isEmergencyTrip(trip: Trip): boolean {
  if ((trip.charge ?? 0) >= 250) return true;
  return /emergency/i.test(trip.notes) || /emergency/i.test(trip.destination);
}

export default function FleetTrips() {
  const { data: tripRows, loading, error, refetch } = useLiveQuery<Record<string, unknown>>(
    "trips", { query: "include=resident,vehicle,driver&take=300", tables: ["Trip", "Vehicle", "Driver", "Resident"], pollMs: 10000 }
  );
  const trips = useMemo<Trip[]>(() => tripRows.map(adaptTrip), [tripRows]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [inspecting, setInspecting] = useState<Trip | null>(null);
  const [checks, setChecks] = useState<boolean[]>(INSPECTION_ITEMS.map(() => false));
  // Cancel-a-trip flow: capture a required reason in a designed modal
  // (replaces the bare Swal text prompt).
  const [cancellingTrip, setCancellingTrip] = useState<Trip | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancellingBusy, setCancellingBusy] = useState(false);
  const [expandedGps, setExpandedGps] = useState<Record<string, boolean>>({});
  const [, setTick] = useState(0); // re-render tick for GPS progress/time-ago
  const perPage = 12;

  const pingBusy = useRef(false);
  const tripsRef = useRef<Trip[]>([]);
  // eslint-disable-next-line react-hooks/refs
  tripsRef.current = trips;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rank: Record<string, number> = { EN_ROUTE: 0, RETURNING: 1, ARRIVED: 2, INSPECTION: 3, SCHEDULED: 4, COMPLETED: 5, CANCELLED: 6 };
    return trips
      .filter(t => {
        if (statusFilter !== "all" && t.status !== statusFilter) return false;
        if (q && !t.residentName.toLowerCase().includes(q) && !t.destination.toLowerCase().includes(q)
          && !t.driverName.toLowerCase().includes(q) && !t.vehicleName.toLowerCase().includes(q)
          && !t.vehiclePlate.toLowerCase().includes(q)) return false;
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
      scheduled: trips.filter(t => t.status === "SCHEDULED" || t.status === "INSPECTION").length,
      inTransit: trips.filter(t => ["EN_ROUTE", "ARRIVED", "RETURNING"].includes(t.status)).length,
      completedToday: trips.filter(t => t.status === "COMPLETED" && t.completedAt && new Date(t.completedAt).toDateString() === today).length,
      billed: trips.filter(t => t.billed).length,
      unbilled: trips.filter(t => t.status === "COMPLETED" && !t.billed).length,
      cancelled: trips.filter(t => t.status === "CANCELLED").length,
    };
  }, [trips]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const start = (page - 1) * perPage;
  const paginated = filtered.slice(start, start + perPage);

  const activeGpsIds = useMemo(
    () => trips.filter(t => t.status === "EN_ROUTE" || t.status === "RETURNING").map(t => t.id).join(","),
    [trips]
  );

  /* ── GPS ping helpers ── */
  const pingTrip = async (trip: Trip) => {
    const now = new Date().toISOString();
    await updateRecord("trips", trip.id, {
      // eslint-disable-next-line react-hooks/purity
      currentLat: (trip.currentLat ?? BASE_LAT) + (Math.random() - 0.4) * 0.004,
      // eslint-disable-next-line react-hooks/purity
      currentLng: (trip.currentLng ?? BASE_LNG) + (Math.random() - 0.3) * 0.004,
      lastPingAt: now,
    });
  };

  const handleManualPing = async (trip: Trip) => {
    if (pingBusy.current) return;
    pingBusy.current = true;
    try {
      await pingTrip(trip);
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Ping Failed", text: err instanceof Error ? err.message : "Could not send GPS ping.", icon: "error" });
    } finally {
      pingBusy.current = false;
    }
  };

  // Auto-ping every ~8s while EN_ROUTE/RETURNING trips exist and the tab is visible.
  useEffect(() => {
    if (!activeGpsIds) return;
    const interval = setInterval(async () => {
      setTick(t => t + 1); // keep dot/time-ago moving between refetches
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (pingBusy.current) return;
      pingBusy.current = true;
      try {
        const active = tripsRef.current.filter(t => t.status === "EN_ROUTE" || t.status === "RETURNING");
        for (const t of active) await pingTrip(t);
        if (active.length) await refetch();
      } catch {
        /* ignore transient ping errors */
      } finally {
        pingBusy.current = false;
      }
    }, 8000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGpsIds, refetch]);

  /* ── Workflow handlers ── */
  const openInspection = (trip: Trip) => {
    let prefill = INSPECTION_ITEMS.map(() => false);
    try {
      const saved = JSON.parse(trip.inspectionChecklist || "[]") as { item?: string; ok?: boolean }[];
      if (Array.isArray(saved)) {
        prefill = INSPECTION_ITEMS.map(item => saved.find(s => s?.item === item)?.ok === true);
      }
    } catch { /* fresh checklist */ }
    setChecks(prefill);
    setInspecting(trip);
  };

  const handleCompleteInspection = async () => {
    if (!inspecting || !checks.every(Boolean)) return;
    try {
      await updateRecord("trips", inspecting.id, {
        inspectionChecklist: JSON.stringify(INSPECTION_ITEMS.map((item, i) => ({ item, ok: checks[i] }))),
        inspectionDone: true,
        status: "INSPECTION",
      });
      await refetch();
      setInspecting(null);
      Swal.fire({ title: "Inspection Complete", text: "Vehicle passed pre-trip inspection — ready to depart.", icon: "success", timer: 1800, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Save Failed", text: err instanceof Error ? err.message : "Could not save inspection.", icon: "error" });
    }
  };

  const handleDepart = async (trip: Trip) => {
    const confirmed = await Swal.fire({
      title: "Depart Now?",
      text: `Start the trip to ${trip.destination}? The family will be notified and live tracking begins.`,
      icon: "question", showCancelButton: true,
      confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280", confirmButtonText: "Depart",
    });
    if (!confirmed.isConfirmed) return;
    try {
      const now = new Date().toISOString();
      await updateRecord("trips", trip.id, {
        status: "EN_ROUTE", departedAt: now, familyNotified: true,
        currentLat: BASE_LAT, currentLng: BASE_LNG, lastPingAt: now,
      });
      if (trip.vehicleId) await updateRecord("vehicles", trip.vehicleId, { status: "ON_TRIP" });
      if (trip.sponsorId) {
        await createRecord("notifications", {
          userId: trip.sponsorId,
          type: "TRANSPORT_UPDATE",
          title: `Trip Departed: ${trip.residentName}`,
          message: `The vehicle has departed for ${trip.destination}. Live tracking is active.`,
        });
      }
      await refetch();
      Swal.fire({ title: "Departed", text: "Trip in progress — family notified.", icon: "success", timer: 1800, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Depart Failed", text: err instanceof Error ? err.message : "Could not start the trip.", icon: "error" });
    }
  };

  const handleArrive = async (trip: Trip) => {
    try {
      await updateRecord("trips", trip.id, { status: "ARRIVED", arrivedAt: new Date().toISOString() });
      await refetch();
      Swal.fire({ title: "Arrival Confirmed", text: `Arrived at ${trip.destination}.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Check-In Failed", text: err instanceof Error ? err.message : "Could not record arrival.", icon: "error" });
    }
  };

  const handleStartReturn = async (trip: Trip) => {
    try {
      await updateRecord("trips", trip.id, { status: "RETURNING", returnDepartedAt: new Date().toISOString() });
      await refetch();
      Swal.fire({ title: "Return Trip Started", text: `Heading back to ${trip.origin}.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Update Failed", text: err instanceof Error ? err.message : "Could not start return trip.", icon: "error" });
    }
  };

  const handleComplete = async (trip: Trip) => {
    const confirmed = await Swal.fire({
      title: "Confirm Drop-Off?",
      text: `Complete this trip for ${trip.residentName}? The trip log will be recorded and a billable charge posted.`,
      icon: "question", showCancelButton: true,
      confirmButtonColor: "#22c55e", cancelButtonColor: "#6b7280", confirmButtonText: "Confirm Drop-Off",
    });
    if (!confirmed.isConfirmed) return;
    try {
      const now = new Date();
      const nowIso = now.toISOString();
      await updateRecord("trips", trip.id, { status: "COMPLETED", completedAt: nowIso, billed: true });
      if (trip.vehicleId) {
        await updateRecord("vehicles", trip.vehicleId, {
          status: "AVAILABLE",
          odometer: trip.vehicleOdometer + Math.round(trip.distanceKm || 0),
        });
      }
      if (trip.driverId) {
        const departed = trip.departedAt ? new Date(trip.departedAt).getTime() : now.getTime();
        const hours = Math.max(0, Math.round(((now.getTime() - departed) / 3600000) * 10) / 10);
        await updateRecord("drivers", trip.driverId, {
          tripHours: Math.round((trip.driverTripHours + hours) * 10) / 10,
        });
      }
      if (trip.requestId) await updateRecord("transport-requests", trip.requestId, { status: "COMPLETED" });
      await createRecord("service-charges", {
        residentId: trip.residentId,
        description: `Transport — ${trip.destination}`,
        amount: trip.charge ?? 50,
        serviceDate: nowIso,
        category: "Transport",
      });
      await refetch();
      Swal.fire({ title: "Trip Completed", text: "Trip log recorded — billable charge posted to invoice.", icon: "success", timer: 2200, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Completion Failed", text: err instanceof Error ? err.message : "Could not complete the trip.", icon: "error" });
    }
  };

  const handleCancel = (trip: Trip) => {
    setCancelReason("");
    setCancellingTrip(trip);
  };
  const submitCancel = async () => {
    if (!cancellingTrip) return;
    const reason = cancelReason.trim();
    if (!reason) return;
    setCancellingBusy(true);
    try {
      await updateRecord("trips", cancellingTrip.id, {
        status: "CANCELLED",
        notes: cancellingTrip.notes ? `${cancellingTrip.notes} | Cancelled: ${reason}` : `Cancelled: ${reason}`,
      });
      if (cancellingTrip.vehicleId && cancellingTrip.vehicleStatus === "ON_TRIP") {
        await updateRecord("vehicles", cancellingTrip.vehicleId, { status: "AVAILABLE" });
      }
      await refetch();
      setCancellingTrip(null);
      Swal.fire({ title: "Trip Cancelled", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Cancel Failed", text: err instanceof Error ? err.message : "Could not cancel the trip.", icon: "error" });
    } finally {
      setCancellingBusy(false);
    }
  };

  const allChecked = checks.every(Boolean);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Trip Board
          </h1>
          <p className="text-gray-600">Pre-trip inspection · live GPS tracking · drop-off confirmation</p>
        </div>
        <RefreshButton onRefresh={() => void refetch()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium" />
      </div>

      {/* Stat Boxes */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatBox label="Scheduled" value={String(stats.scheduled)} icon={Calendar} color="blue" />
        <StatBox label="In Transit" value={String(stats.inTransit)} icon={Navigation} color="amber" />
        <StatBox label="Completed Today" value={String(stats.completedToday)} icon={CheckCircle2} color="green" />
        <StatBox label="Billed" value={String(stats.billed)} icon={Receipt} color="purple" />
        <StatBox label="Unbilled Completed" value={String(stats.unbilled)} icon={DollarSign} color="red" />
        <StatBox label="Cancelled" value={String(stats.cancelled)} icon={Ban} color="red" />
      </div>

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
              {s === "all" ? "All" : STEP_LABELS[s] || s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search resident, destination, driver, vehicle…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {loading && trips.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading trips...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No trips match your filters.</div>
      ) : (
        /* ── Trip Cards ── */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {paginated.map(trip => {
            const emergency = isEmergencyTrip(trip);
            const currentIdx = STEPS.indexOf(trip.status);
            const gpsActive = trip.status === "EN_ROUTE" || trip.status === "RETURNING";
            const gpsOpen = !!expandedGps[trip.id];
            const progress = legProgress(trip);
            const dotT = trip.status === "RETURNING" ? 1 - progress : progress;
            const dot = bezierPoint(dotT);
            const etaMin = Math.max(1, Math.round(((1 - progress) * ASSUMED_TRIP_MS) / 60000));
            return (
              <div key={trip.id} className={`bg-white rounded-lg border overflow-hidden hover:shadow-md transition ${emergency ? "border-l-4 border-l-red-500 border-red-200" : "border-gray-200"}`}>
                <div className="p-4 space-y-3">
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {emergency && <Siren className="w-5 h-5 text-red-500 flex-shrink-0 animate-pulse" />}
                      <div className="min-w-0">
                        <h3 className="font-semibold text-gray-900 text-sm truncate">{trip.residentName}</h3>
                        <p className="text-xs text-gray-500">Room {trip.roomNumber}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {trip.billed && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 text-[10px] font-semibold">
                          <Receipt className="w-3 h-3" /> Billed
                        </span>
                      )}
                      <span className={`inline-block px-2 py-0.5 rounded-full border text-xs font-semibold ${STATUS_PILL[trip.status] || STATUS_PILL.SCHEDULED}`}>
                        {STEP_LABELS[trip.status] || trip.status}
                      </span>
                    </div>
                  </div>

                  {/* Route line — pickup → drop-off */}
                  <div className="flex items-center gap-1.5 text-sm text-gray-700">
                    <MapPin className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                    <span className="truncate" title={trip.pickupLocation}>{trip.pickupLocation}</span>
                    <span className="text-gray-400">→</span>
                    <MapPin className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                    <span className="font-medium truncate" title={trip.dropoffLocation}>{trip.dropoffLocation}</span>
                  </div>

                  {/* Crew & schedule */}
                  <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-gray-600">
                    <span className="flex items-center gap-1"><Truck className="w-3.5 h-3.5 text-gray-400" /> {trip.vehicleName} · {trip.vehiclePlate}</span>
                    <span className="flex items-center gap-1"><User className="w-3.5 h-3.5 text-gray-400" /> {trip.driverName}</span>
                    {trip.escortName && (
                      <span className="flex items-center gap-1 text-purple-600"><UserCheck className="w-3.5 h-3.5" /> {trip.escortName}{trip.escortRole ? ` (${trip.escortRole})` : ""}</span>
                    )}
                    <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-gray-400" /> {fmtDT(trip.scheduledAt)}</span>
                    {trip.charge != null && (
                      <span className="flex items-center gap-1 font-semibold text-gray-800"><DollarSign className="w-3.5 h-3.5 text-gray-400" /> {trip.charge.toFixed(2)}</span>
                    )}
                  </div>

                  {/* Stepper */}
                  {trip.status !== "CANCELLED" ? (
                    <div className="flex items-center gap-0">
                      {STEPS.map((step, i) => (
                        <div key={step} className="flex items-center flex-1 last:flex-none">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className={`w-2.5 h-2.5 rounded-full ${
                              i < currentIdx ? "bg-green-500"
                              : i === currentIdx ? "bg-yellow-400 ring-2 ring-yellow-200 animate-pulse"
                              : "bg-gray-200"
                            }`} />
                            <span className={`text-[9px] leading-none ${i === currentIdx ? "text-yellow-700 font-semibold" : "text-gray-400"} hidden sm:block`}>{STEP_LABELS[step]}</span>
                          </div>
                          {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 mx-0.5 -mt-2.5 sm:-mt-2.5 ${i < currentIdx ? "bg-green-400" : "bg-gray-200"}`} style={{ marginTop: "-10px" }} />}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1.5">
                      <Ban className="w-3.5 h-3.5" /> Trip cancelled{trip.notes ? ` — ${trip.notes.split("Cancelled:").pop()?.trim()}` : ""}
                    </div>
                  )}

                  {/* Live GPS panel */}
                  {gpsActive && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
                      <button onClick={() => setExpandedGps(m => ({ ...m, [trip.id]: !gpsOpen }))}
                        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 transition">
                        <span className="flex items-center gap-1.5">
                          <Radio className="w-3.5 h-3.5 text-green-500 animate-pulse" /> Live GPS Tracking
                          <span className="text-gray-400 font-normal">· ping {timeAgo(trip.lastPingAt)}</span>
                        </span>
                        {gpsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      {gpsOpen && (
                        <div className="px-3 pb-3 space-y-2">
                          <div className="bg-white rounded-lg border border-gray-200 p-2">
                            <svg viewBox="0 0 400 120" className="w-full h-auto" role="img" aria-label="Live trip route">
                              <rect x="0" y="0" width="400" height="120" rx="10" fill="#f8fafc" />
                              <path d="M 24 96 C 130 18, 270 18, 376 96" fill="none" stroke="#cbd5e1" strokeWidth="3" strokeDasharray="6 5" strokeLinecap="round" />
                              {/* Origin marker */}
                              <circle cx="24" cy="96" r="6" fill="#22c55e" stroke="#fff" strokeWidth="2" />
                              <text x="24" y="114" textAnchor="middle" fontSize="9" fill="#64748b">{trip.origin.length > 22 ? "Facility" : trip.origin}</text>
                              {/* Destination marker */}
                              <circle cx="376" cy="96" r="6" fill="#ef4444" stroke="#fff" strokeWidth="2" />
                              <text x="376" y="114" textAnchor="end" fontSize="9" fill="#64748b">{trip.destination.slice(0, 26)}</text>
                              {/* Vehicle dot */}
                              <circle cx={dot.x} cy={dot.y} r="9" fill="#facc15" opacity="0.3">
                                <animate attributeName="r" values="9;13;9" dur="2s" repeatCount="indefinite" />
                              </circle>
                              <circle cx={dot.x} cy={dot.y} r="5.5" fill="#facc15" stroke="#a16207" strokeWidth="1.5" />
                            </svg>
                          </div>
                          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-gray-600">
                            <span className="font-mono">
                              {trip.currentLat != null && trip.currentLng != null
                                ? `${trip.currentLat.toFixed(5)}, ${trip.currentLng.toFixed(5)}`
                                : "awaiting first ping…"}
                            </span>
                            <span>Last ping: {timeAgo(trip.lastPingAt)}</span>
                            <span>ETA: ~{etaMin} min {trip.status === "RETURNING" ? "to facility" : "to destination"}</span>
                          </div>
                          <button onClick={() => handleManualPing(trip)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 transition">
                            <Radio className="w-3.5 h-3.5 text-green-500" /> Simulate GPS Ping
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Workflow actions */}
                  <div className="flex gap-1.5 flex-wrap pt-1">
                    {trip.status === "SCHEDULED" && (
                      <button onClick={() => openInspection(trip)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded transition">
                        <ClipboardCheck className="w-3.5 h-3.5" /> Pre-Trip Inspection
                      </button>
                    )}
                    {trip.status === "INSPECTION" && (
                      <button onClick={() => handleDepart(trip)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-black bg-yellow-400 hover:bg-yellow-500 rounded transition">
                        <PlayCircle className="w-3.5 h-3.5" /> Depart
                      </button>
                    )}
                    {trip.status === "EN_ROUTE" && (
                      <button onClick={() => handleArrive(trip)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 rounded transition">
                        <Flag className="w-3.5 h-3.5" /> Arrival Check-In
                      </button>
                    )}
                    {trip.status === "ARRIVED" && (
                      <button onClick={() => handleStartReturn(trip)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-cyan-700 bg-cyan-50 hover:bg-cyan-100 rounded transition">
                        <Undo2 className="w-3.5 h-3.5" /> Start Return Trip
                      </button>
                    )}
                    {(trip.status === "ARRIVED" || trip.status === "RETURNING") && (
                      <button onClick={() => handleComplete(trip)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-green-500 hover:bg-green-600 rounded transition">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Confirm Drop-Off
                      </button>
                    )}
                    {ACTIVE_STATUSES.includes(trip.status) && (
                      <button onClick={() => handleCancel(trip)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded transition ml-auto">
                        <Ban className="w-3.5 h-3.5" /> Cancel Trip
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {filtered.length > perPage && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm text-gray-600">{filtered.length} trips total</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Previous</button>
            <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Next</button>
          </div>
        </div>
      )}

      {/* Pre-Trip Inspection Modal */}
      {inspecting && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
              <div>
                <h2 className="text-xl font-bold">Pre-Trip Inspection</h2>
                <p className="text-sm text-black/70">{inspecting.vehicleName} · {inspecting.vehiclePlate}</p>
              </div>
              <button onClick={() => setInspecting(null)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <DetailField icon={User} label="Resident" value={`${inspecting.residentName} · Rm ${inspecting.roomNumber}`} />
                <DetailField icon={Truck} label="Vehicle" value={`${inspecting.vehicleName} · ${inspecting.vehiclePlate}`} />
                <DetailField icon={MapPin} label="Destination" value={inspecting.destination} />
                <DetailField icon={Calendar} label="Scheduled" value={fmtDT(inspecting.scheduledAt)} />
              </div>
              <div className="space-y-2">
                {INSPECTION_ITEMS.map((item, i) => (
                  <label key={item} className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition select-none ${
                    checks[i] ? "bg-green-50 border-green-300" : "bg-gray-50 border-gray-200 hover:bg-gray-100"
                  }`}>
                    <span className={`text-sm font-medium ${checks[i] ? "text-green-800" : "text-gray-700"}`}>{item}</span>
                    <input
                      type="checkbox"
                      checked={checks[i]}
                      onChange={e => setChecks(c => c.map((v, idx) => (idx === i ? e.target.checked : v)))}
                      className="w-4 h-4 rounded accent-green-500"
                    />
                  </label>
                ))}
              </div>
              {!allChecked && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <ClipboardCheck className="w-3.5 h-3.5" /> All items must pass before the vehicle can depart.
                </p>
              )}
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setInspecting(null)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
              <button onClick={handleCompleteInspection} disabled={!allChecked}
                className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Complete Inspection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Trip Modal — captures a required reason */}
      {cancellingTrip && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setCancellingTrip(null); }}>
          <div className="bg-white w-full max-w-lg max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden rounded-t-2xl sm:rounded-xl shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-gradient-to-r from-red-500 to-red-600 px-5 py-4 text-white">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold"><Ban className="w-5 h-5" /> Cancel Trip</h2>
                <p className="text-sm text-white/80">{cancellingTrip.residentName} · Rm {cancellingTrip.roomNumber} → {cancellingTrip.destination}</p>
              </div>
              <button onClick={() => setCancellingTrip(null)} className="rounded-lg p-1.5 transition hover:bg-white/20"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-gray-700">Cancellation reason <span className="text-red-500">*</span></label>
                <textarea autoFocus rows={4} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Resident unwell, appointment moved" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-red-400 outline-none" />
                <p className="mt-1.5 text-[11px] text-gray-400">The reason is appended to the trip notes.</p>
              </div>
            </div>
            <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-4">
              <button onClick={() => setCancellingTrip(null)} disabled={cancellingBusy} className="rounded-lg px-5 py-2 text-sm text-gray-700 transition hover:bg-gray-100 disabled:opacity-50">Keep Trip</button>
              <button onClick={() => void submitCancel()} disabled={cancellingBusy || !cancelReason.trim()} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50">{cancellingBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />} {cancellingBusy ? "Cancelling…" : "Cancel Trip"}</button>
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
