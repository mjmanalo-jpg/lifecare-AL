"use client";

import { useMemo, useState } from "react";
import {
  Bus, Plus, RefreshCw, X, MapPin, Clock, CheckCircle, AlertTriangle,
  Accessibility, Stethoscope, Droplets, HeartPulse, TreePine, Siren,
  Navigation, User, Car, ArrowLeftRight,
  type LucideIcon,
} from "lucide-react";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord } from "@/lib/api";

/**
 * Shared Family/Resident "Transport" view. The /api/db layer scopes
 * transport-requests, trips, and residents to the signed-in sponsor's
 * resident(s) (FAMILY) or the resident's own record (RESIDENT), so this
 * component simply renders whatever it is allowed to see — live.
 */

type Row = Record<string, unknown>;

const TYPE_META: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  MEDICAL_APPOINTMENT: { label: "Medical Appointment", icon: Stethoscope, color: "text-blue-600 bg-blue-50 border-blue-200" },
  DIALYSIS: { label: "Dialysis Run", icon: Droplets, color: "text-cyan-600 bg-cyan-50 border-cyan-200" },
  THERAPY: { label: "Therapy Run", icon: HeartPulse, color: "text-purple-600 bg-purple-50 border-purple-200" },
  FAMILY_OUTING: { label: "Family Outing", icon: TreePine, color: "text-green-600 bg-green-50 border-green-200" },
  EMERGENCY_TRANSFER: { label: "Emergency Transfer", icon: Siren, color: "text-red-600 bg-red-50 border-red-200" },
  OTHER: { label: "Other", icon: Bus, color: "text-gray-600 bg-gray-50 border-gray-200" },
};

const REQUEST_STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  APPROVED: "bg-blue-100 text-blue-700",
  SCHEDULED: "bg-indigo-100 text-indigo-700",
  DECLINED: "bg-red-100 text-red-700",
  COMPLETED: "bg-green-100 text-green-700",
  CANCELLED: "bg-gray-100 text-gray-600",
};

const TRIP_STEPS = ["SCHEDULED", "INSPECTION", "EN_ROUTE", "ARRIVED", "RETURNING", "COMPLETED"];
const TRIP_STEP_LABELS: Record<string, string> = {
  SCHEDULED: "Scheduled",
  INSPECTION: "Safety Inspection",
  EN_ROUTE: "En Route",
  ARRIVED: "Arrived",
  RETURNING: "Return Trip",
  COMPLETED: "Dropped Off",
  CANCELLED: "Cancelled",
};

const FACILITY = "Golden Hearth Facility";
const emptyForm = {
  type: "MEDICAL_APPOINTMENT",
  pickupLocation: FACILITY,
  dropoffLocation: "",
  purpose: "",
  requestedDate: "",
  returnRequired: true,
  wheelchairNeeded: false,
  escortRequired: false,
  escortRole: "NURSE",
  notes: "",
};

function timeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return "";
  }
}

