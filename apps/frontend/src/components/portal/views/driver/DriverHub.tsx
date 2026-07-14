"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, Route, ClipboardCheck, Fuel, Search, X, RefreshCw, Eye,
  ChevronLeft, ChevronRight, Car, Navigation, MapPin, Truck, CheckCircle2,
  AlertTriangle, ShieldCheck, Clock, Star, UserCheck, RotateCcw, Phone,
  Siren, Package, Wrench, Gauge, Zap, CircleDot, History, Loader2,
  Plus, UserRound, ArrowLeftRight, Maximize2,
  type LucideIcon,
} from "lucide-react";
import Swal from "sweetalert2";
import dynamic from "next/dynamic";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
import type { MapPoint } from "@/components/NavigationMap";

const NavigationMap = dynamic(() => import("@/components/NavigationMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[160px] flex items-center justify-center bg-gray-100 rounded-lg text-sm text-gray-500">
      Loading map…
    </div>
  ),
});

/* ── Helpers ── */
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : v == null ? d : String(v));
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const bool = (v: unknown): boolean => v === true;
const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const fmtDT = (iso: string) => iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
const fmtCurrency = (n: number) => `₱${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/* ── Tab config ── */
const TABS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "trips", label: "Trip Board", icon: Route },
  { key: "checklist", label: "Checklist", icon: ClipboardCheck },
  { key: "fuel", label: "Fuel", icon: Fuel },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/* ── Trip adapter ── */
type Row = Record<string, unknown>;

function adaptTrip(row: Row) {
  const resident = rec(row.resident);
  const vehicle = rec(row.vehicle);
  const driver = rec(row.driver);
  const name = resident ? `${str(resident.firstName)} ${str(resident.lastName)}`.trim() : "";
  return {
    id: str(row.id), requestId: str(row.requestId), residentId: str(row.residentId),
    residentName: name || "Unknown Resident",
    roomNumber: resident ? str(resident.roomNumber, "—") : "—",
    vehicleId: str(row.vehicleId),
    vehicleName: vehicle ? str(vehicle.name, "—") : "—",
    vehiclePlate: vehicle ? str(vehicle.licensePlate, "—") : "—",
    driverId: str(row.driverId),
    driverName: driver ? str(driver.name, "—") : "—",
    escortName: str(row.escortName), escortRole: str(row.escortRole),
    status: str(row.status, "SCHEDULED"),
    destination: str(row.destination, "—"),
    origin: str(row.origin, "Home"),
    pickupLocation: str(row.pickupLocation) || str(row.origin, "Facility"),
    dropoffLocation: str(row.dropoffLocation) || str(row.destination, "—"),
    scheduledAt: str(row.scheduledAt), departedAt: str(row.departedAt),
    arrivedAt: str(row.arrivedAt), returnDepartedAt: str(row.returnDepartedAt),
    completedAt: str(row.completedAt),
    currentLat: num(row.currentLat), currentLng: num(row.currentLng),
    distanceKm: num(row.distanceKm),
    inspectionDone: bool(row.inspectionDone),
    inspectionChecklist: str(row.inspectionChecklist),
    notes: str(row.notes), raw: row,
  };
}
type Trip = ReturnType<typeof adaptTrip>;

/* ── Fuel adapter ── */
function adaptFuelLog(row: Row) {
  const vehicle = rec(row.vehicle);
  return {
    id: str(row.id), vehicleId: str(row.vehicleId),
    vehicleName: vehicle ? str(vehicle.name, "—") : "—",
    vehiclePlate: vehicle ? str(vehicle.licensePlate, "—") : "—",
    driverId: str(row.driverId), logDate: str(row.logDate),
    odometer: num(row.odometer), liters: num(row.liters),
    cost: num(row.cost), fuelType: str(row.fuelType, "Diesel"),
    notes: str(row.notes),
  };
}
type FuelLog = ReturnType<typeof adaptFuelLog>;

/* ── Constants ── */
const INSPECTION_ITEMS = [
  "Tires & wheels", "Brakes", "Lights & signals", "Fuel level",
  "Wheelchair lift & securement", "Seatbelts & restraints",
  "First-aid kit & O2", "Interior sanitized",
];

const STATUS_PILL: Record<string, string> = {
  SCHEDULED: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  INSPECTION: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  EN_ROUTE: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  ARRIVED: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  RETURNING: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  COMPLETED: "bg-green-500/10 text-green-400 border-green-500/20",
  CANCELLED: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

const STEP_LABELS: Record<string, string> = {
  SCHEDULED: "Scheduled", INSPECTION: "Inspection", EN_ROUTE: "En Route",
  ARRIVED: "Arrived", RETURNING: "Returning", COMPLETED: "Completed",
};

const TRIP_STEPS = ["SCHEDULED", "INSPECTION", "EN_ROUTE", "ARRIVED", "RETURNING", "COMPLETED"];
const TRIP_STATUS_CHIPS = ["all", ...TRIP_STEPS, "CANCELLED"];

const FACILITY_LAT = Number(process.env.NEXT_PUBLIC_FACILITY_LAT) || 14.5547;
const FACILITY_LNG = Number(process.env.NEXT_PUBLIC_FACILITY_LNG) || 121.0244;

function computeTripHours(trip: Trip): number {
  if (!trip.departedAt || !trip.completedAt) return 0;
  const start = new Date(trip.departedAt).getTime();
  const end = new Date(trip.completedAt).getTime();
  if (isNaN(start) || isNaN(end) || end <= start) return 0;
  return Math.round(((end - start) / 3600000) * 10) / 10;
}

/* ══════════════════════════════════════════════════════════════════════════════ */
/*                            MAIN HUB COMPONENT                                */
/* ══════════════════════════════════════════════════════════════════════════════ */

interface DriverHubProps {
  initialTab?: TabKey;
}

// Per-module page header — each Driver sidebar route renders one module only
// (no in-page tab bar), so the header reflects the active module.
const HEADERS: Record<TabKey, { title: string; subtitle: string }> = {
  dashboard: { title: "Driver Dashboard", subtitle: "Active trip, next target & status controller" },
  trips: { title: "Trip Board", subtitle: "Your assigned trips — pickup → drop-off & navigation" },
  checklist: { title: "Inspection Checklist", subtitle: "Pre-trip 8-point vehicle safety check" },
  fuel: { title: "Fuel & Odometer", subtitle: "Refuel logs & vehicle mileage updates" },
};

export default function DriverHub({ initialTab = "dashboard" }: DriverHubProps) {
  const activeTab = initialTab;
  const [viewRow, setViewRow] = useState<Record<string, unknown> | null>(null);
  const header = HEADERS[activeTab];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent">
            {header.title}
          </h1>
          <p className="text-gray-600 text-sm mt-1">{header.subtitle}</p>
        </div>
      </div>

      {/* Module content (single module per route — sidebar handles navigation) */}
      {activeTab === "dashboard" && <DashboardTab />}
      {activeTab === "trips" && <TripsTab onView={setViewRow} />}
      {activeTab === "checklist" && <ChecklistTab />}
      {activeTab === "fuel" && <FuelTab onView={setViewRow} />}

      {/* View Modal */}
      {viewRow && <ViewModal row={viewRow} onClose={() => setViewRow(null)} />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════ */
/*                          DASHBOARD TAB                                        */
/* ══════════════════════════════════════════════════════════════════════════════ */

function DashboardTab() {
  const { data: driverRows } = useLiveQuery<Row>("drivers", { query: "take=10", tables: ["Driver"] });
  const { data: tripRows } = useLiveQuery<Row>("trips", {
    query: "include=resident,vehicle,driver&orderBy=scheduledAt:desc&take=300",
    tables: ["Trip", "Vehicle", "Driver", "Resident"],
  });
  const { data: vehicleRows } = useLiveQuery<Row>("vehicles", { query: "take=50", tables: ["Vehicle"] });
  const { data: incidentRows } = useLiveQuery<Row>("incidents", { query: "orderBy=createdAt:desc&take=20", tables: ["Incident"] });
  const { data: transportRows } = useLiveQuery<Row>("transport-requests", { query: "orderBy=requestedAt:desc&take=20", tables: ["TransportRequest"] });

  const [currentUser, setCurrentUser] = useState<{ id: string; email: string; name: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/session").then(r => r.json()).then(data => {
      if (data.authenticated && data.userId)
        fetch(`/api/db/users/${data.userId}`).then(r => r.json()).then(r => { if (r.success && r.data) setCurrentUser(r.data); }).catch(() => {});
    }).catch(() => {});
  }, []);

  const activeDriver = useMemo(() => {
    const resolve = (row: Row) => ({
      id: str(row.id), name: str(row.name), phone: str(row.phone), email: str(row.email),
      safetyScore: num(row.safetyScore), tripHours: num(row.tripHours),
      licenseNumber: str(row.licenseNumber), certifications: str(row.certifications),
      isActive: bool(row.isActive),
    });
    if (currentUser?.email) { const r = driverRows.find(d => str(d.email).toLowerCase() === currentUser.email.toLowerCase()); if (r) return resolve(r); }
    const r = driverRows.find(d => bool(d.isActive)) ?? driverRows[0];
    return r ? resolve(r) : null;
  }, [driverRows, currentUser]);

  const driverTrips = useMemo<Trip[]>(() => {
    if (!activeDriver) return [];
    return tripRows.map(adaptTrip).filter(t => t.driverId === activeDriver.id);
  }, [tripRows, activeDriver?.id]);

  const activeTrip = useMemo<Trip | null>(() =>
    driverTrips.find(t => t.status !== "COMPLETED" && t.status !== "CANCELLED") || null, [driverTrips]);

  const assignedVehicle = useMemo(() =>
    activeTrip?.vehicleId ? vehicleRows.find(v => str(v.id) === activeTrip.vehicleId) || null : null,
    [activeTrip, vehicleRows]);

  const shiftStats = useMemo(() => {
    const total = driverTrips.length;
    const completed = driverTrips.filter(t => t.status === "COMPLETED").length;
    const todayHours = driverTrips.filter(t => t.status === "COMPLETED").reduce((s, t) => s + computeTripHours(t), 0);
    return { total, completed, pending: total - completed, todayHours: Math.round(todayHours * 10) / 10 };
  }, [driverTrips]);

  const recentIncidents = useMemo(() =>
    incidentRows.slice(0, 5).map(r => ({
      id: str(r.id), title: str(r.title, "Untitled"),
      severity: str(r.severity, "low"), status: str(r.status, "open"),
      createdAt: str(r.createdAt),
    })), [incidentRows]);

  const pendingTransport = useMemo(() =>
    transportRows.filter(r => ["PENDING", "APPROVED"].includes(str(r.status))).slice(0, 5).map(r => ({
      id: str(r.id), residentName: str(r.residentName, "Unknown"),
      destination: str(r.destination, "—"), status: str(r.status),
    })), [transportRows]);

  const [destCoords, setDestCoords] = useState<Record<string, MapPoint>>({});
  useEffect(() => {
    const uniq = new Map<string, string>();
    driverTrips.forEach(t => { if (t.destination && t.destination !== "—" && !destCoords[t.destination]) uniq.set(t.destination, t.destination); });
    if (uniq.size === 0) return;
    const ctrl = new AbortController();
    (async () => {
      for (const [, text] of uniq) {
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&limit=1`,
            { headers: { "User-Agent": "AssistedLivingPlatform/1.0" }, signal: ctrl.signal });
          const d = await r.json();
          if (d.length > 0) setDestCoords(p => ({ ...p, [text]: { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon), label: text } }));
        } catch {}
      }
    })();
    return () => ctrl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverTrips.map(t => t.destination).join(",")]);

  const [vehiclePos, setVehiclePos] = useState<{ lat: number; lng: number } | undefined>(undefined);
  useEffect(() => {
    if (activeTrip?.status === "EN_ROUTE" || activeTrip?.status === "RETURNING") {
      setVehiclePos({ lat: FACILITY_LAT + (Math.random() - 0.5) * 0.01, lng: FACILITY_LNG + (Math.random() - 0.5) * 0.01 });
    } else { setVehiclePos(undefined); }
  }, [activeTrip?.status]);

  const [showFullMap, setShowFullMap] = useState(false);

  const handleEmergencySOS = () => {
    Swal.fire({
      title: "EMERGENCY SOS",
      html: `<p style="font-size:14px;margin-bottom:12px">This will immediately alert dispatch and emergency services.</p>
        <div style="text-align:left;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:12px;margin-top:8px">
          <p style="font-size:12px;color:#f87171;font-weight:700">EMERGENCY CONTACTS</p>
          <p style="font-size:12px;margin-top:4px">Dispatch: <b>(02) 8888-9999</b></p>
          <p style="font-size:12px">Emergency: <b>911</b></p>
        </div>`,
      icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444",
      confirmButtonText: "Activate SOS", cancelButtonText: "Cancel",
    }).then(result => {
      if (result.isConfirmed) {
        Swal.fire({ title: "SOS Activated", text: "Dispatch has been notified. Stay in position.", icon: "error", timer: 5000, showConfirmButton: false });
      }
    });
  };

  const handleTransition = async (trip: Trip, nextStatus: string) => {
    const updates: Record<string, unknown> = { status: nextStatus };
    const now = new Date().toISOString();
    if (nextStatus === "EN_ROUTE") updates.departedAt = now;
    if (nextStatus === "ARRIVED") updates.arrivedAt = now;
    if (nextStatus === "RETURNING") updates.returnDepartedAt = now;
    if (nextStatus === "COMPLETED") {
      updates.completedAt = now;
      const departedAt = trip.departedAt ? new Date(trip.departedAt).getTime() : 0;
      const hours = departedAt ? Math.round(((Date.now() - departedAt) / 3600000) * 10) / 10 : 1.0;
      if (activeDriver) await updateRecord("drivers", activeDriver.id, { tripHours: Math.round((activeDriver.tripHours + hours) * 10) / 10 });
      if (trip.vehicleId) await updateRecord("vehicles", trip.vehicleId, { status: "AVAILABLE" });
    }
    try {
      await updateRecord("trips", trip.id, updates);
      Swal.fire({ title: "Updated", text: `Trip: ${STEP_LABELS[nextStatus] || nextStatus}`, icon: "success", toast: true, position: "top-end", timer: 3000, showConfirmButton: false });
    } catch { Swal.fire("Error", "Could not update trip status.", "error"); }
  };

  if (!activeDriver) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-gray-500">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-500 mb-4" />
        <span className="text-sm font-semibold">Loading driver profile...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Emergency Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button onClick={handleEmergencySOS}
          className="flex items-center justify-center gap-2 px-5 py-3 bg-red-500 hover:bg-red-600 text-white font-black rounded-xl text-sm shadow-lg active:scale-[0.98] transition-all shrink-0">
          <Siren className="w-4 h-4" /> Emergency SOS
        </button>
        <div className="flex-1 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="text-xs text-gray-600">
            {recentIncidents.filter(i => i.status === "OPEN").length > 0
              ? <><span className="text-red-600 font-bold">{recentIncidents.filter(i => i.status === "OPEN").length} active alert(s)</span></>
              : "No active alerts — all clear"}
          </span>
        </div>
        <a href="tel:911"
          className="flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-300 text-gray-900 font-bold rounded-xl text-sm hover:bg-gray-50 transition-all shrink-0">
          <Phone className="w-4 h-4 text-green-500" /> Call 911
        </a>
      </div>

      {/* Driver Identity */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center text-white shrink-0">
              <Car className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">{activeDriver.name}</h2>
              <p className="text-xs text-gray-500">License: {activeDriver.licenseNumber}{activeDriver.certifications && ` · ${activeDriver.certifications}`}</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500 block">Safety</span>
              <span className="text-lg font-black text-green-600 flex items-center gap-1 mt-0.5"><Star className="w-4 h-4 fill-green-500" /> {activeDriver.safetyScore}%</span>
            </div>
            <div className="text-center">
              <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500 block">Hours</span>
              <span className="text-lg font-black text-yellow-600 flex items-center gap-1 mt-0.5"><Clock className="w-4 h-4" /> {activeDriver.tripHours}h</span>
            </div>
            <div className="text-center">
              <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500 block">Trips</span>
              <span className="text-lg font-black text-blue-600 flex items-center gap-1 mt-0.5"><Route className="w-4 h-4" /> {shiftStats.total}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Total Trips" value={String(shiftStats.total)} icon={Route} color="blue" />
        <StatBox label="Completed" value={String(shiftStats.completed)} icon={CheckCircle2} color="green" />
        <StatBox label="Pending" value={String(shiftStats.pending)} icon={Clock} color="amber" />
        <StatBox label="Hours Today" value={`${shiftStats.todayHours}h`} icon={Gauge} color="purple" />
      </div>

      {/* Map + Active Trip */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-3">
              <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2"><Navigation className="w-4 h-4 text-yellow-500" /> Active Trip</h3>
              {activeTrip && <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_PILL[activeTrip.status]}`}>{STEP_LABELS[activeTrip.status]}</span>}
            </div>
            {activeTrip ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="col-span-2">
                    <span className="text-[10px] text-gray-500 font-semibold uppercase block mb-0.5">Route — Pickup → Drop-off</span>
                    <p className="font-bold text-gray-900 flex items-center gap-1 text-sm flex-wrap">
                      <MapPin className="w-3.5 h-3.5 text-green-500" /> {activeTrip.pickupLocation}
                      <span className="text-gray-400 mx-0.5">→</span>
                      <MapPin className="w-3.5 h-3.5 text-red-500" /> {activeTrip.dropoffLocation}
                    </p>
                    <a href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(activeTrip.pickupLocation)}&destination=${encodeURIComponent(activeTrip.dropoffLocation)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-1 text-xs font-semibold text-blue-600 hover:text-blue-800">
                      <Navigation className="w-3.5 h-3.5" /> Navigate route
                    </a>
                  </div>
                  <div><span className="text-[10px] text-gray-500 font-semibold uppercase block">Resident</span><p className="font-bold text-gray-900">{activeTrip.residentName}</p><p className="text-xs text-gray-500">Room {activeTrip.roomNumber}</p></div>
                  <div><span className="text-[10px] text-gray-500 font-semibold uppercase block">Vehicle</span><p className="font-bold text-gray-900 flex items-center gap-1"><Truck className="w-3 h-3 text-yellow-500" /> {activeTrip.vehicleName}</p><p className="text-xs text-gray-500">{activeTrip.vehiclePlate}</p></div>
                  <div><span className="text-[10px] text-gray-500 font-semibold uppercase block">Escort</span><p className="font-bold text-gray-900">{activeTrip.escortName || "No Escort"}</p></div>
                </div>
                {/* Stepper */}
                <div className="border-t border-gray-100 pt-3">
                  <div className="flex items-center gap-1 overflow-x-auto pb-1">
                    {TRIP_STEPS.map((step, i) => {
                      const currentIdx = TRIP_STEPS.indexOf(activeTrip.status);
                      const isDone = i <= currentIdx;
                      const isCurrent = i === currentIdx;
                      return (
                        <div key={step} className="flex items-center gap-1 shrink-0">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border ${isDone ? "bg-yellow-500 border-yellow-500 text-white" : "bg-white border-gray-300 text-gray-500"} ${isCurrent ? "ring-2 ring-yellow-400/50" : ""}`}>
                            {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
                          </div>
                          {i < TRIP_STEPS.length - 1 && <div className={`w-6 h-0.5 ${isDone ? "bg-yellow-500" : "bg-gray-200"}`} />}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/* Action buttons */}
                <div className="border-t border-gray-100 pt-3">
                  {activeTrip.status === "INSPECTION" && (
                    <button onClick={() => handleTransition(activeTrip, "EN_ROUTE")} className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-black rounded-xl text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99]">
                      <Navigation className="w-4 h-4" /> Depart Facility
                    </button>
                  )}
                  {activeTrip.status === "EN_ROUTE" && (
                    <button onClick={() => handleTransition(activeTrip, "ARRIVED")} className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-black rounded-xl text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99]">
                      <MapPin className="w-4 h-4" /> Mark Arrived
                    </button>
                  )}
                  {activeTrip.status === "ARRIVED" && (
                    <button onClick={() => handleTransition(activeTrip, "RETURNING")} className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-black rounded-xl text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99]">
                      <RotateCcw className="w-4 h-4" /> Start Return
                    </button>
                  )}
                  {activeTrip.status === "RETURNING" && (
                    <button onClick={() => handleTransition(activeTrip, "COMPLETED")} className="w-full py-3 bg-green-600 hover:bg-green-500 text-white font-black rounded-xl text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99]">
                      <CheckCircle2 className="w-4 h-4" /> Complete Trip
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle2 className="w-10 h-10 text-green-500 mb-2" />
                <p className="font-bold text-sm text-gray-900">All Clear</p>
                <p className="text-xs text-gray-500 mt-1">No active trips assigned.</p>
              </div>
            )}
          </div>
        </div>
        <div className="space-y-5">
          {/* Assigned Vehicle */}
          {assignedVehicle && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h4 className="font-bold text-sm text-gray-900 mb-2 flex items-center gap-2"><Truck className="w-4 h-4 text-yellow-500" /> Assigned Vehicle</h4>
              <p className="font-semibold text-sm text-gray-900">{str(assignedVehicle.name)} ({str(assignedVehicle.licensePlate)})</p>
              <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                <div className="bg-gray-50 rounded-lg p-2 text-center"><span className="text-gray-500 block">Odometer</span><p className="font-bold text-gray-900">{num(assignedVehicle.odometer).toLocaleString()} km</p></div>
                <div className="bg-gray-50 rounded-lg p-2 text-center"><span className="text-gray-500 block">Fuel</span><p className="font-bold text-gray-900">{num(assignedVehicle.fuelLevel)}%</p></div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full-width live route map */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div>
            <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2"><MapPin className="w-4 h-4 text-yellow-500" /> Live Route Map</h3>
            {activeTrip
              ? <p className="text-xs text-gray-500 mt-0.5">{activeTrip.pickupLocation} → {activeTrip.dropoffLocation}</p>
              : <p className="text-xs text-gray-400 mt-0.5">No active trip — showing facility location.</p>}
          </div>
          <button onClick={() => setShowFullMap(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
            <Maximize2 className="w-3.5 h-3.5" /> Expand
          </button>
        </div>
        <NavigationMap
          destination={activeTrip ? (destCoords[activeTrip.destination] || { text: activeTrip.destination }) : undefined}
          vehiclePosition={vehiclePos} height="360px" showRoute={!!activeTrip}
        />
      </div>

      {/* Expandable full-screen map modal */}
      {showFullMap && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowFullMap(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[94vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-yellow-400 to-yellow-500 text-black p-4 flex items-center justify-between flex-shrink-0 gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-bold flex items-center gap-2"><MapPin className="w-5 h-5" /> Live Route Map</h2>
                {activeTrip && <p className="text-xs text-black/70 truncate">{activeTrip.pickupLocation} → {activeTrip.dropoffLocation}</p>}
              </div>
              <button onClick={() => setShowFullMap(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition flex-shrink-0"><X className="w-6 h-6" /></button>
            </div>
            <div className="flex-1 min-h-0">
              <NavigationMap
                destination={activeTrip ? (destCoords[activeTrip.destination] || { text: activeTrip.destination }) : undefined}
                vehiclePosition={vehiclePos} height="72vh" showRoute={!!activeTrip}
              />
            </div>
            {activeTrip && (
              <div className="px-4 py-3 border-t border-gray-200 flex-shrink-0">
                <a href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(activeTrip.pickupLocation)}&destination=${encodeURIComponent(activeTrip.dropoffLocation)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-800">
                  <Navigation className="w-4 h-4" /> Open turn-by-turn navigation
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom: Transport + Incidents */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h4 className="font-bold text-sm text-gray-900 mb-3 flex items-center gap-2"><Package className="w-4 h-4 text-blue-500" /> Transport Requests</h4>
          {pendingTransport.length > 0 ? pendingTransport.map(req => (
            <div key={req.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg mb-2 text-sm">
              <div><p className="font-semibold text-gray-900">{req.residentName}</p><p className="text-xs text-gray-500">{req.destination}</p></div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${req.status === "PENDING" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-green-50 text-green-700 border-green-200"}`}>{req.status}</span>
            </div>
          )) : <p className="text-xs text-gray-400 text-center py-4">No pending requests</p>}
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h4 className="font-bold text-sm text-gray-900 mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-red-500" /> Recent Incidents</h4>
          {recentIncidents.length > 0 ? recentIncidents.map(inc => (
            <div key={inc.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg mb-2 text-sm">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${inc.severity === "CRITICAL" ? "bg-red-500 animate-pulse" : "bg-yellow-500"}`} />
                <div><p className="font-semibold text-gray-900">{inc.title}</p><p className="text-xs text-gray-500">{fmtDT(inc.createdAt)}</p></div>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${inc.status === "OPEN" ? "bg-red-50 text-red-700 border-red-200" : "bg-green-50 text-green-700 border-green-200"}`}>{inc.status}</span>
            </div>
          )) : <p className="text-xs text-gray-400 text-center py-4">No incidents — all clear</p>}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════ */
/*                           TRIPS TAB                                           */
/* ══════════════════════════════════════════════════════════════════════════════ */

function TripsTab({ onView }: { onView: (r: Record<string, unknown>) => void }) {
  const { data: driverRows } = useLiveQuery<Row>("drivers", { query: "take=10", tables: ["Driver"] });
  const { data: tripRows, loading, error, refetch } = useLiveQuery<Row>("trips", {
    query: "include=resident,vehicle,driver&orderBy=scheduledAt:desc&take=300",
    tables: ["Trip", "Vehicle", "Driver", "Resident"],
  });
  const { data: residentRows } = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });
  const passengers = useMemo(
    () => residentRows.map(r => ({ id: str(r.id), name: `${str(r.firstName)} ${str(r.lastName)}`.trim() || "Resident", room: str(r.roomNumber) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [residentRows]
  );
  const [showRequest, setShowRequest] = useState(false);

  const [currentUser, setCurrentUser] = useState<{ id: string; email: string } | null>(null);
  useEffect(() => {
    fetch("/api/auth/session").then(r => r.json()).then(data => {
      if (data.authenticated && data.userId)
        fetch(`/api/db/users/${data.userId}`).then(r => r.json()).then(r => { if (r.success && r.data) setCurrentUser({ id: r.data.id, email: r.data.email }); }).catch(() => {});
    }).catch(() => {});
  }, []);

  const activeDriverId = useMemo(() => {
    if (currentUser?.email) { const r = driverRows.find(d => str(d.email).toLowerCase() === currentUser.email.toLowerCase()); if (r) return str(r.id); }
    const fb = driverRows.find(d => bool(d.isActive)) ?? driverRows[0];
    return fb ? str(fb.id) : "";
  }, [driverRows, currentUser]);

  const allTrips = useMemo<Trip[]>(() => tripRows.map(adaptTrip), [tripRows]);
  const driverTrips = useMemo(() => allTrips.filter(t => t.driverId === activeDriverId), [allTrips, activeDriverId]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const perPage = 10;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return driverTrips.filter(t => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (q && !t.residentName.toLowerCase().includes(q) && !t.destination.toLowerCase().includes(q) && !t.vehicleName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [driverTrips, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const stats = useMemo(() => ({
    total: driverTrips.length,
    active: driverTrips.filter(t => !["COMPLETED", "CANCELLED"].includes(t.status)).length,
    completed: driverTrips.filter(t => t.status === "COMPLETED").length,
    hours: driverTrips.filter(t => t.status === "COMPLETED").reduce((s, t) => s + computeTripHours(t), 0),
  }), [driverTrips]);

  const handleTransition = async (trip: Trip, nextStatus: string) => {
    const updates: Record<string, unknown> = { status: nextStatus };
    const now = new Date().toISOString();
    if (nextStatus === "EN_ROUTE") updates.departedAt = now;
    if (nextStatus === "ARRIVED") updates.arrivedAt = now;
    if (nextStatus === "RETURNING") updates.returnDepartedAt = now;
    if (nextStatus === "COMPLETED") {
      updates.completedAt = now;
      const hours = trip.departedAt ? Math.round(((Date.now() - new Date(trip.departedAt).getTime()) / 3600000) * 10) / 10 : 1.0;
      if (activeDriverId) await updateRecord("drivers", activeDriverId, { tripHours: hours });
      if (trip.vehicleId) await updateRecord("vehicles", trip.vehicleId, { status: "AVAILABLE" });
    }
    try { await updateRecord("trips", trip.id, updates); await refetch(); } catch { Swal.fire("Error", "Failed.", "error"); }
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Total Trips" value={String(stats.total)} icon={Route} color="blue" />
        <StatBox label="Active" value={String(stats.active)} icon={Navigation} color="amber" />
        <StatBox label="Completed" value={String(stats.completed)} icon={CheckCircle2} color="green" />
        <StatBox label="Hours" value={`${Math.round(stats.hours * 10) / 10}h`} icon={Clock} color="purple" />
      </div>

      {/* Toolbar */}
      <div className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          {TRIP_STATUS_CHIPS.map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${statusFilter === s ? "bg-yellow-400 text-black border-yellow-400" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
              {s === "all" ? "All" : STEP_LABELS[s] || s.replace(/_/g, " ")}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Search resident, destination, vehicle…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
          </div>
          <button onClick={() => setShowRequest(true)} className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition text-sm whitespace-nowrap active:scale-95"><Plus className="w-4 h-4" /> Request Pickup</button>
          <button onClick={() => void refetch()} className="p-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* Table */}
      {loading && driverTrips.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading trips...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No trips match your filters.</div>
      ) : (
        <>
          <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <Th>Resident</Th><Th>Destination</Th><Th>Vehicle</Th><Th>Scheduled</Th><Th>Inspection</Th><Th>Status</Th><Th align="center">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginated.map(t => (
                  <tr key={t.id} className="hover:bg-gray-50 transition">
                    <Td><p className="font-medium text-gray-900">{t.residentName}</p><p className="text-xs text-gray-500">Rm {t.roomNumber}</p></Td>
                    <Td className="text-xs"><span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-green-500 flex-shrink-0" /> {t.pickupLocation} <span className="text-gray-400">→</span> <MapPin className="w-3 h-3 text-red-500 flex-shrink-0" /> {t.dropoffLocation}</span></Td>
                    <Td className="text-xs">{t.vehicleName}<br /><span className="text-gray-400">{t.vehiclePlate}</span></Td>
                    <Td className="text-xs">{fmtDT(t.scheduledAt)}</Td>
                    <Td>{t.inspectionDone
                      ? <span className="flex items-center gap-1 text-green-600 text-xs font-semibold"><ShieldCheck className="w-3 h-3" /> Cleared</span>
                      : <span className="flex items-center gap-1 text-amber-600 text-xs font-semibold"><AlertTriangle className="w-3 h-3" /> Pending</span>}</Td>
                    <Td><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_PILL[t.status]}`}>{STEP_LABELS[t.status] || t.status}</span></Td>
                    <Td>
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => onView({ ...t, _tab: "trips" })} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                        {t.status === "INSPECTION" && <button onClick={() => handleTransition(t, "EN_ROUTE")} className="p-1.5 rounded hover:bg-amber-100 text-amber-600 transition text-xs font-semibold">Depart</button>}
                        {t.status === "EN_ROUTE" && <button onClick={() => handleTransition(t, "ARRIVED")} className="p-1.5 rounded hover:bg-purple-100 text-purple-600 transition text-xs font-semibold">Arrived</button>}
                        {t.status === "ARRIVED" && <button onClick={() => handleTransition(t, "RETURNING")} className="p-1.5 rounded hover:bg-cyan-100 text-cyan-600 transition text-xs font-semibold">Return</button>}
                        {t.status === "RETURNING" && <button onClick={() => handleTransition(t, "COMPLETED")} className="p-1.5 rounded hover:bg-green-100 text-green-600 transition text-xs font-semibold">Complete</button>}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {paginated.map(t => (
              <div key={t.id} className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_PILL[t.status]}`}>{STEP_LABELS[t.status]}</span>
                  <span className="text-xs text-gray-500">{fmtDT(t.scheduledAt)}</span>
                </div>
                <p className="font-medium text-gray-900 text-sm">{t.residentName}</p>
                <p className="text-xs text-gray-500 flex items-center gap-1 flex-wrap"><MapPin className="w-3 h-3 text-green-500 flex-shrink-0" /> {t.pickupLocation} <span className="text-gray-400">→</span> <MapPin className="w-3 h-3 text-red-500 flex-shrink-0" /> {t.dropoffLocation}</p>
                <p className="text-xs text-gray-500">{t.vehicleName} · {t.vehiclePlate}</p>
                <div className="flex gap-1 pt-1">
                  <button onClick={() => onView({ ...t, _tab: "trips" })} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition"><Eye className="w-3 h-3" /> View</button>
                  {t.status === "INSPECTION" && <button onClick={() => handleTransition(t, "EN_ROUTE")} className="px-2.5 py-1.5 text-xs font-semibold text-amber-600 bg-amber-50 hover:bg-amber-100 rounded transition">Depart</button>}
                  {t.status === "EN_ROUTE" && <button onClick={() => handleTransition(t, "ARRIVED")} className="px-2.5 py-1.5 text-xs font-semibold text-purple-600 bg-purple-50 hover:bg-purple-100 rounded transition">Arrived</button>}
                  {t.status === "RETURNING" && <button onClick={() => handleTransition(t, "COMPLETED")} className="px-2.5 py-1.5 text-xs font-semibold text-green-600 bg-green-50 hover:bg-green-100 rounded transition">Complete</button>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <Pagination page={page} totalPages={totalPages} total={filtered.length} label="trips" setPage={setPage} />

      {showRequest && <DriverRequestModal passengers={passengers} onClose={() => setShowRequest(false)} onSaved={() => { setShowRequest(false); void refetch(); }} />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════ */
/*              DRIVER REQUEST PICKUP MODAL (passenger patient dropdown)         */
/* ══════════════════════════════════════════════════════════════════════════════ */

const REQUEST_TYPES = [
  { value: "MEDICAL_APPOINTMENT", label: "Medical Appointment" },
  { value: "DIALYSIS", label: "Dialysis Run" },
  { value: "THERAPY", label: "Therapy Run" },
  { value: "FAMILY_OUTING", label: "Family Outing" },
  { value: "EMERGENCY_TRANSFER", label: "Emergency / Ambulance" },
  { value: "OTHER", label: "Other" },
];

function DriverRequestModal({ passengers, onClose, onSaved }: {
  passengers: { id: string; name: string; room: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    residentId: "", type: "MEDICAL_APPOINTMENT",
    pickupLocation: "Golden Hearth Facility", dropoffLocation: "",
    requestedDate: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const valid = form.residentId && form.dropoffLocation && form.requestedDate;
  const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none";

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await createRecord("transport-requests", {
        residentId: form.residentId,
        type: form.type,
        pickupLocation: form.pickupLocation,
        dropoffLocation: form.dropoffLocation,
        destination: form.dropoffLocation,
        requestedDate: new Date(form.requestedDate).toISOString(),
        priority: form.type === "EMERGENCY_TRANSFER" ? "EMERGENCY" : "NORMAL",
        status: "PENDING",
        source: "DRIVER",
        notes: form.notes || null,
      });
      Swal.fire({ title: "Pickup Requested", text: "Sent to the dispatcher for review & assignment.", icon: "success", timer: 1800, showConfirmButton: false });
      onSaved();
    } catch (err) {
      setSaving(false);
      Swal.fire({ title: "Request Failed", text: err instanceof Error ? err.message : "Could not send request.", icon: "error" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black p-5 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold">Request Pickup</h2>
          <button onClick={onClose} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-4">
          {/* Passenger patient dropdown */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1"><UserRound className="w-3.5 h-3.5" /> Passenger (Patient) <span className="text-red-500">*</span></label>
            <select value={form.residentId} onChange={e => set("residentId", e.target.value)} className={`${inputCls} bg-white`}>
              <option value="">Select passenger…</option>
              {passengers.map(p => <option key={p.id} value={p.id}>{p.name} — Room {p.room}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Trip Type</label>
              <select value={form.type} onChange={e => set("type", e.target.value)} className={`${inputCls} bg-white`}>
                {REQUEST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Date &amp; Time <span className="text-red-500">*</span></label>
              <input type="datetime-local" value={form.requestedDate} onChange={e => set("requestedDate", e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-semibold text-gray-700">Pickup &amp; Drop-off</label>
              <button type="button" onClick={() => setForm(f => ({ ...f, pickupLocation: f.dropoffLocation, dropoffLocation: f.pickupLocation }))}
                className="inline-flex items-center gap-1 text-xs font-semibold text-yellow-700 hover:text-yellow-800" title="Swap pickup & drop-off">
                <ArrowLeftRight className="w-3.5 h-3.5" /> Swap
              </button>
            </div>
            <div className="space-y-2">
              <div className="relative">
                <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-green-500" />
                <input type="text" value={form.pickupLocation} onChange={e => set("pickupLocation", e.target.value)} placeholder="Pickup — e.g. Golden Hearth Facility" className={`${inputCls} pl-9`} />
              </div>
              <div className="relative">
                <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-red-500" />
                <input type="text" value={form.dropoffLocation} onChange={e => set("dropoffLocation", e.target.value)} placeholder="Drop-off — e.g. St. Luke's Medical Center" className={`${inputCls} pl-9`} />
              </div>
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Notes for the Dispatcher</label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} className={inputCls} />
          </div>
        </div>
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
          <button onClick={onClose} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition text-sm">Cancel</button>
          <button onClick={() => void submit()} disabled={!valid || saving}
            className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 text-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {saving ? "Sending…" : "Send Request"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════ */
/*                         CHECKLIST TAB                                         */
/* ══════════════════════════════════════════════════════════════════════════════ */

function ChecklistTab() {
  const { data: driverRows } = useLiveQuery<Row>("drivers", { query: "take=10", tables: ["Driver"] });
  const { data: tripRows, refetch } = useLiveQuery<Row>("trips", {
    query: "include=resident,vehicle,driver&orderBy=scheduledAt:desc&take=300",
    tables: ["Trip", "Vehicle", "Driver", "Resident"],
  });

  const [currentUser, setCurrentUser] = useState<{ id: string; email: string } | null>(null);
  useEffect(() => {
    fetch("/api/auth/session").then(r => r.json()).then(data => {
      if (data.authenticated && data.userId)
        fetch(`/api/db/users/${data.userId}`).then(r => r.json()).then(r => { if (r.success && r.data) setCurrentUser({ id: r.data.id, email: r.data.email }); }).catch(() => {});
    }).catch(() => {});
  }, []);

  const activeDriverId = useMemo(() => {
    if (currentUser?.email) { const r = driverRows.find(d => str(d.email).toLowerCase() === currentUser.email.toLowerCase()); if (r) return str(r.id); }
    const fb = driverRows.find(d => bool(d.isActive)) ?? driverRows[0];
    return fb ? str(fb.id) : "";
  }, [driverRows, currentUser]);

  const driverTrips = useMemo<Trip[]>(() =>
    tripRows.map(adaptTrip).filter(t => t.driverId === activeDriverId),
    [tripRows, activeDriverId]);

  const activeTrip = useMemo(() =>
    driverTrips.find(t => t.status !== "COMPLETED" && t.status !== "CANCELLED") || null, [driverTrips]);

  const [checklist, setChecklist] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    INSPECTION_ITEMS.forEach(i => { init[i] = false; });
    return init;
  });

  useEffect(() => {
    if (activeTrip?.inspectionChecklist) {
      try {
        const saved = JSON.parse(activeTrip.inspectionChecklist);
        if (Array.isArray(saved)) {
          const map: Record<string, boolean> = {};
          INSPECTION_ITEMS.forEach(i => { map[i] = false; });
          saved.forEach((e: { item: string; ok: boolean }) => { if (e.item in map) map[e.item] = e.ok; });
          setChecklist(map);
        }
      } catch {}
    }
  }, [activeTrip?.inspectionChecklist]);

  const handleSubmit = async () => {
    if (!activeTrip) { Swal.fire("No Active Trip", "No trip requires inspection.", "warning"); return; }
    const unchecked = INSPECTION_ITEMS.filter(item => !checklist[item]);
    if (unchecked.length > 0) { Swal.fire({ title: "Incomplete", text: `Missing: ${unchecked.length} items`, icon: "warning" }); return; }
    try {
      await updateRecord("trips", activeTrip.id, {
        inspectionDone: true,
        inspectionChecklist: JSON.stringify(INSPECTION_ITEMS.map(item => ({ item, ok: true }))),
        status: "INSPECTION",
      });
      Swal.fire({ title: "Inspection Submitted", text: "Vehicle cleared for departure.", icon: "success" });
      refetch();
    } catch { Swal.fire("Error", "Failed to submit.", "error"); }
  };

  const completedCount = Object.values(checklist).filter(Boolean).length;
  const allDone = completedCount === INSPECTION_ITEMS.length;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-3">
          <ClipboardCheck className="w-5 h-5 text-yellow-500" />
          <h3 className="font-bold text-gray-900">Pre-Trip Safety Inspection</h3>
        </div>
        <p className="text-xs text-gray-500 mb-4">Complete all {INSPECTION_ITEMS.length} safety items before transit. Mandatory for liability compliance.</p>

        {activeTrip ? (
          <div className="space-y-4">
            <div className="bg-yellow-50 border border-yellow-200 text-xs p-3 rounded-lg">
              <span className="text-[10px] text-yellow-600 uppercase font-bold block">Inspection Target</span>
              <p className="font-bold text-sm text-yellow-700 mt-0.5">{activeTrip.residentName} → {activeTrip.destination}</p>
              <p className="text-gray-600 mt-1">Vehicle: {activeTrip.vehicleName} ({activeTrip.vehiclePlate})</p>
              {activeTrip.inspectionDone && <span className="inline-flex items-center gap-1 mt-2 text-green-600 text-xs font-semibold"><ShieldCheck className="w-3.5 h-3.5" /> Previously submitted</span>}
            </div>

            {/* Progress */}
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-gray-200 rounded-full h-2">
                <div className={`h-2 rounded-full transition-all ${allDone ? "bg-green-500" : "bg-yellow-500"}`} style={{ width: `${(completedCount / INSPECTION_ITEMS.length) * 100}%` }} />
              </div>
              <span className="text-xs font-bold text-gray-700">{completedCount}/{INSPECTION_ITEMS.length}</span>
            </div>

            {/* Items */}
            <div className="space-y-2">
              {INSPECTION_ITEMS.map(item => (
                <label key={item} className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors cursor-pointer select-none">
                  <input type="checkbox" checked={checklist[item]} onChange={e => setChecklist(p => ({ ...p, [item]: e.target.checked }))} className="w-4 h-4 accent-yellow-500 rounded" />
                  <span className="text-sm font-semibold text-gray-900">{item}</span>
                  {checklist[item] && <CheckCircle2 className="w-4 h-4 text-green-500 ml-auto" />}
                </label>
              ))}
            </div>

            <button onClick={handleSubmit}
              className={`w-full py-3 font-black rounded-xl text-sm transition-all shadow-lg active:scale-[0.99] ${allDone ? "bg-yellow-500 hover:bg-yellow-400 text-black" : "bg-gray-300 text-gray-500 cursor-not-allowed"}`}
              disabled={!allDone}>
              {allDone ? "Submit Pre-Trip Sign-Off" : `Complete all ${INSPECTION_ITEMS.length} items first`}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-500 mb-3" />
            <h3 className="font-bold text-base text-gray-900">No Inspection Needed</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-xs">No active trip requires inspection right now.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════ */
/*                           FUEL TAB                                            */
/* ══════════════════════════════════════════════════════════════════════════════ */

function FuelTab({ onView }: { onView: (r: Record<string, unknown>) => void }) {
  const { data: driverRows } = useLiveQuery<Row>("drivers", { query: "take=10", tables: ["Driver"] });
  const { data: vehicleRows } = useLiveQuery<Row>("vehicles", { query: "take=50", tables: ["Vehicle"] });
  const { data: fuelRows, loading, error, refetch } = useLiveQuery<Row>("fuel-logs", {
    query: "include=vehicle&orderBy=logDate:desc&take=200", tables: ["FuelLog", "Vehicle"],
  });

  const [currentUser, setCurrentUser] = useState<{ id: string; email: string } | null>(null);
  useEffect(() => {
    fetch("/api/auth/session").then(r => r.json()).then(data => {
      if (data.authenticated && data.userId)
        fetch(`/api/db/users/${data.userId}`).then(r => r.json()).then(r => { if (r.success && r.data) setCurrentUser({ id: r.data.id, email: r.data.email }); }).catch(() => {});
    }).catch(() => {});
  }, []);

  const activeDriverId = useMemo(() => {
    if (currentUser?.email) { const r = driverRows.find(d => str(d.email).toLowerCase() === currentUser.email.toLowerCase()); if (r) return str(r.id); }
    const fb = driverRows.find(d => bool(d.isActive)) ?? driverRows[0];
    return fb ? str(fb.id) : "";
  }, [driverRows, currentUser]);

  const driverLogs = useMemo<FuelLog[]>(() =>
    fuelRows.map(adaptFuelLog).filter(l => l.driverId === activeDriverId),
    [fuelRows, activeDriverId]);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 10;
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ vehicleId: "", odometer: "", liters: "", cost: "", fuelType: "Diesel", notes: "" });
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return driverLogs.filter(l => {
      if (q && !l.vehicleName.toLowerCase().includes(q) && !l.vehiclePlate.toLowerCase().includes(q) && !l.fuelType.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [driverLogs, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const stats = useMemo(() => {
    const month = driverLogs.filter(l => {
      if (!l.logDate) return false;
      const d = new Date(l.logDate);
      const now = new Date();
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
    return {
      liters: month.reduce((s, l) => s + l.liters, 0),
      cost: month.reduce((s, l) => s + l.cost, 0),
      avgPerLiter: month.reduce((s, l) => s + l.liters, 0) > 0 ? month.reduce((s, l) => s + l.cost, 0) / month.reduce((s, l) => s + l.liters, 0) : 0,
      fillUps: month.length,
    };
  }, [driverLogs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.vehicleId || !form.odometer || !form.liters || !form.cost) {
      Swal.fire("Missing Fields", "Complete all required fields.", "warning"); return;
    }
    setSaving(true);
    try {
      await createRecord("fuel-logs", {
        vehicleId: form.vehicleId, driverId: activeDriverId || null,
        logDate: new Date().toISOString(), odometer: Number(form.odometer),
        liters: Number(form.liters), cost: Number(form.cost),
        fuelType: form.fuelType, notes: form.notes || null,
      });
      await updateRecord("vehicles", form.vehicleId, { odometer: Number(form.odometer) });
      Swal.fire({ title: "Refuel Logged", icon: "success", timer: 1500, showConfirmButton: false });
      setForm(p => ({ ...p, odometer: "", liters: "", cost: "", notes: "" }));
      setShowCreate(false);
      refetch();
    } catch { Swal.fire("Error", "Could not submit.", "error"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (log: FuelLog) => {
    const confirmed = await Swal.fire({ title: "Delete?", text: `Remove ${log.liters}L for ${log.vehicleName}?`, icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete" });
    if (!confirmed.isConfirmed) return;
    try { await deleteRecord("fuel-logs", log.id); refetch(); } catch { Swal.fire("Error", "Failed.", "error"); }
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Liters (Month)" value={stats.liters.toLocaleString(undefined, { maximumFractionDigits: 1 })} icon={Fuel} color="blue" />
        <StatBox label="Cost (Month)" value={fmtCurrency(stats.cost)} icon={Gauge} color="amber" />
        <StatBox label="Avg ₱/L" value={stats.avgPerLiter > 0 ? `₱${stats.avgPerLiter.toFixed(2)}` : "—"} icon={Star} color="purple" />
        <StatBox label="Fill-Ups (Month)" value={String(stats.fillUps)} icon={History} color="green" />
      </div>

      {/* Toolbar */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search vehicle, plate, fuel type…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
        <button onClick={() => void refetch()} className="p-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"><RefreshCw className="w-4 h-4" /></button>
        <button onClick={() => { setForm({ vehicleId: "", odometer: "", liters: "", cost: "", fuelType: "Diesel", notes: "" }); setShowCreate(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition text-sm active:scale-95">
          <Fuel className="w-4 h-4" /> Log Refuel
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* Table */}
      {loading && driverLogs.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading fuel logs...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">{search ? "No logs match your search." : "No fuel logs yet."}</div>
      ) : (
        <>
          <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <Th>Date</Th><Th>Vehicle</Th><Th align="right">Odometer</Th><Th align="right">Liters</Th><Th align="right">Cost</Th><Th align="right">₱/L</Th><Th>Fuel</Th><Th align="center">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginated.map(l => (
                  <tr key={l.id} className="hover:bg-gray-50 transition">
                    <Td className="text-xs whitespace-nowrap">{fmtDT(l.logDate)}</Td>
                    <Td className="font-medium text-gray-900">{l.vehicleName} <span className="text-xs text-gray-400 font-normal">{l.vehiclePlate}</span></Td>
                    <Td align="right" className="text-xs">{l.odometer ? `${l.odometer.toLocaleString()} km` : "—"}</Td>
                    <Td align="right" className="font-medium">{l.liters.toLocaleString(undefined, { maximumFractionDigits: 1 })}</Td>
                    <Td align="right" className="font-medium">{fmtCurrency(l.cost)}</Td>
                    <Td align="right" className="text-xs">{l.liters > 0 ? `₱${(l.cost / l.liters).toFixed(2)}` : "—"}</Td>
                    <Td><span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-700">{l.fuelType}</span></Td>
                    <Td>
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => onView({ ...l, _tab: "fuel" })} className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(l)} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {paginated.map(l => (
              <div key={l.id} className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-700">{l.fuelType}</span>
                  <span className="text-sm font-semibold text-gray-900">{fmtCurrency(l.cost)}</span>
                </div>
                <p className="font-medium text-gray-900 text-sm">{l.vehicleName} <span className="text-xs text-gray-400">{l.vehiclePlate}</span></p>
                <p className="text-xs text-gray-500">{l.liters}L · {l.odometer.toLocaleString()} km · {fmtDT(l.logDate)}</p>
                <div className="flex gap-1 pt-1">
                  <button onClick={() => onView({ ...l, _tab: "fuel" })} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition"><Eye className="w-3 h-3" /> View</button>
                  <button onClick={() => handleDelete(l)} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded transition">Delete</button>
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
            <div className="sticky top-0 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black p-5 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold">Log Refuel</h2>
              <button onClick={() => setShowCreate(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Vehicle</label>
                <select value={form.vehicleId} onChange={e => setForm(p => ({ ...p, vehicleId: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                  <option value="">Select…</option>
                  {vehicleRows.map(v => <option key={str(v.id)} value={str(v.id)}>{str(v.name)} ({str(v.licensePlate)})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-semibold text-gray-700 mb-1">Odometer (km)</label><input type="number" required value={form.odometer} onChange={e => setForm(p => ({ ...p, odometer: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
                <div><label className="block text-sm font-semibold text-gray-700 mb-1">Liters</label><input type="number" step="0.01" required value={form.liters} onChange={e => setForm(p => ({ ...p, liters: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
                <div><label className="block text-sm font-semibold text-gray-700 mb-1">Cost (₱)</label><input type="number" required value={form.cost} onChange={e => setForm(p => ({ ...p, cost: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
                <div><label className="block text-sm font-semibold text-gray-700 mb-1">Fuel Type</label>
                  <select value={form.fuelType} onChange={e => setForm(p => ({ ...p, fuelType: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    <option>Diesel</option><option>Gasoline (91)</option><option>Gasoline (95)</option><option>Premium Diesel</option>
                  </select>
                </div>
              </div>
              <div><label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label><textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
            </form>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setShowCreate(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
              <button onClick={handleSubmit} disabled={saving} className="px-5 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm disabled:opacity-50">
                {saving ? "Saving..." : "Log Refuel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════ */
/*                         VIEW MODAL                                            */
/* ══════════════════════════════════════════════════════════════════════════════ */

function ViewModal({ row, onClose }: { row: Record<string, unknown>; onClose: () => void }) {
  const tab = row._tab as string;

  if (tab === "trips") {
    const trip = row as unknown as Trip;
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="sticky top-0 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black p-5 flex items-center justify-between z-10">
            <h2 className="text-xl font-bold">Trip Details</h2>
            <button onClick={onClose} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_PILL[trip.status]}`}>{STEP_LABELS[trip.status] || trip.status}</span>
              <span className="text-xs text-gray-500">{fmtDT(trip.scheduledAt)}</span>
            </div>
            <VF label="Resident" value={`${trip.residentName} (Room ${trip.roomNumber})`} />
            <VF label="Pickup" value={trip.pickupLocation} />
            <VF label="Drop-off" value={trip.dropoffLocation} />
            <VF label="Vehicle" value={`${trip.vehicleName} (${trip.vehiclePlate})`} />
            <VF label="Driver" value={trip.driverName} />
            {trip.escortName && <VF label="Escort" value={`${trip.escortName}${trip.escortRole ? ` (${trip.escortRole})` : ""}`} />}
            <VF label="Inspection" value={trip.inspectionDone ? "Cleared" : "Pending"} />
            {trip.departedAt && <VF label="Departed" value={fmtDT(trip.departedAt)} />}
            {trip.arrivedAt && <VF label="Arrived" value={fmtDT(trip.arrivedAt)} />}
            {trip.completedAt && <VF label="Completed" value={fmtDT(trip.completedAt)} />}
            {trip.distanceKm > 0 && <VF label="Distance" value={`${trip.distanceKm} km`} />}
            {trip.notes && <VF label="Notes" value={trip.notes} />}

            {/* Route map — pickup → drop-off with live vehicle position */}
            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" /> Route Map</p>
              <div className="h-56 rounded-lg overflow-hidden border border-gray-200">
                <NavigationMap
                  destination={{ text: trip.dropoffLocation }}
                  vehiclePosition={trip.currentLat && trip.currentLng ? { lat: trip.currentLat, lng: trip.currentLng, label: `${trip.vehicleName} (live)` } : undefined}
                />
              </div>
              <a href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(trip.pickupLocation)}&destination=${encodeURIComponent(trip.dropoffLocation)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-blue-600 hover:text-blue-800">
                <Navigation className="w-3.5 h-3.5" /> Open turn-by-turn navigation
              </a>
            </div>
          </div>
          <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end">
            <button onClick={onClose} className="px-5 py-2 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 transition text-sm">Close</button>
          </div>
        </div>
      </div>
    );
  }

  if (tab === "fuel") {
    const log = row as unknown as FuelLog;
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="sticky top-0 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black p-5 flex items-center justify-between z-10">
            <h2 className="text-xl font-bold">Fuel Log</h2>
            <button onClick={onClose} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
          </div>
          <div className="p-6 space-y-4">
            <VF label="Vehicle" value={`${log.vehicleName} (${log.vehiclePlate})`} />
            <VF label="Date" value={fmtDT(log.logDate)} />
            <VF label="Odometer" value={`${log.odometer.toLocaleString()} km`} />
            <VF label="Liters" value={`${log.liters} L`} />
            <VF label="Cost" value={fmtCurrency(log.cost)} />
            <VF label="₱/L" value={log.liters > 0 ? `₱${(log.cost / log.liters).toFixed(2)}` : "—"} />
            <VF label="Fuel Type" value={log.fuelType} />
            {log.notes && <VF label="Notes" value={log.notes} />}
          </div>
          <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end">
            <button onClick={onClose} className="px-5 py-2 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 transition text-sm">Close</button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

/* ══════════════════════════════════════════════════════════════════════════════ */
/*                        SHARED SUB-COMPONENTS                                  */
/* ══════════════════════════════════════════════════════════════════════════════ */

function StatBox({ label, value, icon: Icon, color }: { label: string; value: string; icon: LucideIcon; color: string }) {
  const COLORS: Record<string, string> = {
    blue: "text-blue-600 bg-blue-50 border-blue-200",
    green: "text-green-600 bg-green-50 border-green-200",
    amber: "text-amber-600 bg-amber-50 border-amber-200",
    purple: "text-purple-600 bg-purple-50 border-purple-200",
    red: "text-red-600 bg-red-50 border-red-200",
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

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" | "center" }) {
  return <th className={`text-${align || "left"} px-4 py-3 font-semibold text-gray-700 text-xs`}>{children}</th>;
}

function Td({ children, align, className = "" }: { children: React.ReactNode; align?: "left" | "right" | "center"; className?: string }) {
  return <td className={`px-4 py-3 text-${align || "left"} ${className}`}>{children}</td>;
}

function VF({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] text-gray-500 font-semibold uppercase block">{label}</span>
      <p className="text-sm font-medium text-gray-900">{value || "—"}</p>
    </div>
  );
}

function Pagination({ page, totalPages, total, label, setPage }: { page: number; totalPages: number; total: number; label: string; setPage: (n: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between">
      <p className="text-xs text-gray-500">{total} {label} total</p>
      <div className="flex items-center gap-2">
        <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm"><ChevronLeft className="w-4 h-4" /></button>
        <span className="text-sm font-medium text-gray-700">Page {page} of {totalPages}</span>
        <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm"><ChevronRight className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

function Trash2(props: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}
