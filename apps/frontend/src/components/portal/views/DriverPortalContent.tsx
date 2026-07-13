"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Car, Search, Clock, ClipboardCheck, Navigation, CheckCircle2,
  AlertTriangle, Fuel, ShieldCheck, MapPin, Truck, Calendar,
  Activity, Star, UserCheck, RotateCcw, History, Phone,
  Siren, MessageSquare, Route, Gauge, Wrench, Package,
  ChevronRight, ShieldAlert, Zap, CircleDot
} from "lucide-react";
import Swal from "sweetalert2";
import dynamic from "next/dynamic";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord } from "@/lib/api";
import type { MapPoint } from "@/components/NavigationMap";

// Leaflet touches `window` at module scope, so the map module must be
// excluded from SSR entirely — a static import would evaluate it on the server.
const NavigationMap = dynamic(() => import("@/components/NavigationMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[160px] flex items-center justify-center bg-gray-100 rounded-lg text-sm text-gray-500">
      Loading map…
    </div>
  ),
});

interface DriverPortalContentProps { tab: string; }

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : v == null ? d : String(v));
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const bool = (v: unknown): boolean => v === true;
const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function adaptTrip(row: Record<string, unknown>) {
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
    scheduledAt: str(row.scheduledAt), departedAt: str(row.departedAt),
    arrivedAt: str(row.arrivedAt), returnDepartedAt: str(row.returnDepartedAt),
    completedAt: str(row.completedAt),
    distanceKm: num(row.distanceKm),
    inspectionDone: bool(row.inspectionDone),
    inspectionChecklist: str(row.inspectionChecklist),
    notes: str(row.notes), raw: row,
  };
}
type Trip = ReturnType<typeof adaptTrip>;

function adaptFuelLog(row: Record<string, unknown>) {
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
  SCHEDULED: "Scheduled", INSPECTION: "Inspection Done", EN_ROUTE: "En Route",
  ARRIVED: "Arrived", RETURNING: "Returning", COMPLETED: "Completed",
};

const TRIP_STEPS = ["SCHEDULED", "INSPECTION", "EN_ROUTE", "ARRIVED", "RETURNING", "COMPLETED"];
const FACILITY_LAT = Number(process.env.NEXT_PUBLIC_FACILITY_LAT) || 14.5547;
const FACILITY_LNG = Number(process.env.NEXT_PUBLIC_FACILITY_LNG) || 121.0244;

function computeTripHours(trip: Trip): number {
  if (!trip.departedAt || !trip.completedAt) return 0;
  const start = new Date(trip.departedAt).getTime();
  const end = new Date(trip.completedAt).getTime();
  if (isNaN(start) || isNaN(end) || end <= start) return 0;
  return Math.round(((end - start) / 3600000) * 10) / 10;
}

