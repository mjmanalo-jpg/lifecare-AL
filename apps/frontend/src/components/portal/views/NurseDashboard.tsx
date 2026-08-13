"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState, useEffect } from "react";
import {
  Users, AlertTriangle, HeartPulse, BellRing,
  Sun, Sunset, Moon, CheckCircle2, Clock, ShieldAlert, ChevronRight, Heart, Inbox,
  type LucideIcon,
} from "lucide-react";
import Swal from "@/lib/swal";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { useLiveQuery, useStats } from "@/lib/useLiveQuery";
import { adaptResident, adaptIncident, adaptTask, residentName } from "@/lib/adapters";
import { updateRecord } from "@/lib/api";

/* ── Types ───────────────────────────────────────────────────────────── */

type Incident = ReturnType<typeof adaptIncident>;
interface ResidentVM { id: string; name: string; room: string; careLevel: string; alertsCount: number }
interface VitalVM { id: string; type: string; value: string; unit: string; recordedAt: string | null; residentId: string; resident: string; room: string; abnormal: boolean }
interface CallBellVM { id: string; status: string; reason: string; resident: string; room: string; createdAt: string | null }

/* ── Static metadata ─────────────────────────────────────────────────── */

const SEVERITY_META: Record<string, { label: string; badge: string; color: string }> = {
  critical: { label: "Critical", badge: "bg-red-100 text-red-700", color: "#ef4444" },
  high: { label: "High", badge: "bg-orange-100 text-orange-700", color: "#f97316" },
  medium: { label: "Medium", badge: "bg-yellow-100 text-yellow-700", color: "#eab308" },
  low: { label: "Low", badge: "bg-blue-100 text-blue-700", color: "#3b82f6" },
};

/* ── Helpers ─────────────────────────────────────────────────────────── */

const asStr = (v: unknown): string => (v == null ? "" : String(v));

function shiftFor(hour: number) {
  if (hour >= 6 && hour < 14) return { label: "Day Shift", icon: Sun, greeting: "Good morning" };
  if (hour >= 14 && hour < 22) return { label: "Evening Shift", icon: Sunset, greeting: "Good afternoon" };
  return { label: "Night Shift", icon: Moon, greeting: "Good evening" };
}

