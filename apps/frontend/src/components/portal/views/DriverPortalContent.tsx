"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Car, Search, Clock, ClipboardCheck, Navigation, CheckCircle2,
  AlertTriangle, Fuel, Users, ShieldCheck, MapPin, Truck, Calendar,
  Activity, Star, UserCheck, RotateCcw, History
} from "lucide-react";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord } from "@/lib/api";

interface DriverPortalContentProps {
  tab: string;
}

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
    vehicleId: str(row.vehicleId),
    vehicleName: vehicle ? str(vehicle.name, "—") : "—",
    vehiclePlate: vehicle ? str(vehicle.licensePlate, "—") : "—",
    driverId: str(row.driverId),
    driverName: driver ? str(driver.name, "—") : "—",
    escortName: str(row.escortName),
    escortRole: str(row.escortRole),
    status: str(row.status, "SCHEDULED"),
    destination: str(row.destination, "—"),
    origin: str(row.origin, "Home"),
    scheduledAt: str(row.scheduledAt),
    departedAt: str(row.departedAt),
    arrivedAt: str(row.arrivedAt),
    returnDepartedAt: str(row.returnDepartedAt),
    completedAt: str(row.completedAt),
    distanceKm: num(row.distanceKm),
    inspectionDone: bool(row.inspectionDone),
    inspectionChecklist: str(row.inspectionChecklist),
    notes: str(row.notes),
    raw: row,
  };
}

type Trip = ReturnType<typeof adaptTrip>;

function adaptFuelLog(row: Record<string, unknown>) {
  const vehicle = rec(row.vehicle);
  return {
    id: str(row.id),
    vehicleId: str(row.vehicleId),
    vehicleName: vehicle ? str(vehicle.name, "—") : "—",
    vehiclePlate: vehicle ? str(vehicle.licensePlate, "—") : "—",
    driverId: str(row.driverId),
    logDate: str(row.logDate),
    odometer: num(row.odometer),
    liters: num(row.liters),
    cost: num(row.cost),
    fuelType: str(row.fuelType, "Diesel"),
    notes: str(row.notes),
  };
}

type FuelLog = ReturnType<typeof adaptFuelLog>;

const INSPECTION_ITEMS = [
  "Tires & wheels",
  "Brakes",
  "Lights & signals",
  "Fuel level",
  "Wheelchair lift & securement",
  "Seatbelts & restraints",
  "First-aid kit & O2",
  "Interior sanitized",
];

const STATUS_PILL: Record<string, string> = {
  SCHEDULED: "bg-blue-50 text-blue-700 border-blue-200",
  INSPECTION: "bg-amber-50 text-amber-700 border-amber-200",
  EN_ROUTE: "bg-yellow-100 text-yellow-800 border-yellow-300",
  ARRIVED: "bg-purple-50 text-purple-700 border-purple-200",
  RETURNING: "bg-cyan-50 text-cyan-700 border-cyan-200",
  COMPLETED: "bg-green-50 text-green-700 border-green-200",
  CANCELLED: "bg-gray-100 text-gray-500 border-gray-200",
};

const STEP_LABELS: Record<string, string> = {
  SCHEDULED: "Scheduled",
  INSPECTION: "Inspection Done",
  EN_ROUTE: "En Route",
  ARRIVED: "Arrived",
  RETURNING: "Returning",
  COMPLETED: "Completed",
};

const TRIP_STEPS = ["SCHEDULED", "INSPECTION", "EN_ROUTE", "ARRIVED", "RETURNING", "COMPLETED"];

/* ── Compute trip hours from actual timestamps ── */
function computeTripHours(trip: Trip): number {
  if (!trip.departedAt || !trip.completedAt) return 0;
  const start = new Date(trip.departedAt).getTime();
  const end = new Date(trip.completedAt).getTime();
  if (isNaN(start) || isNaN(end) || end <= start) return 0;
  return Math.round(((end - start) / 3600000) * 10) / 10;
}

