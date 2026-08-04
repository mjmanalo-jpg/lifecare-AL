"use client";

import { useMemo, useState } from "react";
import { CalendarDays, Plus, X, Clock, Stethoscope, Users, ClipboardList, MapPin, Loader2, Calendar as CalIcon } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord } from "@/lib/api";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

// Appointment types are encoded in the visit's `purpose` as "[TYPE] Title", so
// this rides on the existing self-writable `visits` model (resident-scoped —
// families only ever see their own resident's schedule). Migration-free.
const TYPES = [
  { key: "FAMILY_MEETING", label: "Family Meeting", color: "#3b82f6", icon: Users },
  { key: "DOCTOR", label: "Doctor Visit", color: "#ef4444", icon: Stethoscope },
  { key: "CARE_CONFERENCE", label: "Care Conference", color: "#a855f7", icon: ClipboardList },
  { key: "TOUR", label: "Tour", color: "#f59e0b", icon: MapPin },
  { key: "ACTIVITY", label: "Activity / Event", color: "#22c55e", icon: CalIcon },
  { key: "OTHER", label: "Other", color: "#6b7280", icon: CalendarDays },
] as const;
const typeMeta = (k: string) => TYPES.find((t) => t.key === k) ?? TYPES[TYPES.length - 1];

function parseAppt(v: Row) {
  const purpose = s(v.purpose);
  const m = purpose.match(/^\[([A-Z_]+)\]\s*(.*)$/);
  return {
    id: s(v.id),
    type: m ? m[1] : "OTHER",
    title: m ? m[2] : purpose || "Appointment",
    when: s(v.checkInTime),
    withWhom: s(v.visitorName),
    notes: s(v.notes),
  };
}
const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);

interface Props {
  /** Required to schedule; the resident the appointments belong to. */
  residentId?: string;
  residentName?: string;
  canSchedule?: boolean;
  title?: string;
}

/** Shared appointment calendar — meetings with family, doctors, care
 *  conferences, tours. Shown on the family + resident dashboards; anyone with
 *  access can schedule, and it reflects on every viewer's calendar. */
export default function AppointmentCalendar({ residentId, residentName, canSchedule = true, title = "Calendar" }: Props) {
  const q = residentId ? `f_residentId=${residentId}&take=300` : "take=300";
  const { data: visitRows, refetch } = useLiveQuery<Row>("visits", { query: q, tables: ["Visit"] });

  const appts = useMemo(
    () => visitRows.map(parseAppt).filter((a) => a.when).sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime()),
    [visitRows],
  );
  const todayKey = new Date().toISOString().slice(0, 10);
  const upcoming = useMemo(() => appts.filter((a) => dayKey(a.when) >= todayKey), [appts, todayKey]);

  const grouped = useMemo(() => {
    const map = new Map<string, ReturnType<typeof parseAppt>[]>();
    for (const a of upcoming) { const k = dayKey(a.when); (map.get(k) ?? map.set(k, []).get(k)!).push(a); }
    return Array.from(map.entries());
  }, [upcoming]);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: "FAMILY_MEETING", title: "", withWhom: "", date: "", time: "10:00", notes: "" });
  const [saving, setSaving] = useState(false);

  const schedule = async () => {
    if (!residentId) return;
    if (!form.title.trim() || !form.date) { Swal.fire({ title: "Add a title and date", icon: "warning" }); return; }
    setSaving(true);
    try {
      const when = new Date(`${form.date}T${form.time || "10:00"}`).toISOString();
      await createRecord("visits", {
        residentId,
        visitorName: form.withWhom || "—",
        purpose: `[${form.type}] ${form.title.trim()}`,
        checkInTime: when,
        notes: form.notes || null,
      });
      await refetch();
      setShowForm(false);
      setForm({ type: "FAMILY_MEETING", title: "", withWhom: "", date: "", time: "10:00", notes: "" });
      Swal.fire({ title: "Scheduled", text: "It now shows on the resident's and family's calendars.", icon: "success", timer: 1900, showConfirmButton: false });
    } catch (e) {
      Swal.fire({ title: "Couldn't schedule", text: e instanceof Error ? e.message : "Try again", icon: "error" });
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="flex items-center gap-2 font-bold text-gray-900"><CalendarDays className="w-5 h-5 text-blue-600" /> {title}</h3>
        {canSchedule && residentId && (
          <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"><Plus className="w-4 h-4" /> Schedule</button>
        )}
      </div>

      {grouped.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">No upcoming appointments.{canSchedule && residentId ? " Tap Schedule to add one." : ""}</p>
      ) : (
        <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
          {grouped.map(([day, list]) => {
            const d = new Date(day + "T00:00");
            const isToday = day === todayKey;
            return (
              <div key={day}>
                <p className={`text-xs font-bold uppercase tracking-wide mb-1.5 ${isToday ? "text-blue-600" : "text-gray-400"}`}>
                  {isToday ? "Today · " : ""}{d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                </p>
                <div className="space-y-1.5">
                  {list.map((a) => {
                    const meta = typeMeta(a.type);
                    const Icon = meta.icon;
                    return (
                      <div key={a.id} className="flex items-start gap-2.5 rounded-lg border border-gray-100 bg-gray-50 p-2.5">
                        <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}><Icon className="h-4 w-4" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-gray-900 truncate">{a.title}</p>
                          <p className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(a.when).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                            <span className="font-medium" style={{ color: meta.color }}>{meta.label}</span>
                            {a.withWhom && a.withWhom !== "—" && <span>· with {a.withWhom}</span>}
                          </p>
                          {a.notes && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{a.notes}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-blue-600 px-5 py-4 text-white rounded-t-xl">
              <h3 className="font-bold">Schedule appointment{residentName ? ` — ${residentName}` : ""}</h3>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-white/15 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-3">
              <label className="text-xs font-medium text-gray-600 col-span-2">Type
                <select className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
              </label>
              <label className="text-xs font-medium text-gray-600 col-span-2">Title
                <input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Care plan review" />
              </label>
              <label className="text-xs font-medium text-gray-600">Date
                <input type="date" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </label>
              <label className="text-xs font-medium text-gray-600">Time
                <input type="time" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
              </label>
              <label className="text-xs font-medium text-gray-600 col-span-2">With (family member / doctor)
                <input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.withWhom} onChange={(e) => setForm({ ...form, withWhom: e.target.value })} placeholder="Optional" />
              </label>
              <label className="text-xs font-medium text-gray-600 col-span-2">Notes
                <textarea className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[54px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
              <button onClick={() => void schedule()} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Schedule</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