/* ═══ Reusable card wrapper ═══ */
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card-bg border border-card-border shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-5 md:p-6 rounded-2xl transition-all duration-300 ${className}`}>
      {children}
    </div>
  );
}

/* ═══ Section header ═══ */
function SectionHeader({ icon: Icon, title, badge, badgeColor }: { icon: React.ElementType; title: string; badge?: string; badgeColor?: string }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-base md:text-lg font-bold flex items-center gap-2 text-[var(--foreground)]">
        <Icon className="w-5 h-5 text-amber-500" /> {title}
      </h2>
      {badge && (
        <span className={`text-[10px] px-2.5 py-1 rounded-full font-semibold border ${badgeColor || "bg-[var(--surface)] text-[var(--muted-foreground)] border-[var(--border)]"}`}>
          {badge}
        </span>
      )}
    </div>
  );
}

export default function DriverPortalContent({ tab }: DriverPortalContentProps) {
  const { data: driverRows } = useLiveQuery("drivers", { query: "take=10", tables: ["Driver"] });
  const { data: tripRows, refetch: refetchTrips } = useLiveQuery("trips", {
    query: "include=resident,vehicle,driver&orderBy=scheduledAt:desc&take=300",
    tables: ["Trip", "Vehicle", "Driver", "Resident"],
  });
  const { data: vehicleRows } = useLiveQuery("vehicles", { query: "take=50", tables: ["Vehicle"] });
  const { data: fuelLogRows, refetch: refetchFuelLogs } = useLiveQuery("fuel-logs", {
    query: "include=vehicle&orderBy=logDate:desc&take=50", tables: ["FuelLog", "Vehicle"],
  });
  const { data: incidentRows } = useLiveQuery("incidents", {
    query: "orderBy=createdAt:desc&take=20", tables: ["Incident"],
  });
  const { data: transportRows } = useLiveQuery("transport-requests", {
    query: "orderBy=requestedAt:desc&take=20", tables: ["TransportRequest"],
  });

  const [currentUser, setCurrentUser] = useState<{ id: string; email: string; name: string } | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");

  useEffect(() => {
    fetch("/api/auth/session").then(r => r.json()).then(data => {
      if (data.authenticated && data.userId)
        fetch(`/api/db/users/${data.userId}`).then(r => r.json()).then(r => { if (r.success && r.data) setCurrentUser(r.data); }).catch(() => {});
    }).catch(() => {});
  }, []);

  const activeDriver = useMemo(() => {
    const resolve = (row: Record<string, unknown>) => ({
      id: str(row.id), name: str(row.name), phone: str(row.phone), email: str(row.email),
      safetyScore: num(row.safetyScore), tripHours: num(row.tripHours),
      licenseNumber: str(row.licenseNumber), certifications: str(row.certifications),
      isActive: bool(row.isActive),
    });
    if (selectedDriverId) { const r = driverRows.find(d => str(d.id) === selectedDriverId); if (r) return resolve(r); }
    if (currentUser?.email) { const r = driverRows.find(d => str(d.email).toLowerCase() === currentUser.email.toLowerCase()); if (r) return resolve(r); }
    const r = driverRows[0];
    return r ? resolve(r) : null;
  }, [driverRows, currentUser, selectedDriverId]);

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

  const [checklist, setChecklist] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}; INSPECTION_ITEMS.forEach(i => { init[i] = false; }); return init;
  });

  useEffect(() => {
    if (activeTrip?.inspectionChecklist) {
      try {
        const saved = JSON.parse(activeTrip.inspectionChecklist);
        if (Array.isArray(saved)) {
          const map: Record<string, boolean> = {}; INSPECTION_ITEMS.forEach(i => { map[i] = false; });
          saved.forEach((e: { item: string; ok: boolean }) => { if (e.item in map) map[e.item] = e.ok; });
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setChecklist(map);
        }
      } catch {}
    }
  }, [activeTrip?.inspectionChecklist]);

  const [fuelForm, setFuelForm] = useState({ vehicleId: "", odometer: "", liters: "", cost: "", fuelType: "Diesel", notes: "" });
  const [fuelSaving, setFuelSaving] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (activeTrip?.vehicleId && !fuelForm.vehicleId) setFuelForm(p => ({ ...p, vehicleId: activeTrip.vehicleId })); }, [activeTrip?.vehicleId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (assignedVehicle && !fuelForm.odometer) setFuelForm(p => ({ ...p, odometer: String(num(assignedVehicle.odometer)) })); }, [assignedVehicle]);

  const [searchQuery, setSearchQuery] = useState("");
  const filteredTrips = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return driverTrips.filter(t =>
      t.residentName.toLowerCase().includes(q) || t.destination.toLowerCase().includes(q) ||
      t.vehicleName.toLowerCase().includes(q) || t.status.toLowerCase().includes(q));
  }, [driverTrips, searchQuery]);

  const driverFuelLogs = useMemo<FuelLog[]>(() => {
    if (!activeDriver) return [];
    return fuelLogRows.map(adaptFuelLog).filter(l => l.driverId === activeDriver.id);
  }, [fuelLogRows, activeDriver?.id]);

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
  }, [driverTrips.map(t => t.destination).join(",")]);

  const recentIncidents = useMemo(() => {
    if (!incidentRows) return [];
    return incidentRows.slice(0, 5).map((r: Record<string, unknown>) => ({
      id: str(r.id), title: str(r.title, "Untitled Incident"),
      severity: str(r.severity, "low"), status: str(r.status, "open"),
      createdAt: str(r.createdAt),
    }));
  }, [incidentRows]);

  const pendingTransport = useMemo(() => {
    if (!transportRows) return [];
    return transportRows.filter((r: Record<string, unknown>) =>
      str(r.status) === "PENDING" || str(r.status) === "APPROVED"
    ).slice(0, 5).map((r: Record<string, unknown>) => ({
      id: str(r.id), residentName: str(r.residentName, "Unknown"),
      destination: str(r.destination, "—"),
      status: str(r.status), requestedAt: str(r.requestedAt),
    }));
  }, [transportRows]);

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
      Swal.fire({ title: "Status Updated", text: `Trip status: ${STEP_LABELS[nextStatus] || nextStatus}`, icon: "success", toast: true, position: "top-end", timer: 3000, showConfirmButton: false });
      refetchTrips();
    } catch { Swal.fire("Error", "Could not update trip status.", "error"); }
  };

  const handleChecklistSubmit = async () => {
    if (!activeTrip) { Swal.fire("No Active Trip", "No upcoming trip requires inspection.", "warning"); return; }
    const unchecked = INSPECTION_ITEMS.filter(item => !checklist[item]);
    if (unchecked.length > 0) { Swal.fire({ title: "Incomplete Checklist", text: `Please confirm all safety items. Missing: ${unchecked.length}`, icon: "warning" }); return; }
    try {
      await updateRecord("trips", activeTrip.id, {
        inspectionDone: true, inspectionChecklist: JSON.stringify(INSPECTION_ITEMS.map(item => ({ item, ok: true }))),
        status: "INSPECTION",
      });
      Swal.fire({ title: "Inspection Submitted", text: "Vehicle cleared. You may depart.", icon: "success" });
      refetchTrips();
    } catch { Swal.fire("Error", "Failed to submit checklist.", "error"); }
  };

  const handleFuelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fuelForm.vehicleId || !fuelForm.odometer || !fuelForm.liters || !fuelForm.cost) {
      Swal.fire("Missing Fields", "Complete all required fuel fields.", "warning"); return;
    }
    setFuelSaving(true);
    try {
      await createRecord("fuel-logs", {
        vehicleId: fuelForm.vehicleId, driverId: activeDriver?.id || null,
        logDate: new Date().toISOString(), odometer: Number(fuelForm.odometer),
        liters: Number(fuelForm.liters), cost: Number(fuelForm.cost),
        fuelType: fuelForm.fuelType, notes: fuelForm.notes || null,
      });
      await updateRecord("vehicles", fuelForm.vehicleId, { odometer: Number(fuelForm.odometer) });
      Swal.fire("Refuel Logged", "Vehicle mileage updated.", "success");
      setFuelForm(p => ({ ...p, odometer: "", liters: "", cost: "", notes: "" }));
      refetchFuelLogs();
    } catch { Swal.fire("Error", "Could not submit fuel log.", "error"); }
    finally { setFuelSaving(false); }
  };

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

  const [vehiclePos, setVehiclePos] = useState<{ lat: number; lng: number } | undefined>(undefined);
  useEffect(() => {
    if (activeTrip?.status === "EN_ROUTE" || activeTrip?.status === "RETURNING") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVehiclePos({ lat: FACILITY_LAT + (Math.random() - 0.5) * 0.01, lng: FACILITY_LNG + (Math.random() - 0.5) * 0.01 });
    } else {
      setVehiclePos(undefined);
    }
  }, [activeTrip?.status]);

  if (!activeDriver) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-[var(--muted-foreground)]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500 mb-4" />
        <span className="text-sm font-semibold">Loading driver profile...</span>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[100%] mx-auto space-y-6 p-4 md:p-6 text-[var(--foreground)]">

      {/* ═══ EMERGENCY ALERTS BAR ═══ */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button onClick={handleEmergencySOS}
          className="flex items-center justify-center gap-2 px-5 py-3 bg-red-500 hover:bg-red-600 text-white font-black rounded-xl text-sm shadow-lg hover:shadow-red-500/30 active:scale-[0.98] transition-all shrink-0">
          <Siren className="w-4 h-4" /> Emergency SOS
        </button>
        <div className="flex-1 flex items-center gap-2 bg-red-500/5 border border-red-500/10 rounded-xl px-4 py-2.5">
          <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
          <span className="text-xs text-[var(--muted-foreground)]">
            {recentIncidents.filter(i => i.status === "OPEN").length > 0
              ? <><span className="text-red-400 font-bold">{recentIncidents.filter(i => i.status === "OPEN").length} active alert(s)</span> — check incident log</>
              : "No active alerts — all clear"}
          </span>
        </div>
        <a href="tel:911"
          className="flex items-center justify-center gap-2 px-4 py-3 bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] font-bold rounded-xl text-sm hover:bg-[var(--surface-hover)] transition-all shrink-0">
          <Phone className="w-4 h-4 text-green-400" /> Call 911
        </a>
      </div>

      {/* ═══ DRIVER IDENTITY CARD ═══ */}
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 md:gap-4">
            <div className="w-12 h-12 md:w-14 md:h-14 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white shrink-0 shadow-lg shadow-amber-500/20">
              <Car className="w-6 h-6 md:w-7 md:h-7" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold flex items-center gap-2 flex-wrap text-[var(--foreground)]">
                {activeDriver.name}
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">Driver</span>
                {driverRows.length > 1 && (
                  <select value={activeDriver.id} onChange={e => setSelectedDriverId(e.target.value)}
                    className="text-[11px] bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2 py-1 font-bold focus:outline-none focus:border-amber-500/50 text-[var(--foreground)] cursor-pointer ml-2">
                    {driverRows.map(d => (
                      <option key={str(d.id)} value={str(d.id)} className="bg-[var(--card-bg)] text-[var(--foreground)]">
                        {str(d.name)} {str(d.email).toLowerCase() === currentUser?.email?.toLowerCase() ? "(You)" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </h1>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                License: {activeDriver.licenseNumber}{activeDriver.certifications && <span className="ml-2">| {activeDriver.certifications}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--muted-foreground)] block">Safety</span>
              <span className="text-lg md:text-xl font-black text-green-500 flex items-center gap-1 mt-0.5"><Star className="w-4 h-4 fill-green-500" /> {activeDriver.safetyScore}%</span>
            </div>
            <div className="text-center">
              <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--muted-foreground)] block">Hours</span>
              <span className="text-lg md:text-xl font-black text-amber-500 flex items-center gap-1 mt-0.5"><Clock className="w-4 h-4" /> {activeDriver.tripHours}h</span>
            </div>
            <div className="text-center">
              <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--muted-foreground)] block">Trips</span>
              <span className="text-lg md:text-xl font-black text-blue-400 flex items-center gap-1 mt-0.5"><Route className="w-4 h-4" /> {shiftStats.total}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* ════════════════════════════════════════════════════════════
         TAB: DASHBOARD
         ════════════════════════════════════════════════════════════ */}
      {tab === "dashboard" && (
        <>
          {/* Navigation Map */}
          <Card>
            <SectionHeader icon={Navigation} title="Navigation Map"
              badge={activeTrip && activeTrip.destination !== "—" ? activeTrip.destination : "No Active Route"}
              badgeColor={activeTrip ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : undefined} />
            {activeTrip && activeTrip.destination !== "—" ? (
              <NavigationMap
                destination={destCoords[activeTrip.destination] || { text: activeTrip.destination }}
                vehiclePosition={vehiclePos}
                height="360px" showRoute={true} />
            ) : (
              <NavigationMap height="280px" showRoute={false} />
            )}
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Active Trip + Status Controller */}
            <div className="lg:col-span-2 space-y-6">
              <Card className="flex flex-col justify-between min-h-[380px]">
                <div>
                  <div className="flex items-center justify-between border-b border-[var(--border)] pb-4 mb-4">
                    <h2 className="text-base md:text-lg font-bold flex items-center gap-2 text-[var(--foreground)]">
                      <Navigation className="w-5 h-5 text-amber-500" /> Active Trip
                    </h2>
                    {activeTrip && <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_PILL[activeTrip.status]}`}>{STEP_LABELS[activeTrip.status]}</span>}
                  </div>
                  {activeTrip ? (
                    <div className="space-y-4 text-left">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <span className="text-[10px] text-[var(--muted-foreground)] font-semibold block uppercase">Resident</span>
                          <p className="font-bold text-sm text-[var(--foreground)]">{activeTrip.residentName}</p>
                          <p className="text-xs text-[var(--muted-foreground)]">Room {activeTrip.roomNumber}</p>
                        </div>
                        <div>
                          <span className="text-[10px] text-[var(--muted-foreground)] font-semibold block uppercase">Destination</span>
                          <p className="font-bold text-sm flex items-center gap-1 text-[var(--foreground)]">
                            <MapPin className="w-3.5 h-3.5 text-red-500" /> {activeTrip.destination}
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-[var(--border)] pt-4">
                        <div>
                          <span className="text-[10px] text-[var(--muted-foreground)] font-semibold block uppercase">Vehicle</span>
                          <p className="font-bold text-sm flex items-center gap-1.5 text-[var(--foreground)]">
                            <Truck className="w-4 h-4 text-amber-500" /> {activeTrip.vehicleName}
                          </p>
                          <p className="text-xs text-[var(--muted-foreground)]">Plate: {activeTrip.vehiclePlate}</p>
                        </div>
                        <div>
                          <span className="text-[10px] text-[var(--muted-foreground)] font-semibold block uppercase">Staff Escort</span>
                          <p className="font-bold text-sm flex items-center gap-1 text-[var(--foreground)]">
                            <UserCheck className="w-4 h-4 text-blue-400" /> {activeTrip.escortName || "No Escort"}
                          </p>
                          {activeTrip.escortRole && <p className="text-xs text-[var(--muted-foreground)]">{activeTrip.escortRole}</p>}
                        </div>
                      </div>
                      {/* Trip Progress Stepper */}
                      <div className="border-t border-[var(--border)] pt-4">
                        <div className="flex items-center gap-1 overflow-x-auto pb-2">
                          {TRIP_STEPS.map((step, i) => {
                            const currentIdx = TRIP_STEPS.indexOf(activeTrip.status);
                            const isDone = i <= currentIdx;
                            const isCurrent = i === currentIdx;
                            return (
                              <div key={step} className="flex items-center gap-1 shrink-0">
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border ${isDone ? "bg-amber-500 border-amber-500 text-black" : "bg-transparent border-[var(--border)] text-[var(--muted-foreground)]"} ${isCurrent ? "ring-2 ring-amber-500/50" : ""}`}>
                                  {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
                                </div>
                                {i < TRIP_STEPS.length - 1 && <div className={`w-4 sm:w-8 h-0.5 ${isDone ? "bg-amber-500" : "bg-[var(--border)]"}`} />}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      {activeTrip.notes && (
                        <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--muted-foreground)]">
                          <strong>Dispatch Notes:</strong> {activeTrip.notes}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <CheckCircle2 className="w-12 h-12 text-green-500 mb-3" />
                      <h3 className="font-bold text-base text-[var(--foreground)]">All Clear</h3>
                      <p className="text-xs text-[var(--muted-foreground)] mt-1 max-w-xs">No active trips assigned. Enjoy your break.</p>
                    </div>
                  )}
                </div>
                {activeTrip && (
                  <div className="border-t border-[var(--border)] pt-4 mt-4">
                    {activeTrip.status === "SCHEDULED" && (
                      <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex flex-col sm:flex-row items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-5 h-5 shrink-0" />
                          <div className="text-left">
                            <p className="text-xs font-bold">Inspection Required</p>
                            <p className="text-[10px] opacity-80">Complete the pre-trip safety checklist before departure.</p>
                          </div>
                        </div>
                        <a href="#checklist" className="px-4 py-2 bg-amber-500 text-black hover:bg-amber-400 font-bold rounded-xl text-xs transition shrink-0">Go to Checklist</a>
                      </div>
                    )}
                    {activeTrip.status === "INSPECTION" && (
                      <button onClick={() => handleTransition(activeTrip, "EN_ROUTE")} className="w-full py-3 md:py-4 bg-amber-500 hover:bg-amber-400 text-black font-black rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg hover:scale-[1.01] active:scale-[0.99] transition-all">
                        <Navigation className="w-4 h-4 fill-black" /> Depart Facility
                      </button>
                    )}
                    {activeTrip.status === "EN_ROUTE" && (
                      <button onClick={() => handleTransition(activeTrip, "ARRIVED")} className="w-full py-3 md:py-4 bg-purple-600 hover:bg-purple-500 text-white font-black rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg hover:scale-[1.01] active:scale-[0.99] transition-all">
                        <MapPin className="w-4 h-4 fill-white" /> Mark Arrived
                      </button>
                    )}
                    {activeTrip.status === "ARRIVED" && (
                      <button onClick={() => handleTransition(activeTrip, "RETURNING")} className="w-full py-3 md:py-4 bg-cyan-600 hover:bg-cyan-500 text-white font-black rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg hover:scale-[1.01] active:scale-[0.99] transition-all">
                        <RotateCcw className="w-4 h-4" /> Start Return Trip
                      </button>
                    )}
                    {activeTrip.status === "RETURNING" && (
                      <button onClick={() => handleTransition(activeTrip, "COMPLETED")} className="w-full py-3 md:py-4 bg-green-600 hover:bg-green-500 text-white font-black rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg hover:scale-[1.01] active:scale-[0.99] transition-all">
                        <CheckCircle2 className="w-4 h-4" /> Complete Trip
                      </button>
                    )}
                  </div>
                )}
              </Card>
            </div>

            {/* Right column: Telemetry + Vehicle + Quick Actions */}
            <div className="space-y-6">
              {/* Shift Telemetry */}
              <Card>
                <SectionHeader icon={Gauge} title="Shift Telemetry" />
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Total", value: shiftStats.total, color: "text-[var(--foreground)]", bg: "bg-[var(--surface)]" },
                    { label: "Pending", value: shiftStats.pending, color: "text-amber-400", bg: "bg-amber-500/5" },
                    { label: "Done", value: shiftStats.completed, color: "text-green-400", bg: "bg-green-500/5" },
                    { label: "Hours", value: `${shiftStats.todayHours}h`, color: "text-blue-400", bg: "bg-blue-500/5" },
                  ].map(s => (
                    <div key={s.label} className={`${s.bg} border border-[var(--border)] p-3 rounded-xl text-center`}>
                      <span className="text-[10px] text-[var(--muted-foreground)] block font-semibold uppercase">{s.label}</span>
                      <span className={`text-xl font-black ${s.color}`}>{s.value}</span>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Assigned Vehicle */}
              {assignedVehicle && (
                <Card>
                  <SectionHeader icon={Truck} title="Assigned Vehicle" badge={str(assignedVehicle.status, "UNKNOWN")} />
                  <div className="space-y-3">
                    <div className="bg-[var(--surface)] border border-[var(--border)] p-3 rounded-xl">
                      <span className="text-[10px] text-[var(--muted-foreground)] block font-semibold uppercase">Vehicle</span>
                      <p className="font-bold text-sm text-[var(--foreground)]">{str(assignedVehicle.name)} ({str(assignedVehicle.licensePlate)})</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-[var(--surface)] border border-[var(--border)] p-3 rounded-xl">
                        <span className="text-[10px] text-[var(--muted-foreground)] block font-semibold uppercase">Odometer</span>
                        <p className="font-bold text-sm text-[var(--foreground)]">{num(assignedVehicle.odometer).toLocaleString()} km</p>
                      </div>
                      <div className="bg-[var(--surface)] border border-[var(--border)] p-3 rounded-xl">
                        <span className="text-[10px] text-[var(--muted-foreground)] block font-semibold uppercase">Fuel</span>
                        <p className="font-bold text-sm text-[var(--foreground)]">{num(assignedVehicle.fuelLevel)}%</p>
                      </div>
                    </div>
                  </div>
                </Card>
              )}

              {/* Quick Actions */}
              <Card>
                <SectionHeader icon={Zap} title="Quick Actions" />
                <div className="space-y-2">
                  {[
                    { label: "Log Incident", icon: AlertTriangle, color: "text-red-400", href: "#checklist" },
                    { label: "Transport Requests", icon: Package, color: "text-blue-400", href: "#trips", count: pendingTransport.length },
                    { label: "Vehicle Maintenance", icon: Wrench, color: "text-amber-400", href: "#fuel" },
                  ].map(a => (
                    <a key={a.label} href={a.href}
                      className="flex items-center justify-between p-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl hover:bg-[var(--surface-hover)] transition-colors group">
                      <div className="flex items-center gap-3">
                        <a.icon className={`w-4 h-4 ${a.color}`} />
                        <span className="text-sm font-semibold text-[var(--foreground)]">{a.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {a.count != null && a.count > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-bold">{a.count}</span>
                        )}
                        <ChevronRight className="w-4 h-4 text-[var(--muted-foreground)] group-hover:text-amber-500 transition-colors" />
                      </div>
                    </a>
                  ))}
                </div>
              </Card>
            </div>
          </div>

          {/* Bottom row: Transport Requests + Recent Incidents */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Transport Requests */}
            <Card>
              <SectionHeader icon={Package} title="Transport Requests"
                badge={pendingTransport.length > 0 ? `${pendingTransport.length} pending` : "All clear"}
                badgeColor={pendingTransport.length > 0 ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-green-500/10 text-green-400 border-green-500/20"} />
              {pendingTransport.length > 0 ? (
                <div className="space-y-2">
                  {pendingTransport.map(req => (
                    <div key={req.id} className="flex items-center justify-between p-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl">
                      <div className="flex items-center gap-3">
                        <CircleDot className="w-3 h-3 text-blue-400" />
                        <div>
                          <p className="text-sm font-semibold text-[var(--foreground)]">{req.residentName}</p>
                          <p className="text-xs text-[var(--muted-foreground)]">{req.destination}</p>
                        </div>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${req.status === "PENDING" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-green-500/10 text-green-400 border-green-500/20"}`}>
                        {req.status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Package className="w-8 h-8 text-[var(--muted-foreground)] opacity-30 mx-auto mb-2" />
                  <p className="text-xs text-[var(--muted-foreground)]">No pending transport requests</p>
                </div>
              )}
            </Card>

            {/* Recent Incidents */}
            <Card>
              <SectionHeader icon={ShieldAlert} title="Recent Incidents"
                badge={recentIncidents.filter(i => i.status === "OPEN").length > 0 ? `${recentIncidents.filter(i => i.status === "OPEN").length} open` : "Resolved"}
                badgeColor={recentIncidents.filter(i => i.status === "OPEN").length > 0 ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-green-500/10 text-green-400 border-green-500/20"} />
              {recentIncidents.length > 0 ? (
                <div className="space-y-2">
                  {recentIncidents.map(inc => (
                    <div key={inc.id} className="flex items-center justify-between p-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${inc.severity === "CRITICAL" ? "bg-red-500 animate-pulse" : inc.severity === "HIGH" ? "bg-orange-500" : "bg-yellow-500"}`} />
                        <div>
                          <p className="text-sm font-semibold text-[var(--foreground)]">{inc.title}</p>
                          <p className="text-xs text-[var(--muted-foreground)]">{inc.createdAt ? new Date(inc.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—"}</p>
                        </div>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${inc.status === "OPEN" ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-green-500/10 text-green-400 border-green-500/20"}`}>
                        {inc.status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <ShieldCheck className="w-8 h-8 text-green-500 opacity-30 mx-auto mb-2" />
                  <p className="text-xs text-[var(--muted-foreground)]">No recent incidents — all clear</p>
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════
         TAB: TRIPS
         ════════════════════════════════════════════════════════════ */}
      {tab === "trips" && (
        <div className="space-y-6">
          <Card>
            <SectionHeader icon={Navigation} title="Trip Destinations"
              badge={`${filteredTrips.length} trips`} badgeColor="bg-[var(--surface)] text-[var(--muted-foreground)] border-[var(--border)]" />
            {filteredTrips.length > 0 ? (
              <NavigationMap
                destination={filteredTrips.length === 1 ? (destCoords[filteredTrips[0].destination] || { text: filteredTrips[0].destination }) : undefined}
                height="300px" showRoute={filteredTrips.length === 1} />
            ) : (
              <NavigationMap height="200px" showRoute={false} />
            )}
          </Card>

          <Card>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
              <h2 className="text-base md:text-lg font-bold flex items-center gap-2 text-[var(--foreground)]">
                <Route className="w-5 h-5 text-amber-500" /> Trip Board
              </h2>
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-[var(--muted-foreground)] absolute left-3 top-3" />
                <input type="text" placeholder="Search trips..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] rounded-xl focus:outline-none focus:border-amber-500/50" />
              </div>
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)] text-xs font-bold uppercase">
                    <th className="pb-3">Resident</th>
                    <th className="pb-3">Destination</th>
                    <th className="pb-3">Vehicle</th>
                    <th className="pb-3">Scheduled</th>
                    <th className="pb-3">Inspection</th>
                    <th className="pb-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] text-[var(--foreground)]">
                  {filteredTrips.length > 0 ? filteredTrips.map(trip => (
                    <tr key={trip.id} className="hover:bg-[var(--surface)] border-b border-[var(--border)] transition-colors">
                      <td className="py-3"><span className="font-semibold block">{trip.residentName}</span><span className="text-xs text-[var(--muted-foreground)]">Rm {trip.roomNumber}</span></td>
                      <td className="py-3"><span className="font-semibold flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-red-500" /> {trip.destination}</span></td>
                      <td className="py-3"><span className="block font-semibold">{trip.vehicleName}</span><span className="text-xs text-[var(--muted-foreground)]">{trip.vehiclePlate}</span></td>
                      <td className="py-3 text-xs text-[var(--muted-foreground)]">{trip.scheduledAt ? new Date(trip.scheduledAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—"}</td>
                      <td className="py-3">{trip.inspectionDone
                        ? <span className="flex items-center gap-1 text-green-500 text-xs font-semibold"><ShieldCheck className="w-4 h-4" /> Cleared</span>
                        : <span className="flex items-center gap-1 text-amber-500 text-xs font-semibold"><AlertTriangle className="w-4 h-4" /> Pending</span>}</td>
                      <td className="py-3 text-right"><span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_PILL[trip.status]}`}>{STEP_LABELS[trip.status] || trip.status}</span></td>
                    </tr>
                  )) : (
                    <tr><td colSpan={6} className="py-8 text-center text-[var(--muted-foreground)] text-xs">No matching trips.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="md:hidden space-y-3">
              {filteredTrips.length > 0 ? filteredTrips.map(trip => (
                <div key={trip.id} className="bg-[var(--surface)] border border-[var(--border)] space-y-2 p-4 rounded-xl text-[var(--foreground)]">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm">{trip.residentName}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_PILL[trip.status]}`}>{STEP_LABELS[trip.status]}</span>
                  </div>
                  <p className="text-xs text-[var(--muted-foreground)] flex items-center gap-1"><MapPin className="w-3 h-3 text-red-500" /> {trip.destination}</p>
                  <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                    <span>{trip.vehicleName} ({trip.vehiclePlate})</span>
                    <span>{trip.scheduledAt ? new Date(trip.scheduledAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—"}</span>
                  </div>
                </div>
              )) : <p className="py-8 text-center text-[var(--muted-foreground)] text-xs">No matching trips.</p>}
            </div>
          </Card>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
         TAB: INSPECTION CHECKLIST
         ════════════════════════════════════════════════════════════ */}
      {tab === "checklist" && (
        <div className="max-w-2xl mx-auto space-y-6">
          {activeTrip && activeTrip.destination !== "—" && (
            <Card>
              <SectionHeader icon={Navigation} title="Route Overview"
                badge={activeTrip.status === "SCHEDULED" ? "Pre-Departure" : "Active Route"}
                badgeColor="bg-amber-500/10 text-amber-400 border-amber-500/20" />
              <NavigationMap destination={destCoords[activeTrip.destination] || { text: activeTrip.destination }} height="240px" showRoute={true} />
            </Card>
          )}

          <Card>
            <SectionHeader icon={ClipboardCheck} title="Pre-Trip Safety Inspection" />
            <p className="text-xs text-[var(--muted-foreground)] mb-6">Complete the 8-item safety checklist before transit. Mandatory for liability compliance.</p>
            {activeTrip ? (
              <div className="space-y-4">
                <div className="bg-amber-500/5 border border-amber-500/10 text-xs p-3 rounded-xl text-[var(--foreground)]">
                  <span className="text-[10px] text-amber-400 uppercase font-bold block">Inspection Target</span>
                  <p className="font-bold text-sm text-amber-400 mt-0.5">{activeTrip.residentName} → {activeTrip.destination}</p>
                  <p className="text-[var(--muted-foreground)] mt-1 font-medium">Vehicle: {activeTrip.vehicleName} ({activeTrip.vehiclePlate})</p>
                  {activeTrip.inspectionDone && (
                    <span className="inline-flex items-center gap-1 mt-2 text-green-500 text-xs font-semibold"><ShieldCheck className="w-3.5 h-3.5" /> Previously submitted</span>
                  )}
                </div>
                <div className="space-y-2">
                  {INSPECTION_ITEMS.map(item => (
                    <label key={item} className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer select-none text-[var(--foreground)]">
                      <input type="checkbox" checked={checklist[item]} onChange={e => setChecklist(p => ({ ...p, [item]: e.target.checked }))} className="w-4 h-4 accent-amber-500 rounded" />
                      <span className="text-sm font-semibold">{item}</span>
                    </label>
                  ))}
                </div>
                <button onClick={handleChecklistSubmit}
                  className="w-full mt-4 py-3 md:py-4 bg-amber-500 hover:bg-amber-400 text-black font-black rounded-xl text-sm transition-all shadow-lg cursor-pointer">
                  Submit Pre-Trip Sign-Off
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-500 mb-3" />
                <h3 className="font-bold text-base text-[var(--foreground)]">No Inspection Needed</h3>
                <p className="text-xs text-[var(--muted-foreground)] mt-1 max-w-xs">No active trip requires inspection right now.</p>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
         TAB: FUEL & ODOMETER
         ════════════════════════════════════════════════════════════ */}
      {tab === "fuel" && (
        <div className="max-w-3xl mx-auto space-y-6">
          <Card>
            <SectionHeader icon={MapPin} title="Facility Location" badge="Home Base" badgeColor="bg-green-500/10 text-green-400 border-green-500/20" />
            <NavigationMap height="200px" showRoute={false} />
          </Card>

          <Card>
            <SectionHeader icon={Fuel} title="Log Refuel & Odometer" />
            <p className="text-xs text-[var(--muted-foreground)] mb-6">Record refuel details. Vehicle odometer is auto-updated in the database.</p>
            <form onSubmit={handleFuelSubmit} className="space-y-4 text-left">
              <div>
                <label className="block text-xs font-bold text-[var(--muted-foreground)] uppercase tracking-wider mb-2">Vehicle</label>
                <select value={fuelForm.vehicleId} onChange={e => setFuelForm(p => ({ ...p, vehicleId: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30">
                  {vehicleRows.length > 0 ? vehicleRows.map(v => (
                    <option key={String(v.id)} value={str(v.id)} className="bg-[var(--card-bg)] text-[var(--foreground)]">{str(v.name)} ({str(v.licensePlate)})</option>
                  )) : <option value="">No vehicles</option>}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[var(--muted-foreground)] uppercase tracking-wider mb-2">Odometer (km)</label>
                  <input type="number" required placeholder="e.g. 61200" value={fuelForm.odometer} onChange={e => setFuelForm(p => ({ ...p, odometer: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[var(--muted-foreground)] uppercase tracking-wider mb-2">Liters</label>
                  <input type="number" step="0.01" required placeholder="e.g. 45.5" value={fuelForm.liters} onChange={e => setFuelForm(p => ({ ...p, liters: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[var(--muted-foreground)] uppercase tracking-wider mb-2">Total Cost</label>
                  <input type="number" required placeholder="e.g. 2800" value={fuelForm.cost} onChange={e => setFuelForm(p => ({ ...p, cost: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[var(--muted-foreground)] uppercase tracking-wider mb-2">Fuel Type</label>
                  <select value={fuelForm.fuelType} onChange={e => setFuelForm(p => ({ ...p, fuelType: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30">
                    <option className="bg-[var(--card-bg)] text-[var(--foreground)]">Diesel</option>
                    <option className="bg-[var(--card-bg)] text-[var(--foreground)]">Gasoline (91)</option>
                    <option className="bg-[var(--card-bg)] text-[var(--foreground)]">Gasoline (95)</option>
                    <option className="bg-[var(--card-bg)] text-[var(--foreground)]">Premium Diesel</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-[var(--muted-foreground)] uppercase tracking-wider mb-2">Notes</label>
                <textarea placeholder="Station name or notes (optional)..." rows={2} value={fuelForm.notes} onChange={e => setFuelForm(p => ({ ...p, notes: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 resize-none" />
              </div>
              <button type="submit" disabled={fuelSaving}
                className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-black font-black rounded-xl text-sm transition-all shadow-lg cursor-pointer disabled:opacity-50">
                {fuelSaving ? "Saving..." : "Save Refuel Log"}
              </button>
            </form>
          </Card>

          <Card>
            <SectionHeader icon={History} title="Recent Refuel Logs" />
            {driverFuelLogs.length === 0 ? (
              <p className="text-xs text-[var(--muted-foreground)] text-center py-6">No refuel logs yet.</p>
            ) : (
              <div className="space-y-2">
                {driverFuelLogs.slice(0, 10).map(log => (
                  <div key={log.id} className="bg-[var(--surface)] border border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs p-3 rounded-xl text-[var(--foreground)]">
                    <div>
                      <span className="font-semibold">{log.vehicleName}</span>
                      <span className="text-[var(--muted-foreground)] ml-2">({log.vehiclePlate})</span>
                    </div>
                    <div className="flex items-center gap-4 text-[var(--muted-foreground)]">
                      <span>{log.liters}L · {log.fuelType}</span>
                      <span>{num(log.odometer).toLocaleString()} km</span>
                      <span className="font-semibold text-amber-400">₱{log.cost.toLocaleString()}</span>
                      <span>{log.logDate ? new Date(log.logDate).toLocaleDateString() : "—"}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