function relTime(iso: string | null, nowTs: number): string {
  if (!iso || !nowTs) return "—";
  const m = Math.round((nowTs - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m ago` : `${h}h ago`;
  return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h ago` : `${Math.floor(h / 24)}d ago`;
}

/** Clinical normal-range check for abnormal-vitals surfacing. */
function isAbnormal(type: string, value: string): boolean {
  const n = parseFloat(value);
  switch (type) {
    case "HEART_RATE": return !isNaN(n) && (n < 60 || n > 100);
    case "OXYGEN": return !isNaN(n) && n < 95;
    case "TEMPERATURE": return !isNaN(n) && n > 37.5;
    case "RESPIRATORY_RATE": return !isNaN(n) && (n < 12 || n > 20);
    case "BLOOD_GLUCOSE": return !isNaN(n) && (n < 70 || n > 180);
    case "BLOOD_PRESSURE": { const sys = parseInt(value, 10); return !isNaN(sys) && (sys >= 140 || sys < 90); }
    default: return false;
  }
}
const humanizeVital = (t: string) => t.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/* ── Component ───────────────────────────────────────────────────────── */

export default function NurseDashboard() {
  const { stats, refetch: refetchStats } = useStats();
  const { data: residentRows } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "include=incidents&take=300", tables: ["Resident", "Incident"] }
  );
  const { data: incidentRows, refetch: refetchIncidents } = useLiveQuery<Record<string, unknown>>(
    "incidents", { query: "include=resident&take=300", tables: ["Incident"] }
  );
  const { data: vitalRows, refetch: refetchVitals } = useLiveQuery<Record<string, unknown>>(
    "vitals", { query: "include=resident&take=500", tables: ["VitalsLog"] }
  );
  const { data: bellRows } = useLiveQuery<Record<string, unknown>>(
    "call-bells", { query: "include=resident&take=100", tables: ["CallBell"] }
  );
  const { data: taskRows } = useLiveQuery<Record<string, unknown>>(
    "tasks", { query: "include=resident&take=300", tables: ["Task"] }
  );

  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  const residents = useMemo<ResidentVM[]>(
    () => residentRows.map((row) => {
      const r = adaptResident(row);
      return { id: r.id, name: r.name, room: r.room, careLevel: r.careLevel, alertsCount: r.alertsCount };
    }),
    [residentRows]
  );
  const incidents = useMemo<Incident[]>(() => incidentRows.map(adaptIncident), [incidentRows]);
  const vitals = useMemo<VitalVM[]>(
    () => vitalRows.map((row) => {
      const res = row.resident as { firstName?: string; lastName?: string; roomNumber?: string } | undefined;
      const type = asStr(row.type);
      const value = asStr(row.value);
      return {
        id: String(row.id), type, value, unit: asStr(row.unit),
        recordedAt: row.recordedAt ? String(row.recordedAt) : null,
        residentId: row.residentId ? String(row.residentId) : "",
        resident: residentName(res), room: res?.roomNumber ?? "—",
        abnormal: isAbnormal(type, value),
      };
    }),
    [vitalRows]
  );
  const bells = useMemo<CallBellVM[]>(
    () => bellRows.map((row) => {
      const res = row.resident as { firstName?: string; lastName?: string; roomNumber?: string } | undefined;
      return {
        id: String(row.id), status: asStr(row.status) || "PENDING",
        reason: row.reason ? String(row.reason) : "Assistance requested",
        resident: residentName(res), room: res?.roomNumber ?? "—",
        createdAt: row.createdAt ? String(row.createdAt) : null,
      };
    }),
    [bellRows]
  );

  /* ── Derived: incidents / bells ─────────────────────────────────────── */

  // Unassigned open tasks — where resident-submitted requests (room service,
  // diet substitution) land; they arrive with no assignee and otherwise never
  // surface on a dashboard (only in the Task Assignment board).
  const openRequests = useMemo(
    () => taskRows
      .map(adaptTask)
      .filter((t) => !t.completed && !(t.raw as { assignedToId?: string } | null | undefined)?.assignedToId)
      .sort((a, b) => new Date(String((b.raw as { createdAt?: string } | null)?.createdAt ?? 0)).getTime() - new Date(String((a.raw as { createdAt?: string } | null)?.createdAt ?? 0)).getTime())
      .slice(0, 5),
    [taskRows],
  );

  const openIncidents = useMemo(() => incidents.filter((i) => !i.resolved), [incidents]);
  const criticalIncidents = useMemo(
    () => openIncidents
      .filter((i) => i.severity === "critical" || i.severity === "high")
      // Newest-first so the latest critical/high incident always shows in the top-6.
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [openIncidents]
  );
  // Active call bells = still needing action, matching the Call Bells "Queue":
  // includes RESPONDED ("Responding"), not just PENDING.
  const activeBells = useMemo(() => bells.filter((b) => b.status === "PENDING" || b.status === "RESPONDED"), [bells]);
  const attentionResidents = useMemo(
    () => residents.filter((r) => r.alertsCount > 0).sort((a, b) => b.alertsCount - a.alertsCount).slice(0, 6),
    [residents]
  );

  const abnormalVitals = useMemo(
    () => vitals.filter((v) => v.abnormal)
      .sort((a, b) => new Date(b.recordedAt ?? 0).getTime() - new Date(a.recordedAt ?? 0).getTime())
      .slice(0, 20),
    [vitals]
  );

  /* ── Derived: HR for stat card ─────────────────────────────────────── */

  const hr = useMemo(() => {
    const readings = vitals.filter((v) => v.type === "HEART_RATE" && v.recordedAt)
      .map((v) => ({ ts: new Date(v.recordedAt as string).getTime(), n: parseFloat(v.value) }))
      .filter((x) => !isNaN(x.n))
      .sort((a, b) => a.ts - b.ts);
    const avg = readings.length ? Math.round(readings.reduce((s, x) => s + x.n, 0) / readings.length) : 0;
    return { avg };
  }, [vitals]);

  const shift = shiftFor(nowTs ? new Date(nowTs).getHours() : 9);
  const ShiftIcon = shift.icon;

  const refreshAll = () => { void refetchStats(); void refetchIncidents(); void refetchVitals(); };

  const resolveIncident = async (id: string) => {
    const res = await Swal.fire({
      title: "Resolve Incident?", icon: "question", showCancelButton: true,
      confirmButtonColor: "#10b981", cancelButtonColor: "#6b7280", confirmButtonText: "Resolve",
    });
    if (!res.isConfirmed) return;
    try {
      await updateRecord("incidents", id, { resolvedAt: new Date().toISOString() });
      await refetchIncidents();
      Swal.fire({ title: "Resolved", icon: "success", timer: 1200, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not resolve.", icon: "error" });
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold flex items-center gap-2">
            <ShiftIcon className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-500 flex-shrink-0" />
            <span className="text-slate-900">{shift.greeting} — Clinical Dashboard</span>
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-xs sm:text-sm mt-1">
            <span className="inline-flex items-center gap-1 text-green-600">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live
            </span>
            {shift.label} • {nowTs ? new Date(nowTs).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : "—"}
          </p>
        </div>
        <RefreshButton onRefresh={refreshAll} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium self-start" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2 sm:gap-3 lg:gap-4">
        <Stat label="Active Residents" value={String(stats?.residents ?? residents.length)} icon={Users} tone="blue" />
        <Stat label="Open Incidents" value={String(stats?.activeIncidents ?? openIncidents.length)} icon={AlertTriangle} tone="amber" />
        <Stat label="Critical / High" value={String(criticalIncidents.length)} icon={ShieldAlert} tone="red" />
        <Stat label="Call Bells" value={String(stats?.pendingCallBells ?? activeBells.length)} icon={BellRing} tone="purple" />
        <Stat label="Avg Heart Rate" value={hr.avg ? String(hr.avg) : "—"} unit={hr.avg ? "bpm" : ""} icon={HeartPulse} tone="rose" />
      </div>

      {/* Heart Rate Trend */}
      <Card title="Heart Rate Trend" icon={Heart}>
        {vitals.filter((v) => v.type === "HEART_RATE").length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={vitals.filter((v) => v.type === "HEART_RATE" && v.recordedAt)
              .sort((a, b) => new Date(a.recordedAt!).getTime() - new Date(b.recordedAt!).getTime())
              .map((v) => ({ name: new Date(v.recordedAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), HR: parseFloat(v.value) }))}
              margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="hrFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis domain={["dataMin - 10", "dataMax + 10"]} fontSize={12} tickLine={false} axisLine={false} width={28} />
              <Tooltip />
              <Area type="monotone" dataKey="HR" stroke="#ef4444" strokeWidth={2} fill="url(#hrFill)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : <Empty text="No heart-rate readings recorded." />}
      </Card>

      {/* Clinical feeds */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
        <Card title="Critical & High Incidents" icon={ShieldAlert} count={criticalIncidents.length} className="lg:col-span-2">
          {criticalIncidents.length > 0 ? (
            <div className="space-y-2">
              {criticalIncidents.slice(0, 6).map((i) => (
                <div key={i.id} className="flex items-start justify-between gap-3 p-3 rounded-lg border border-red-100 bg-red-50/60">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 truncate">{i.type}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${SEVERITY_META[i.severity]?.badge}`}>{i.severity.toUpperCase()}</span>
                    </div>
                    <p className="text-xs text-gray-600 truncate">{i.resident} • Room {i.room} • {relTime(String(i.timestamp), nowTs)}</p>
                  </div>
                  <button onClick={() => void resolveIncident(i.id)} className="flex items-center gap-1 px-2.5 py-1 text-green-600 hover:bg-green-100 rounded text-sm font-medium transition flex-shrink-0">
                    <CheckCircle2 className="w-4 h-4" /> Resolve
                  </button>
                </div>
              ))}
            </div>
          ) : <Empty text="No critical or high-severity incidents open." />}
        </Card>

        <Card title="Abnormal Vitals" icon={AlertTriangle} count={abnormalVitals.length}>
          {abnormalVitals.length > 0 ? (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {abnormalVitals.map((v) => (
                <div key={v.id} className="p-2.5 rounded-lg bg-amber-50 border border-amber-100">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-900 text-sm">{humanizeVital(v.type)}</span>
                    <span className="font-bold text-amber-700 text-sm">{v.value} {v.unit}</span>
                  </div>
                  <p className="text-xs text-gray-600 truncate">{v.resident} • Room {v.room} • {relTime(v.recordedAt, nowTs)}</p>
                </div>
              ))}
            </div>
          ) : <Empty text="All recorded vitals within range." />}
        </Card>
      </div>

      {/* Incoming resident requests (unassigned tasks — e.g. room service / diet) */}
      <Card title="Incoming Requests" icon={Inbox} count={openRequests.length}>
        {openRequests.length > 0 ? (
          <div className="space-y-2">
            {openRequests.map((t) => (
              <div key={t.id} className="p-2.5 rounded-lg bg-amber-50 border border-amber-100">
                <p className="font-medium text-gray-900 text-sm truncate">{t.title}</p>
                <p className="text-xs text-gray-600 truncate">{t.resident} • Room {t.room} • Unassigned</p>
                {(t.dueDate || (t.raw as { createdAt?: string } | null)?.createdAt) && (
                  <p className="text-[11px] text-gray-500 flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3 flex-shrink-0" />
                    {t.dueDate
                      ? `Due ${new Date(t.dueDate).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                      : `Requested ${new Date(String((t.raw as { createdAt?: string }).createdAt)).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : <Empty text="No new requests." />}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
        <Card title="Active Call Bells" icon={BellRing} count={activeBells.length}>
          {activeBells.length > 0 ? (
            <div className="space-y-2">
              {activeBells.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-purple-50 border border-purple-100">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{b.resident}</p>
                    <p className="text-xs text-gray-600 truncate">Room {b.room} • {b.reason}</p>
                  </div>
                  <span className="text-xs text-purple-700 font-medium flex items-center gap-1 flex-shrink-0"><Clock className="w-3 h-3" /> {relTime(b.createdAt, nowTs)}</span>
                </div>
              ))}
            </div>
          ) : <Empty text="No active call bells." />}
        </Card>

        <Card title="Residents Needing Attention" icon={Users} count={attentionResidents.length}>
          {attentionResidents.length > 0 ? (
            <div className="space-y-2">
              {attentionResidents.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-red-50 border border-red-100">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{r.name}</p>
                    <p className="text-xs text-gray-600">Room {r.room} • {r.careLevel}</p>
                  </div>
                  <span className="px-2 py-1 bg-red-500 text-white rounded-full text-xs font-bold flex-shrink-0">{r.alertsCount}</span>
                </div>
              ))}
            </div>
          ) : <Empty text="All residents stable." />}
        </Card>
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────── */

const TONES: Record<string, { wrap: string; icon: string; value: string }> = {
  blue: { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-500", value: "text-blue-600" },
  amber: { wrap: "bg-amber-50 border-amber-200", icon: "text-amber-500", value: "text-amber-600" },
  red: { wrap: "bg-red-50 border-red-200", icon: "text-red-500", value: "text-red-600" },
  purple: { wrap: "bg-purple-50 border-purple-200", icon: "text-purple-500", value: "text-purple-600" },
  rose: { wrap: "bg-rose-50 border-rose-200", icon: "text-rose-500", value: "text-rose-600" },
  gray: { wrap: "bg-white border-gray-200", icon: "text-gray-500", value: "text-gray-900" },
};

function Stat({ label, value, unit, icon: Icon, tone }: { label: string; value: string; unit?: string; icon: LucideIcon; tone: keyof typeof TONES }) {
  const t = TONES[tone];
  return (
    <div className={`p-3 sm:p-4 rounded-lg border ${t.wrap}`}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] sm:text-xs sm:text-sm text-gray-600 font-semibold">{label}</p>
        <Icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${t.icon}`} />
      </div>
      <p className={`text-xl sm:text-2xl md:text-3xl font-bold mt-1 ${t.value}`}>{value}{unit ? <span className="text-xs sm:text-base font-medium ml-1">{unit}</span> : null}</p>
    </div>
  );
}


function Card({ title, icon: Icon, count, className, children }: { title: string; icon: LucideIcon; count?: number; className?: string; children: React.ReactNode }) {
  return (
    <div className={`bg-white rounded-lg border border-gray-200 p-3 sm:p-4 ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Icon className="w-4 h-4 text-yellow-500" /> {title}</h3>
        {typeof count === "number" && <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full text-xs font-bold">{count}</span>}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-gray-500 py-6 text-center flex items-center justify-center gap-1"><ChevronRight className="w-4 h-4 opacity-0" />{text}</p>;
}