export default function MyTransport() {
  const { data: residents } = useLiveQuery<Row>("residents", {
    query: "take=10",
    tables: ["Resident"],
  });
  const { data: requestRows, loading: reqLoading, error, refetch } = useLiveQuery<Row>(
    "transport-requests",
    { query: "include=trip&take=100", tables: ["TransportRequest", "Trip"] }
  );
  const { data: tripRows, refetch: refetchTrips } = useLiveQuery<Row>("trips", {
    query: "include=vehicle,driver&take=100",
    tables: ["Trip", "Vehicle", "Driver"],
    pollMs: 10000, // keep live GPS fresh even without realtime
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [residentId, setResidentId] = useState<string>("");

  const resolvedResidentId = residentId || String(residents[0]?.id ?? "");
  const residentName = useMemo(() => {
    const r = residents.find((x) => String(x.id) === resolvedResidentId) ?? residents[0];
    return r ? `${String(r.firstName ?? "")} ${String(r.lastName ?? "")}`.trim() : "your relative";
  }, [residents, resolvedResidentId]);

  const requests = useMemo(
    () =>
      [...requestRows].sort(
        (a, b) => new Date(String(b.createdAt ?? 0)).getTime() - new Date(String(a.createdAt ?? 0)).getTime()
      ),
    [requestRows]
  );

  const activeTrips = useMemo(
    () => tripRows.filter((t) => ["SCHEDULED", "INSPECTION", "EN_ROUTE", "ARRIVED", "RETURNING"].includes(String(t.status))),
    [tripRows]
  );

  const stats = useMemo(
    () => ({
      pending: requests.filter((r) => r.status === "PENDING").length,
      scheduled: requests.filter((r) => r.status === "SCHEDULED" || r.status === "APPROVED").length,
      live: activeTrips.filter((t) => ["EN_ROUTE", "ARRIVED", "RETURNING"].includes(String(t.status))).length,
      completed: requests.filter((r) => r.status === "COMPLETED").length,
    }),
    [requests, activeTrips]
  );

  const handleSubmit = async () => {
    if (!form.pickupLocation || !form.dropoffLocation || !form.requestedDate) {
      Swal.fire({ title: "Missing Fields", text: "Pickup, drop-off and date/time are required.", icon: "warning" });
      return;
    }
    if (!resolvedResidentId) {
      Swal.fire({ title: "No Resident Linked", text: "Your account has no linked resident yet.", icon: "warning" });
      return;
    }
    try {
      await createRecord("transport-requests", {
        residentId: resolvedResidentId,
        type: form.type,
        pickupLocation: form.pickupLocation,
        dropoffLocation: form.dropoffLocation,
        destination: form.dropoffLocation,
        purpose: form.purpose || null,
        requestedDate: new Date(form.requestedDate).toISOString(),
        returnRequired: form.returnRequired,
        wheelchairNeeded: form.wheelchairNeeded,
        escortRequired: form.escortRequired,
        escortRole: form.escortRequired ? form.escortRole : null,
        priority: form.type === "EMERGENCY_TRANSFER" ? "EMERGENCY" : "NORMAL",
        status: "PENDING",
        source: "PORTAL",
        notes: form.notes || null,
      });
      await refetch();
      setShowForm(false);
      setForm(emptyForm);
      Swal.fire({
        title: "Request Sent",
        text: "The transport dispatcher has been notified and will review your request.",
        icon: "success",
        timer: 2000,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire({ title: "Request Failed", text: err instanceof Error ? err.message : "Could not send request.", icon: "error" });
    }
  };

  const set = (field: string, value: unknown) => setForm((f) => ({ ...f, [field]: value }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Transport
          </h1>
          <p className="text-gray-600">Request rides for {residentName} and follow every trip live</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { void refetch(); void refetchTrips(); }} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
            <Plus className="w-4 h-4" /> Request Transport
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Pending Review" value={String(stats.pending)} icon={Clock} color="amber" />
        <StatBox label="Scheduled" value={String(stats.scheduled)} icon={Bus} color="blue" />
        <StatBox label="Live Now" value={String(stats.live)} icon={Navigation} color="green" />
        <StatBox label="Completed" value={String(stats.completed)} icon={CheckCircle} color="purple" />
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* Live / upcoming trips */}
      {activeTrips.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Navigation className="w-5 h-5 text-green-600" /> Trips In Motion
          </h2>
          {activeTrips.map((trip) => {
            const status = String(trip.status);
            const vehicle = trip.vehicle as Row | undefined;
            const driver = trip.driver as Row | undefined;
            const live = ["EN_ROUTE", "ARRIVED", "RETURNING"].includes(status);
            const stepIndex = TRIP_STEPS.indexOf(status);
            return (
              <div key={String(trip.id)} className={`bg-white rounded-lg border p-4 space-y-3 ${live ? "border-green-300 ring-1 ring-green-200" : "border-gray-200"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold text-gray-900">
                    <MapPin className="w-4 h-4 text-yellow-500" />
                    {String(trip.pickupLocation ?? trip.origin ?? "Facility")} → {String(trip.dropoffLocation ?? trip.destination ?? "")}
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${live ? "bg-green-100 text-green-700" : "bg-indigo-100 text-indigo-700"}`}>
                    {live && <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse mr-1.5" />}
                    {TRIP_STEP_LABELS[status] ?? status}
                  </span>
                </div>

                {/* Progress stepper */}
                <div className="flex items-center gap-1">
                  {TRIP_STEPS.map((step, i) => (
                    <div key={step} className="flex-1 flex items-center gap-1">
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${i <= stepIndex ? "bg-yellow-500" : "bg-gray-200"}`} />
                      {i < TRIP_STEPS.length - 1 && <div className={`h-0.5 flex-1 ${i < stepIndex ? "bg-yellow-400" : "bg-gray-200"}`} />}
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-gray-500 -mt-1">
                  <span>Scheduled</span><span>Inspection</span><span>En Route</span><span>Arrived</span><span>Return</span><span>Drop-Off</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                  <div className="flex items-center gap-2 text-gray-700">
                    <Car className="w-4 h-4 text-gray-400" />
                    {vehicle ? `${String(vehicle.name ?? "")} · ${String(vehicle.licensePlate ?? "")}` : "Vehicle pending"}
                  </div>
                  <div className="flex items-center gap-2 text-gray-700">
                    <User className="w-4 h-4 text-gray-400" />
                    {driver ? String(driver.name ?? "") : "Driver pending"}
                  </div>
                  <div className="flex items-center gap-2 text-gray-700">
                    <Clock className="w-4 h-4 text-gray-400" />
                    {trip.scheduledAt ? new Date(String(trip.scheduledAt)).toLocaleString() : "—"}
                  </div>
                </div>

                {live && trip.lastPingAt ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-800 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="font-bold flex items-center gap-1"><Navigation className="w-3.5 h-3.5" /> Live GPS</span>
                    <span>Lat {Number(trip.currentLat ?? 0).toFixed(5)}, Lng {Number(trip.currentLng ?? 0).toFixed(5)}</span>
                    <span>Last ping {timeAgo(String(trip.lastPingAt))}</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Request history */}
      <div className="space-y-3">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <Bus className="w-5 h-5 text-yellow-500" /> My Requests
        </h2>
        {reqLoading && requests.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading transport requests…</div>
        ) : requests.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">
            No transport requests yet. Use “Request Transport” to book a ride for {residentName}.
          </div>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => {
              const meta = TYPE_META[String(r.type)] ?? TYPE_META.OTHER;
              const Icon = meta.icon;
              const status = String(r.status);
              return (
                <div key={String(r.id)} className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap items-center gap-3 hover:shadow-sm transition">
                  <div className={`w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 ${meta.color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-[180px]">
                    <p className="text-sm font-semibold text-gray-900">{meta.label}</p>
                    <p className="text-xs text-gray-600 flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-gray-400 flex-shrink-0" />
                      {String(r.pickupLocation ?? "Facility")} → {String(r.dropoffLocation ?? r.destination ?? "")}
                    </p>
                    <p className="text-xs text-gray-500">
                      {r.requestedDate ? new Date(String(r.requestedDate)).toLocaleString() : "—"}
                      {r.returnRequired ? " · round trip" : " · one way"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {Boolean(r.wheelchairNeeded) && <span title="Wheelchair needed"><Accessibility className="w-4 h-4 text-blue-500" /></span>}
                    {Boolean(r.escortRequired) && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-600">Escort</span>}
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${REQUEST_STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}>
                      {status}
                    </span>
                  </div>
                  {status === "DECLINED" && r.declineReason ? (
                    <p className="w-full text-xs text-red-600 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> {String(r.declineReason)}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Request modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold">Request Transport</h2>
              <button onClick={() => setShowForm(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              {residents.length > 1 && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Resident</label>
                  <select value={resolvedResidentId} onChange={(e) => setResidentId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    {residents.map((r) => (
                      <option key={String(r.id)} value={String(r.id)}>
                        {String(r.firstName ?? "")} {String(r.lastName ?? "")} — Room {String(r.roomNumber ?? "")}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Trip Type</label>
                  <select value={form.type} onChange={(e) => set("type", e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Date & Time</label>
                  <input type="datetime-local" value={form.requestedDate} onChange={(e) => set("requestedDate", e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-semibold text-gray-700">Pickup &amp; Drop-off</label>
                    <button type="button" onClick={() => setForm((f) => ({ ...f, pickupLocation: f.dropoffLocation, dropoffLocation: f.pickupLocation }))}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-yellow-700 hover:text-yellow-800" title="Swap pickup & drop-off">
                      <ArrowLeftRight className="w-3.5 h-3.5" /> Swap
                    </button>
                  </div>
                  <div className="space-y-2">
                    <div className="relative">
                      <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-green-500" />
                      <input type="text" value={form.pickupLocation} onChange={(e) => set("pickupLocation", e.target.value)} placeholder="Pickup — e.g. Golden Hearth Facility" className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                    </div>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-red-500" />
                      <input type="text" value={form.dropoffLocation} onChange={(e) => set("dropoffLocation", e.target.value)} placeholder="Drop-off — e.g. St. Luke's Medical Center" className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                    </div>
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Purpose</label>
                  <input type="text" value={form.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="e.g. Cardiology follow-up with Dr. Reyes" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg cursor-pointer text-sm select-none">
                  <input type="checkbox" checked={form.returnRequired} onChange={(e) => set("returnRequired", e.target.checked)} className="rounded" />
                  Round trip
                </label>
                <label className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg cursor-pointer text-sm select-none">
                  <input type="checkbox" checked={form.wheelchairNeeded} onChange={(e) => set("wheelchairNeeded", e.target.checked)} className="rounded" />
                  <Accessibility className="w-4 h-4 text-blue-500" /> Wheelchair
                </label>
                <label className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg cursor-pointer text-sm select-none">
                  <input type="checkbox" checked={form.escortRequired} onChange={(e) => set("escortRequired", e.target.checked)} className="rounded" />
                  Escort needed
                </label>
              </div>
              {form.escortRequired && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Escort Preference</label>
                  <select value={form.escortRole} onChange={(e) => set("escortRole", e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    <option value="NURSE">Nurse</option>
                    <option value="CAREGIVER">Caregiver</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Notes for the Dispatcher</label>
                <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setShowForm(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
              <button onClick={handleSubmit} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">Send Request</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, icon: Icon, color }: { label: string; value: string; icon: LucideIcon; color: string }) {
  const COLORS: Record<string, string> = {
    blue: "text-blue-600 bg-blue-50 border-blue-200",
    green: "text-green-600 bg-green-50 border-green-200",
    amber: "text-amber-600 bg-amber-50 border-amber-200",
    purple: "text-purple-600 bg-purple-50 border-purple-200",
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