export default function DriverPortalContent({ tab }: DriverPortalContentProps) {
  /* ── Realtime queries ── */
  const { data: driverRows } = useLiveQuery("drivers", {
    query: "take=10",
    tables: ["Driver"],
  });

  const { data: tripRows, refetch: refetchTrips } = useLiveQuery("trips", {
    query: "include=resident,vehicle,driver&orderBy=scheduledAt:desc&take=300",
    tables: ["Trip", "Vehicle", "Driver", "Resident"],
  });

  const { data: vehicleRows } = useLiveQuery("vehicles", {
    query: "take=50",
    tables: ["Vehicle"],
  });

  const { data: fuelLogRows, refetch: refetchFuelLogs } = useLiveQuery("fuel-logs", {
    query: "include=vehicle&orderBy=logDate:desc&take=50",
    tables: ["FuelLog", "Vehicle"],
  });

  /* ── Session & User Resolver ── */
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string; name: string } | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");

  useEffect(() => {
    fetch("/api/auth/session")
      .then(res => res.json())
      .then(data => {
        if (data.authenticated && data.userId) {
          fetch(`/api/db/users/${data.userId}`)
            .then(res => res.json())
            .then(userRes => {
              if (userRes.success && userRes.data) {
                setCurrentUser(userRes.data);
              }
            })
            .catch(err => console.warn("Failed to fetch user:", err));
        }
      })
      .catch(err => console.warn("Failed to fetch session:", err));
  }, []);

  /* ── Resolve active driver (matches logged in user email, falls back to first driver or selector) ── */
  const activeDriver = useMemo(() => {
    if (selectedDriverId) {
      const row = driverRows.find(d => str(d.id) === selectedDriverId);
      if (row) return {
        id: str(row.id),
        name: str(row.name),
        phone: str(row.phone),
        email: str(row.email),
        safetyScore: num(row.safetyScore),
        tripHours: num(row.tripHours),
        licenseNumber: str(row.licenseNumber),
        certifications: str(row.certifications),
        isActive: bool(row.isActive),
      };
    }
    
    if (currentUser?.email) {
      const row = driverRows.find(d => str(d.email).toLowerCase() === currentUser.email.toLowerCase());
      if (row) return {
        id: str(row.id),
        name: str(row.name),
        phone: str(row.phone),
        email: str(row.email),
        safetyScore: num(row.safetyScore),
        tripHours: num(row.tripHours),
        licenseNumber: str(row.licenseNumber),
        certifications: str(row.certifications),
        isActive: bool(row.isActive),
      };
    }

    const row = driverRows[0];
    if (!row) return null;
    return {
      id: str(row.id),
      name: str(row.name),
      phone: str(row.phone),
      email: str(row.email),
      safetyScore: num(row.safetyScore),
      tripHours: num(row.tripHours),
      licenseNumber: str(row.licenseNumber),
      certifications: str(row.certifications),
      isActive: bool(row.isActive),
    };
  }, [driverRows, currentUser, selectedDriverId]);

  /* ── Filter trips for this driver ── */
  const driverTrips = useMemo<Trip[]>(() => {
    if (!activeDriver) return [];
    return tripRows.map(adaptTrip).filter(t => t.driverId === activeDriver.id);
  }, [tripRows, activeDriver?.id]);

  /* ── Active trip (first non-completed, non-cancelled) ── */
  const activeTrip = useMemo<Trip | null>(() => {
    return driverTrips.find(t => t.status !== "COMPLETED" && t.status !== "CANCELLED") || null;
  }, [driverTrips]);

  /* ── Assigned vehicle for active trip ── */
  const assignedVehicle = useMemo(() => {
    if (!activeTrip?.vehicleId) return null;
    return vehicleRows.find(v => str(v.id) === activeTrip.vehicleId) || null;
  }, [activeTrip?.vehicleId, vehicleRows]);

  /* ── Shift stats ── */
  const shiftStats = useMemo(() => {
    const total = driverTrips.length;
    const completed = driverTrips.filter(t => t.status === "COMPLETED").length;
    const pending = total - completed;
    const todayHours = driverTrips
      .filter(t => t.status === "COMPLETED")
      .reduce((sum, t) => sum + computeTripHours(t), 0);
    return { total, completed, pending, todayHours: Math.round(todayHours * 10) / 10 };
  }, [driverTrips]);

  /* ── Checklist state (loads from DB if already submitted) ── */
  const [checklist, setChecklist] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    INSPECTION_ITEMS.forEach(item => { init[item] = false; });
    return init;
  });

  // Sync checklist from active trip's inspectionChecklist when it loads
  useEffect(() => {
    if (activeTrip?.inspectionChecklist) {
      try {
        const saved = JSON.parse(activeTrip.inspectionChecklist);
        if (Array.isArray(saved)) {
          const map: Record<string, boolean> = {};
          INSPECTION_ITEMS.forEach(item => { map[item] = false; });
          saved.forEach((entry: { item: string; ok: boolean }) => {
            if (entry.item in map) map[entry.item] = entry.ok;
          });
          setChecklist(map);
        }
      } catch { /* ignore parse errors */ }
    }
  }, [activeTrip?.inspectionChecklist]);

  /* ── Fuel form state ── */
  const [fuelForm, setFuelForm] = useState({
    vehicleId: "",
    odometer: "",
    liters: "",
    cost: "",
    fuelType: "Diesel",
    notes: "",
  });
  const [fuelSaving, setFuelSaving] = useState(false);

  // Pre-fill vehicle when active trip has one
  useEffect(() => {
    if (activeTrip?.vehicleId && !fuelForm.vehicleId) {
      setFuelForm(prev => ({ ...prev, vehicleId: activeTrip.vehicleId }));
    }
  }, [activeTrip?.vehicleId]);

  // Pre-fill odometer from vehicle
  useEffect(() => {
    if (assignedVehicle && !fuelForm.odometer) {
      setFuelForm(prev => ({ ...prev, odometer: String(num(assignedVehicle.odometer)) }));
    }
  }, [assignedVehicle]);

  /* ── Search filter for trips tab ── */
  const [searchQuery, setSearchQuery] = useState("");
  const filteredTrips = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return driverTrips.filter(t =>
      t.residentName.toLowerCase().includes(q) ||
      t.destination.toLowerCase().includes(q) ||
      t.vehicleName.toLowerCase().includes(q) ||
      t.status.toLowerCase().includes(q)
    );
  }, [driverTrips, searchQuery]);

  /* ── Fuel logs for this driver ── */
  const driverFuelLogs = useMemo<FuelLog[]>(() => {
    if (!activeDriver) return [];
    return fuelLogRows.map(adaptFuelLog).filter(l => l.driverId === activeDriver.id);
  }, [fuelLogRows, activeDriver?.id]);

  /* ── Trip status transition handler ── */
  const handleTransition = async (trip: Trip, nextStatus: string) => {
    const updates: Record<string, unknown> = { status: nextStatus };
    const now = new Date().toISOString();

    if (nextStatus === "EN_ROUTE") updates.departedAt = now;
    if (nextStatus === "ARRIVED") updates.arrivedAt = now;
    if (nextStatus === "RETURNING") updates.returnDepartedAt = now;
    if (nextStatus === "COMPLETED") {
      updates.completedAt = now;
      // Compute actual trip hours from timestamps
      const departedAt = trip.departedAt ? new Date(trip.departedAt).getTime() : 0;
      const hours = departedAt ? Math.round(((Date.now() - departedAt) / 3600000) * 10) / 10 : 1.0;
      if (activeDriver) {
        await updateRecord("drivers", activeDriver.id, {
          tripHours: Math.round((activeDriver.tripHours + hours) * 10) / 10,
        });
      }
      // Return vehicle to AVAILABLE
      if (trip.vehicleId) {
        await updateRecord("vehicles", trip.vehicleId, { status: "AVAILABLE" });
      }
    }

    try {
      await updateRecord("trips", trip.id, updates);
      Swal.fire({
        title: "Status Updated",
        text: `Trip status: ${STEP_LABELS[nextStatus] || nextStatus}`,
        icon: "success",
        toast: true,
        position: "top-end",
        timer: 3000,
        showConfirmButton: false,
      });
      refetchTrips();
    } catch {
      Swal.fire("Error", "Could not update trip status.", "error");
    }
  };

  /* ── Submit Pre-Trip Inspection ── */
  const handleChecklistSubmit = async () => {
    if (!activeTrip) {
      Swal.fire("No Active Trip", "No upcoming trip requires inspection.", "warning");
      return;
    }
    const unchecked = INSPECTION_ITEMS.filter(item => !checklist[item]);
    if (unchecked.length > 0) {
      Swal.fire({
        title: "Incomplete Checklist",
        text: `Please confirm all safety items. Missing: ${unchecked.length}`,
        icon: "warning",
      });
      return;
    }
    try {
      await updateRecord("trips", activeTrip.id, {
        inspectionDone: true,
        inspectionChecklist: JSON.stringify(INSPECTION_ITEMS.map(item => ({ item, ok: true }))),
        status: "INSPECTION",
      });
      Swal.fire({
        title: "Inspection Submitted",
        text: "Vehicle cleared. You may depart.",
        icon: "success",
      });
      refetchTrips();
    } catch {
      Swal.fire("Error", "Failed to submit checklist.", "error");
    }
  };

  /* ── Submit Fuel Log ── */
  const handleFuelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fuelForm.vehicleId || !fuelForm.odometer || !fuelForm.liters || !fuelForm.cost) {
      Swal.fire("Missing Fields", "Complete all required fuel fields.", "warning");
      return;
    }
    setFuelSaving(true);
    try {
      await createRecord("fuel-logs", {
        vehicleId: fuelForm.vehicleId,
        driverId: activeDriver?.id || null,
        logDate: new Date().toISOString(),
        odometer: Number(fuelForm.odometer),
        liters: Number(fuelForm.liters),
        cost: Number(fuelForm.cost),
        fuelType: fuelForm.fuelType,
        notes: fuelForm.notes || null,
      });
      // Auto-update vehicle odometer
      await updateRecord("vehicles", fuelForm.vehicleId, {
        odometer: Number(fuelForm.odometer),
      });
      Swal.fire("Refuel Logged", "Vehicle mileage updated.", "success");
      setFuelForm(prev => ({ ...prev, odometer: "", liters: "", cost: "", notes: "" }));
      refetchFuelLogs();
    } catch {
      Swal.fire("Error", "Could not submit fuel log.", "error");
    } finally {
      setFuelSaving(false);
    }
  };

  /* ════════════════════════════════════════════════════════════════
     LOADING STATE
     ════════════════════════════════════════════════════════════════ */
  if (!activeDriver) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-gray-500">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500 mb-4" />
        <span className="text-sm font-semibold">Loading driver profile...</span>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════ */
  return (
    <div className="w-full max-w-[100%] mx-auto space-y-6 p-4 md:p-6 text-slate-800 dark:text-zinc-100">

      {/* ── DRIVER IDENTITY CARD ── */}
      <div className="bg-card-bg border border-card-border shadow-[0_8px_30px_rgb(0,0,0,0.02)] flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 md:p-6 rounded-2xl transition-all duration-300">
        <div className="flex items-center gap-3 md:gap-4">
          <div className="w-12 h-12 md:w-14 md:h-14 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
            <Car className="w-6 h-6 md:w-7 md:h-7" />
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-bold flex items-center gap-2 flex-wrap text-slate-800 dark:text-zinc-100">
              {activeDriver.name}
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                Driver
              </span>
              {driverRows.length > 1 && (
                <div className="flex items-center gap-1.5 ml-2">
                  <span className="text-[9px] uppercase font-extrabold tracking-wider text-slate-400 dark:text-zinc-500">Profile:</span>
                  <select
                    value={activeDriver?.id || ""}
                    onChange={e => setSelectedDriverId(e.target.value)}
                    className="text-[11px] bg-slate-50 dark:bg-zinc-800/80 border border-slate-200 dark:border-zinc-700 rounded-lg px-2 py-1 font-bold focus:outline-none focus:border-amber-500/50 text-slate-700 dark:text-zinc-200 cursor-pointer transition-colors"
                  >
                    {driverRows.map(d => (
                      <option key={str(d.id)} value={str(d.id)} className="bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-100">
                        {str(d.name)} {str(d.email).toLowerCase() === currentUser?.email?.toLowerCase() ? "(You)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </h1>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
              License: {activeDriver.licenseNumber}
              {activeDriver.certifications && <span className="ml-2">| {activeDriver.certifications}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 md:gap-6">
          <div className="text-left sm:text-right">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-zinc-500 block">Safety Score</span>
            <span className="text-lg md:text-xl font-black text-green-600 dark:text-green-500 flex items-center gap-1 mt-0.5">
              <Star className="w-4 h-4 fill-green-600 dark:fill-green-500" /> {activeDriver.safetyScore}%
            </span>
          </div>
          <div className="text-left sm:text-right">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-zinc-500 block">Trip Hours</span>
            <span className="text-lg md:text-xl font-black text-amber-600 dark:text-amber-500 flex items-center gap-1 mt-0.5">
              <Clock className="w-4 h-4" /> {activeDriver.tripHours}
            </span>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════
         TAB: DASHBOARD
         ════════════════════════════════════════════════════════════ */}
      {tab === "dashboard" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Active Trip + Status Controller */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-card-bg border border-card-border shadow-[0_8px_30px_rgb(0,0,0,0.02)] flex flex-col justify-between min-h-[380px] p-5 md:p-6 rounded-2xl transition-all duration-300">
              <div>
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800/80 pb-4 mb-4">
                  <h2 className="text-base md:text-lg font-bold flex items-center gap-2 text-slate-800 dark:text-zinc-100">
                    <Navigation className="w-5 h-5 text-amber-500" /> Active Trip
                  </h2>
                  {activeTrip && (
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_PILL[activeTrip.status]}`}>
                      {STEP_LABELS[activeTrip.status] || activeTrip.status}
                    </span>
                  )}
                </div>

                {activeTrip ? (
                  <div className="space-y-4 text-left">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-semibold block uppercase">Resident</span>
                        <p className="font-bold text-sm text-slate-800 dark:text-zinc-200">{activeTrip.residentName}</p>
                        <p className="text-xs text-slate-500 dark:text-zinc-400">Room {activeTrip.roomNumber}</p>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-semibold block uppercase">Destination</span>
                        <p className="font-bold text-sm flex items-center gap-1 text-slate-800 dark:text-zinc-200">
                          <MapPin className="w-3.5 h-3.5 text-red-500" /> {activeTrip.destination}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-100 dark:border-zinc-800/80 pt-4">
                      <div>
                        <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-semibold block uppercase">Vehicle</span>
                        <p className="font-bold text-sm flex items-center gap-1.5 text-slate-800 dark:text-zinc-200">
                          <Truck className="w-4 h-4 text-amber-500" /> {activeTrip.vehicleName}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-zinc-400">Plate: {activeTrip.vehiclePlate}</p>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-semibold block uppercase">Staff Escort</span>
                        <p className="font-bold text-sm flex items-center gap-1 text-slate-800 dark:text-zinc-200">
                          <UserCheck className="w-4 h-4 text-blue-500 dark:text-blue-400" /> {activeTrip.escortName || "No Escort"}
                        </p>
                        {activeTrip.escortRole && <p className="text-xs text-slate-500 dark:text-zinc-400">{activeTrip.escortRole}</p>}
                      </div>
                    </div>

                    {/* Trip Progress Stepper */}
                    <div className="border-t border-slate-100 dark:border-zinc-800/80 pt-4">
                      <div className="flex items-center gap-1 overflow-x-auto pb-2">
                        {TRIP_STEPS.map((step, i) => {
                          const currentIdx = TRIP_STEPS.indexOf(activeTrip.status);
                          const isDone = i <= currentIdx;
                          const isCurrent = i === currentIdx;
                          return (
                            <div key={step} className="flex items-center gap-1 shrink-0">
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border ${
                                isDone ? "bg-amber-500 border-amber-500 text-black" : "bg-transparent border-slate-200 text-slate-400 dark:border-zinc-800 dark:text-zinc-500"
                              } ${isCurrent ? "ring-2 ring-amber-500/50" : ""}`}>
                                {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
                              </div>
                              {i < TRIP_STEPS.length - 1 && (
                                <div className={`w-4 sm:w-8 h-0.5 ${isDone ? "bg-amber-500" : "bg-slate-100 dark:bg-zinc-800"}`} />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {activeTrip.notes && (
                      <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-800/20 border border-slate-100 dark:border-zinc-800/50 text-xs text-slate-600 dark:text-zinc-400">
                        <strong>Dispatch Notes:</strong> {activeTrip.notes}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <CheckCircle2 className="w-12 h-12 text-green-500 mb-3" />
                    <h3 className="font-bold text-base text-slate-800 dark:text-zinc-200">All Clear</h3>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 max-w-xs">
                      No active trips assigned. Enjoy your break.
                    </p>
                  </div>
                )}
              </div>

              {/* ── STATUS CONTROLLER ── */}
              {activeTrip && (
                <div className="border-t border-slate-100 dark:border-zinc-800/80 pt-4 mt-4">
                  {activeTrip.status === "SCHEDULED" && (
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex flex-col sm:flex-row items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 shrink-0" />
                        <div className="text-left">
                          <p className="text-xs font-bold">Inspection Required</p>
                          <p className="text-[10px] opacity-80">Complete the pre-trip safety checklist before departure.</p>
                        </div>
                      </div>
                      <a href="#checklist" className="px-4 py-2 bg-amber-500 text-black hover:bg-amber-400 font-bold rounded-xl text-xs transition shrink-0">
                        Go to Checklist
                      </a>
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
            </div>
          </div>

          {/* ── SHIFT TELEMETRY + VEHICLE INFO ── */}
          <div className="space-y-6">
            <div className="bg-card-bg border border-card-border shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-5 md:p-6 rounded-2xl transition-all duration-300">
              <h2 className="text-sm md:text-base font-bold flex items-center gap-2 mb-4 text-slate-800 dark:text-zinc-100">
                <Activity className="w-4 h-4 text-amber-500" /> Shift Telemetry
              </h2>
              <div className="space-y-3">
                {[
                  { label: "Today's Trips", value: shiftStats.total, icon: Calendar, color: "text-slate-800 dark:text-zinc-200" },
                  { label: "Pending Transit", value: shiftStats.pending, icon: Clock, color: "text-amber-600 dark:text-amber-400" },
                  { label: "Completed", value: shiftStats.completed, icon: CheckCircle2, color: "text-green-600 dark:text-green-500" },
                  { label: "Hours Logged", value: `${shiftStats.todayHours}h`, icon: Clock, color: "text-blue-600 dark:text-blue-400" },
                ].map(stat => (
                  <div key={stat.label} className="bg-slate-50/50 dark:bg-zinc-800/15 border border-slate-100 dark:border-zinc-800/50 flex items-center justify-between p-3 rounded-xl">
                    <div>
                      <span className="text-[10px] text-slate-400 dark:text-zinc-500 block font-semibold uppercase">{stat.label}</span>
                      <span className={`text-lg font-bold ${stat.color}`}>{stat.value}</span>
                    </div>
                    <stat.icon className="w-5 h-5 text-slate-400 dark:text-zinc-500 opacity-70" />
                  </div>
                ))}
              </div>
            </div>

            {/* Vehicle Info */}
            {assignedVehicle && (
              <div className="bg-card-bg border border-card-border shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-5 md:p-6 rounded-2xl transition-all duration-300">
                <h2 className="text-sm md:text-base font-bold flex items-center gap-2 mb-4 text-slate-800 dark:text-zinc-100">
                  <Truck className="w-4 h-4 text-amber-500" /> Assigned Vehicle
                </h2>
                <div className="space-y-3">
                  <div className="bg-slate-50/50 dark:bg-zinc-800/15 border border-slate-100 dark:border-zinc-800/50 p-3 rounded-xl">
                    <span className="text-[10px] text-slate-400 dark:text-zinc-500 block font-semibold uppercase">Vehicle</span>
                    <p className="font-bold text-sm text-slate-800 dark:text-zinc-200">{str(assignedVehicle.name)} ({str(assignedVehicle.licensePlate)})</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50/50 dark:bg-zinc-800/15 border border-slate-100 dark:border-zinc-800/50 p-3 rounded-xl">
                      <span className="text-[10px] text-slate-400 dark:text-zinc-500 block font-semibold uppercase">Odometer</span>
                      <p className="font-bold text-sm text-slate-800 dark:text-zinc-200">{num(assignedVehicle.odometer).toLocaleString()} km</p>
                    </div>
                    <div className="bg-slate-50/50 dark:bg-zinc-800/15 border border-slate-100 dark:border-zinc-800/50 p-3 rounded-xl">
                      <span className="text-[10px] text-slate-400 dark:text-zinc-500 block font-semibold uppercase">Fuel Level</span>
                      <p className="font-bold text-sm text-slate-800 dark:text-zinc-200">{num(assignedVehicle.fuelLevel)}%</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
         TAB: TRIPS
         ════════════════════════════════════════════════════════════ */}
      {tab === "trips" && (
        <div className="bg-card-bg border border-card-border shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-5 md:p-6 rounded-2xl transition-all duration-300">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
            <h2 className="text-base md:text-lg font-bold flex items-center gap-2 text-slate-800 dark:text-zinc-100">
              <Navigation className="w-5 h-5 text-amber-500" /> Trip Board
            </h2>
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-400 dark:text-zinc-500 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search trips..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 dark:bg-zinc-800/40 border border-slate-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-xl focus:outline-none focus:border-amber-500/50"
              />
            </div>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-zinc-800/80 text-slate-400 dark:text-zinc-500 text-xs font-bold uppercase">
                  <th className="pb-3">Resident</th>
                  <th className="pb-3">Destination</th>
                  <th className="pb-3">Vehicle</th>
                  <th className="pb-3">Scheduled</th>
                  <th className="pb-3">Inspection</th>
                  <th className="pb-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/80 text-slate-800 dark:text-zinc-200">
                {filteredTrips.length > 0 ? filteredTrips.map(trip => (
                  <tr key={trip.id} className="hover:bg-slate-50/50 dark:hover:bg-zinc-800/15 border-b border-slate-100/50 dark:border-zinc-800/30 transition-colors">
                    <td className="py-3">
                      <span className="font-semibold block">{trip.residentName}</span>
                      <span className="text-xs text-slate-500 dark:text-zinc-400">Rm {trip.roomNumber}</span>
                    </td>
                    <td className="py-3">
                      <span className="font-semibold flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-red-500" /> {trip.destination}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className="block font-semibold">{trip.vehicleName}</span>
                      <span className="text-xs text-slate-500 dark:text-zinc-400">{trip.vehiclePlate}</span>
                    </td>
                    <td className="py-3 text-xs text-slate-600 dark:text-zinc-300">
                      {trip.scheduledAt ? new Date(trip.scheduledAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—"}
                    </td>
                    <td className="py-3">
                      {trip.inspectionDone
                        ? <span className="flex items-center gap-1 text-green-600 dark:text-green-500 text-xs font-semibold"><ShieldCheck className="w-4 h-4" /> Cleared</span>
                        : <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500 text-xs font-semibold"><AlertTriangle className="w-4 h-4" /> Pending</span>}
                    </td>
                    <td className="py-3 text-right">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_PILL[trip.status]}`}>
                        {STEP_LABELS[trip.status] || trip.status}
                      </span>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="py-8 text-center text-slate-400 dark:text-zinc-500 text-xs">No matching trips.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {filteredTrips.length > 0 ? filteredTrips.map(trip => (
              <div key={trip.id} className="bg-slate-50/50 dark:bg-zinc-800/15 border border-slate-100 dark:border-zinc-800/50 space-y-2 p-4 rounded-xl text-slate-800 dark:text-zinc-200">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm">{trip.residentName}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_PILL[trip.status]}`}>
                    {STEP_LABELS[trip.status]}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-zinc-400 flex items-center gap-1"><MapPin className="w-3 h-3 text-red-500" /> {trip.destination}</p>
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400">
                  <span>{trip.vehicleName} ({trip.vehiclePlate})</span>
                  <span>{trip.scheduledAt ? new Date(trip.scheduledAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—"}</span>
                </div>
              </div>
            )) : (
              <p className="py-8 text-center text-slate-400 dark:text-zinc-500 text-xs">No matching trips.</p>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
         TAB: INSPECTION CHECKLIST
         ════════════════════════════════════════════════════════════ */}
      {tab === "checklist" && (
        <div id="checklist" className="max-w-2xl mx-auto bg-card-bg border border-card-border shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-5 md:p-6 rounded-2xl transition-all duration-300">
          <h2 className="text-base md:text-lg font-bold flex items-center gap-2 mb-2 text-slate-800 dark:text-zinc-100">
            <ClipboardCheck className="w-5 h-5 text-amber-500" /> Pre-Trip Safety Inspection
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mb-6">
            Complete the 8-item safety checklist before transit. Mandatory for liability compliance.
          </p>

          {activeTrip ? (
            <div className="space-y-4">
              <div className="bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/10 dark:border-amber-500/20 text-xs p-3 rounded-xl text-slate-700 dark:text-zinc-300">
                <span className="text-[10px] text-amber-700 dark:text-amber-400 uppercase font-bold block">Inspection Target</span>
                <p className="font-bold text-sm text-amber-600 dark:text-amber-400 mt-0.5">{activeTrip.residentName} → {activeTrip.destination}</p>
                <p className="text-slate-500 dark:text-zinc-400 mt-1 font-medium">Vehicle: {activeTrip.vehicleName} ({activeTrip.vehiclePlate})</p>
                {activeTrip.inspectionDone && (
                  <span className="inline-flex items-center gap-1 mt-2 text-green-600 dark:text-green-500 text-xs font-semibold">
                    <ShieldCheck className="w-3.5 h-3.5" /> Previously submitted
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {INSPECTION_ITEMS.map(item => (
                  <label key={item} className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 dark:border-zinc-800 bg-slate-50/30 dark:bg-zinc-800/10 hover:bg-slate-50/70 dark:hover:bg-zinc-800/20 transition-colors cursor-pointer select-none text-slate-800 dark:text-zinc-200">
                    <input
                      type="checkbox"
                      checked={checklist[item]}
                      onChange={e => setChecklist(prev => ({ ...prev, [item]: e.target.checked }))}
                      className="w-4 h-4 accent-amber-500 rounded"
                    />
                    <span className="text-sm font-semibold">{item}</span>
                  </label>
                ))}
              </div>

              <button
                onClick={handleChecklistSubmit}
                className="w-full mt-4 py-3 md:py-4 bg-amber-500 hover:bg-amber-400 text-black font-black rounded-xl text-sm transition-all shadow-lg cursor-pointer"
              >
                Submit Pre-Trip Sign-Off
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-500 mb-3" />
              <h3 className="font-bold text-base text-slate-800 dark:text-zinc-200">No Inspection Needed</h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 max-w-xs">
                No active trip requires inspection right now.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
         TAB: FUEL & ODOMETER
         ════════════════════════════════════════════════════════════ */}
      {tab === "fuel" && (
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Fuel Log Form */}
          <div className="bg-card-bg border border-card-border shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-5 md:p-6 rounded-2xl transition-all duration-300">
            <h2 className="text-base md:text-lg font-bold flex items-center gap-2 mb-2 text-slate-800 dark:text-zinc-100">
              <Fuel className="w-5 h-5 text-amber-500" /> Log Refuel & Odometer
            </h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mb-6">
              Record refuel details. Vehicle odometer is auto-updated in the database.
            </p>

            <form onSubmit={handleFuelSubmit} className="space-y-4 text-left">
              <div>
                <label className="block text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-2">Vehicle</label>
                <select
                  value={fuelForm.vehicleId}
                  onChange={e => setFuelForm(prev => ({ ...prev, vehicleId: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800/40 border border-slate-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 text-sm focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30"
                >
                  {vehicleRows.length > 0 ? (
                    vehicleRows.map(v => (
                      <option key={String(v.id)} value={str(v.id)} className="bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-100">{str(v.name)} ({str(v.licensePlate)})</option>
                    ))
                  ) : <option value="">No vehicles</option>}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-2">Odometer (km)</label>
                  <input type="number" required placeholder="e.g. 61200" value={fuelForm.odometer} onChange={e => setFuelForm(prev => ({ ...prev, odometer: e.target.value }))} className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800/40 border border-slate-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 text-sm focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-2">Liters</label>
                  <input type="number" step="0.01" required placeholder="e.g. 45.5" value={fuelForm.liters} onChange={e => setFuelForm(prev => ({ ...prev, liters: e.target.value }))} className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800/40 border border-slate-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 text-sm focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-2">Total Cost</label>
                  <input type="number" required placeholder="e.g. 2800" value={fuelForm.cost} onChange={e => setFuelForm(prev => ({ ...prev, cost: e.target.value }))} className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800/40 border border-slate-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 text-sm focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-2">Fuel Type</label>
                  <select value={fuelForm.fuelType} onChange={e => setFuelForm(prev => ({ ...prev, fuelType: e.target.value }))} className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800/40 border border-slate-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 text-sm focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30">
                    <option className="bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-100">Diesel</option>
                    <option className="bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-100">Gasoline (91)</option>
                    <option className="bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-100">Gasoline (95)</option>
                    <option className="bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-100">Premium Diesel</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-2">Notes</label>
                <textarea placeholder="Station name or notes (optional)..." rows={2} value={fuelForm.notes} onChange={e => setFuelForm(prev => ({ ...prev, notes: e.target.value }))} className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800/40 border border-slate-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 text-sm focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 resize-none" />
              </div>

              <button type="submit" disabled={fuelSaving} className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-black font-black rounded-xl text-sm transition-all shadow-lg cursor-pointer disabled:opacity-50">
                {fuelSaving ? "Saving..." : "Save Refuel Log"}
              </button>
            </form>
          </div>

          {/* Recent Fuel Logs */}
          <div className="bg-card-bg border border-card-border shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-5 md:p-6 rounded-2xl transition-all duration-300">
            <h2 className="text-sm md:text-base font-bold flex items-center gap-2 mb-4 text-slate-800 dark:text-zinc-100">
              <History className="w-4 h-4 text-amber-500" /> Recent Refuel Logs
            </h2>
            {driverFuelLogs.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-zinc-500 text-center py-6">No refuel logs yet.</p>
            ) : (
              <div className="space-y-2">
                {driverFuelLogs.slice(0, 10).map(log => (
                  <div key={log.id} className="bg-slate-50/50 dark:bg-zinc-800/15 border border-slate-100 dark:border-zinc-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs p-3 rounded-xl text-slate-800 dark:text-zinc-200">
                    <div>
                      <span className="font-semibold">{log.vehicleName}</span>
                      <span className="text-slate-500 dark:text-zinc-400 ml-2">({log.vehiclePlate})</span>
                    </div>
                    <div className="flex items-center gap-4 text-slate-500 dark:text-zinc-400">
                      <span>{log.liters}L · {log.fuelType}</span>
                      <span>{num(log.odometer).toLocaleString()} km</span>
                      <span className="font-semibold text-amber-600 dark:text-amber-400">₱{log.cost.toLocaleString()}</span>
                      <span>{log.logDate ? new Date(log.logDate).toLocaleDateString() : "—"}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
