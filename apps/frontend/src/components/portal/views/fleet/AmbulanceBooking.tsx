"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Ambulance, CalendarDays, Clock, ChevronLeft, ChevronRight, Plus, X,
  MapPin, UserRound, CheckCircle2, AlertTriangle,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord } from "@/lib/api";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

// The planned end of a booking is stored as a readable `[until:ISO]` tag on the
// trip notes — no schema change needed. Helpers read/strip it.
const UNTIL_RE = /\s*\[until:([^\]]+)\]/;
const tripEnd = (t: Row): number => {
  const m = UNTIL_RE.exec(s(t.notes));
  if (m) { const e = new Date(m[1]).getTime(); if (!isNaN(e)) return e; }
  return new Date(s(t.scheduledAt)).getTime() + 2 * 3_600_000; // default 2h block
};
const cleanNotes = (n: unknown) => s(n).replace(UNTIL_RE, "").trim();

const DAY_MS = 86_400_000;
const startOfWeek = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; }; // Sunday start
const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtDay = (d: Date) => d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const ACTIVE_STATUSES = new Set(["SCHEDULED", "INSPECTION", "EN_ROUTE", "ARRIVED", "RETURNING"]);

export default function AmbulanceBooking() {
  const { data: vehicleRows } = useLiveQuery<Row>("vehicles", { query: "take=100", tables: ["Vehicle"] });
  const { data: driverRows } = useLiveQuery<Row>("drivers", { query: "take=100", tables: ["Driver"] });
  const { data: residentRows } = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });
  const { data: tripRows, refetch } = useLiveQuery<Row>("trips", { query: "include=resident,vehicle,driver&take=400", tables: ["Trip"] });

  const [session, setSession] = useState<{ id: string | null; name: string }>({ id: null, name: "" });
  useEffect(() => {
    fetch("/api/auth/session").then((r) => r.json()).then((d) => {
      if (d?.authenticated) setSession({ id: d.session?.userId ?? null, name: d.session?.name ?? "" });
    }).catch(() => {});
  }, []);

  const residents = useMemo(() => residentRows.map(adaptResident), [residentRows]);
  // Ambulances first; if the facility labels none as AMBULANCE, fall back to all vehicles.
  const ambulances = useMemo(() => {
    const amb = vehicleRows.filter((v) => s(v.type) === "AMBULANCE");
    return amb.length ? amb : vehicleRows;
  }, [vehicleRows]);
  const drivers = useMemo(() => driverRows.filter((d) => d.isActive !== false), [driverRows]);

  const bookings = useMemo(
    () => tripRows.filter((t) => ACTIVE_STATUSES.has(s(t.status)) && t.vehicleId),
    [tripRows],
  );

  // ── Week calendar state ──
  const [weekTs, setWeekTs] = useState(0);
  useEffect(() => { setWeekTs(startOfWeek(new Date()).getTime()); }, []);
  const weekStart = useMemo(() => new Date(weekTs || startOfWeek(new Date()).getTime()), [weekTs]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * DAY_MS)), [weekStart]);
  const weekEndTs = weekStart.getTime() + 7 * DAY_MS;

  const bookingsThisWeek = bookings.filter((t) => {
    const st = new Date(s(t.scheduledAt)).getTime();
    return st >= weekStart.getTime() && st < weekEndTs;
  });

  // ── Book form ──
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const emptyForm = () => ({ vehicleId: "", residentId: "", driverId: "", destination: "", date: iso(new Date()), startTime: "09:00", duration: "3", notes: "" });
  const [form, setForm] = useState(emptyForm());
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const windowFor = (f: typeof form) => {
    const start = new Date(`${f.date}T${f.startTime || "00:00"}`);
    const end = new Date(start.getTime() + Math.max(0.5, Number(f.duration) || 1) * 3_600_000);
    return { start, end };
  };

  const conflictFor = (f: typeof form) => {
    if (!f.vehicleId) return null;
    const { start, end } = windowFor(f);
    const st = start.getTime(), en = end.getTime();
    return bookings.find((t) => {
      if (s(t.vehicleId) !== f.vehicleId) return false;
      const ts = new Date(s(t.scheduledAt)).getTime();
      const te = tripEnd(t);
      return st < te && en > ts; // overlap
    }) ?? null;
  };

  const submit = async () => {
    if (!form.vehicleId || !form.residentId || !form.destination.trim()) {
      Swal.fire("Missing details", "Choose an ambulance, a resident, and a destination.", "warning");
      return;
    }
    const { start, end } = windowFor(form);
    if (end <= start) { Swal.fire("Invalid time", "The trip must end after it starts.", "warning"); return; }
    const conflict = conflictFor(form);
    if (conflict) {
      const veh = vehicleRows.find((v) => s(v.id) === form.vehicleId);
      Swal.fire("Ambulance already booked", `${s(veh?.name) || "This ambulance"} is reserved ${fmtTime(new Date(s(conflict.scheduledAt)).getTime())}–${fmtTime(tripEnd(conflict))} that day. Pick another time or vehicle.`, "error");
      return;
    }
    setBusy(true);
    try {
      const resName = residents.find((r) => r.id === form.residentId)?.name || "Resident";
      const driver = drivers.find((d) => s(d.id) === form.driverId);
      const notes = `${form.notes.trim()} [until:${end.toISOString()}]`.trim();
      await createRecord("trips", {
        residentId: form.residentId,
        vehicleId: form.vehicleId,
        driverId: form.driverId || null,
        destination: form.destination.trim(),
        origin: "Golden Hearth Facility",
        status: "SCHEDULED",
        scheduledAt: start.toISOString(),
        notes,
      });

      // Notify the assigned driver (matched to their user account by email) so it
      // shows on their phone: "you have a trip this week".
      if (driver?.email) {
        try {
          const uRes = await fetch(`/api/db/users?f_email=${encodeURIComponent(s(driver.email))}`).then((r) => r.json());
          const u = uRes?.data?.[0];
          if (u?.id) {
            await createRecord("notifications", {
              userId: u.id,
              type: "TRANSPORT_UPDATE",
              title: `New trip — ${fmtDay(start)}`,
              message: `You're driving ${resName} to ${form.destination.trim()} on ${fmtDay(start)}, ${fmtTime(start.getTime())}–${fmtTime(end.getTime())}.`,
              severity: "INFO",
            });
          }
        } catch { /* non-critical — the trip still shows on their trip board */ }
      }

      await refetch();
      setShowForm(false);
      setForm(emptyForm());
      Swal.fire({ title: "Ambulance booked", text: driver ? `${s(driver.name)} has been notified.` : "Trip scheduled.", icon: "success", timer: 1800, showConfirmButton: false });
    } catch (e) {
      Swal.fire("Booking failed", e instanceof Error ? e.message : "Could not book the trip.", "error");
    } finally { setBusy(false); }
  };

  const liveConflict = form.vehicleId && form.date && form.startTime ? conflictFor(form) : null;
  const vehName = (id: unknown) => s(vehicleRows.find((v) => s(v.id) === s(id))?.name) || "Ambulance";
  const resName = (t: Row) => { const r = (t.resident ?? {}) as Row; return `${s(r.firstName)} ${s(r.lastName)}`.trim() || "Resident"; };
  const drvName = (t: Row) => { const d = (t.driver ?? {}) as Row; return s(d.name); };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 flex items-center gap-2">
            <Ambulance className="w-7 h-7 text-red-500" /> Ambulance Booking
          </h1>
          <p className="text-gray-600 text-sm mt-0.5">Reserve the facility ambulance for a resident&apos;s trip — pick the day &amp; time, and the driver is notified. No double-booking.</p>
        </div>
        <button onClick={() => { setForm(emptyForm()); setShowForm(true); }} disabled={ambulances.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold shadow-sm transition disabled:opacity-50">
          <Plus className="w-4 h-4" /> Book Ambulance
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <Stat label="Ambulances" value={ambulances.length} icon={Ambulance} tone="red" />
        <Stat label="Bookings this week" value={bookingsThisWeek.length} icon={CalendarDays} tone="blue" />
        <Stat label="Active drivers" value={drivers.length} icon={UserRound} tone="green" />
      </div>

      {ambulances.length === 0 && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 flex items-center gap-2 text-amber-800 text-sm font-semibold">
          <AlertTriangle className="w-5 h-5" /> No vehicles found. Add a vehicle (type Ambulance) in Fleet → Vehicles first.
        </div>
      )}

      {/* Week calendar — one row per ambulance, 7 day columns */}
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="font-bold text-gray-900 flex items-center gap-2"><CalendarDays className="w-5 h-5 text-blue-600" /> Weekly Calendar</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setWeekTs((t) => (t || startOfWeek(new Date()).getTime()) - 7 * DAY_MS)} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm font-semibold text-gray-700">{fmtDay(weekDays[0])} – {fmtDay(weekDays[6])}</span>
            <button onClick={() => setWeekTs((t) => (t || startOfWeek(new Date()).getTime()) + 7 * DAY_MS)} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"><ChevronRight className="w-4 h-4" /></button>
            <button onClick={() => setWeekTs(startOfWeek(new Date()).getTime())} className="text-sm font-semibold text-blue-600 px-2 py-1 rounded-lg hover:bg-blue-50">Today</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[820px]">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left text-xs font-bold uppercase tracking-wide text-gray-500 px-3 py-2 w-40">Ambulance</th>
                {weekDays.map((d) => {
                  const isToday = iso(d) === iso(new Date());
                  return <th key={d.getTime()} className={`text-center text-xs font-semibold px-2 py-2 ${isToday ? "text-blue-700" : "text-gray-500"}`}>{d.toLocaleDateString([], { weekday: "short" })}<br />{d.getDate()}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {ambulances.map((v) => (
                <tr key={s(v.id)} className="border-t border-gray-100 align-top">
                  <td className="px-3 py-2 text-sm font-semibold text-gray-800">
                    <span className="inline-flex items-center gap-1.5"><Ambulance className="w-4 h-4 text-red-500" />{s(v.name)}</span>
                    <div className="text-[11px] text-gray-400 font-normal">{s(v.licensePlate)}</div>
                  </td>
                  {weekDays.map((day) => {
                    const dayStart = day.getTime(), dayEnd = dayStart + DAY_MS;
                    const cell = bookings
                      .filter((t) => s(t.vehicleId) === s(v.id))
                      .filter((t) => { const st = new Date(s(t.scheduledAt)).getTime(); return st >= dayStart && st < dayEnd; })
                      .sort((a, b) => new Date(s(a.scheduledAt)).getTime() - new Date(s(b.scheduledAt)).getTime());
                    return (
                      <td key={day.getTime()} className="px-1.5 py-1.5 min-w-[96px]">
                        {cell.map((t) => (
                          <div key={s(t.id)} className="mb-1 rounded-md bg-red-50 border border-red-200 px-1.5 py-1 text-[11px] leading-tight">
                            <div className="font-bold text-red-700">{fmtTime(new Date(s(t.scheduledAt)).getTime())}–{fmtTime(tripEnd(t))}</div>
                            <div className="text-gray-700 truncate">{resName(t)}</div>
                            <div className="text-gray-500 truncate flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{s(t.destination)}</div>
                            {drvName(t) && <div className="text-gray-400 truncate">🚗 {drvName(t)}</div>}
                          </div>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {ambulances.length === 0 && (
                <tr><td colSpan={8} className="text-center text-sm text-gray-400 py-8">No ambulances to show.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Book modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-red-600 text-white px-5 py-4 flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2"><Ambulance className="w-5 h-5" /> Book Ambulance</h3>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-red-700 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <Field label="Ambulance *">
                <select value={form.vehicleId} onChange={(e) => set("vehicleId", e.target.value)} className={inputCls}>
                  <option value="">Select ambulance…</option>
                  {ambulances.map((v) => <option key={s(v.id)} value={s(v.id)}>{s(v.name)} · {s(v.licensePlate)}</option>)}
                </select>
              </Field>
              <Field label="Resident / patient *">
                <select value={form.residentId} onChange={(e) => set("residentId", e.target.value)} className={inputCls}>
                  <option value="">Select resident…</option>
                  {residents.map((r) => <option key={r.id} value={r.id}>{r.name}{r.room ? ` · Room ${r.room}` : ""}</option>)}
                </select>
              </Field>
              <Field label="Destination *">
                <input value={form.destination} onChange={(e) => set("destination", e.target.value)} placeholder="e.g. Makati Medical Center" className={inputCls} />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Date"><input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className={inputCls} /></Field>
                <Field label="Start"><input type="time" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} className={inputCls} /></Field>
                <Field label="Duration">
                  <select value={form.duration} onChange={(e) => set("duration", e.target.value)} className={inputCls}>
                    {["1", "2", "3", "4", "5", "6", "8"].map((h) => <option key={h} value={h}>{h} hr{h === "1" ? "" : "s"}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Driver">
                <select value={form.driverId} onChange={(e) => set("driverId", e.target.value)} className={inputCls}>
                  <option value="">Assign later</option>
                  {drivers.map((d) => <option key={s(d.id)} value={s(d.id)}>{s(d.name)}</option>)}
                </select>
              </Field>
              <Field label="Notes"><input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Check-up, escort, wheelchair…" className={inputCls} /></Field>

              {/* Live conflict / window preview */}
              {liveConflict ? (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Booked {fmtTime(new Date(s(liveConflict.scheduledAt)).getTime())}–{fmtTime(tripEnd(liveConflict))} — pick another slot.
                </div>
              ) : form.vehicleId && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> {vehName(form.vehicleId)} is free {fmtTime(windowFor(form).start.getTime())}–{fmtTime(windowFor(form).end.getTime())} on {fmtDay(windowFor(form).start)}.
                </div>
              )}
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-5 py-3 flex items-center justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg text-sm font-medium">Cancel</button>
              <button onClick={() => void submit()} disabled={busy || Boolean(liveConflict)} className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg text-sm disabled:opacity-50">
                {busy ? "Booking…" : "Confirm Booking"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-400 outline-none";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-sm font-semibold text-gray-700 mb-1">{label}</label>{children}</div>;
}

const TONES: Record<string, string> = { red: "text-red-500", blue: "text-blue-500", green: "text-green-500" };
function Stat({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof Ambulance; tone: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 sm:p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs sm:text-sm font-semibold text-gray-600">{label}</p>
        <Icon className={`w-5 h-5 ${TONES[tone] ?? "text-gray-500"}`} />
      </div>
      <p className="text-2xl sm:text-3xl font-extrabold text-gray-900 mt-1">{value}</p>
    </div>
  );
}
