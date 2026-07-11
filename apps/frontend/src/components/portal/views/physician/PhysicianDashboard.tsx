"use client";

import { useMemo, useState, useEffect } from "react";
import {
  Users, AlertTriangle, HeartPulse, BellRing, Activity, RefreshCw,
  Sun, Sunset, Moon, CheckCircle2, Clock, ShieldAlert, ChevronRight,
  Stethoscope, Pill, FileText, ClipboardList, TrendingUp,
  type LucideIcon,
} from "lucide-react";
import Swal from "sweetalert2";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { useLiveQuery, useStats } from "@/lib/useLiveQuery";
import { adaptResident, adaptIncident, residentName } from "@/lib/adapters";
import { updateRecord } from "@/lib/api";

type Incident = ReturnType<typeof adaptIncident>;
interface ResidentVM { id: string; name: string; room: string; careLevel: string; alertsCount: number }
interface VitalVM { id: string; type: string; value: string; unit: string; recordedAt: string | null; resident: string; room: string; abnormal: boolean }
interface MedVM { id: string; name: string; dosage: string; residentName: string; status: string; prescribedBy: string }
interface NoteVM { id: string; title: string; content: string; authorName: string; createdAt: string | null; residentId: string }

const SEVERITY_META: Record<string, { label: string; badge: string; color: string }> = {
  critical: { label: "Critical", badge: "bg-red-100 text-red-700", color: "#ef4444" },
  high: { label: "High", badge: "bg-orange-100 text-orange-700", color: "#f97316" },
  medium: { label: "Medium", badge: "bg-yellow-100 text-yellow-700", color: "#eab308" },
  low: { label: "Low", badge: "bg-blue-100 text-blue-700", color: "#3b82f6" },
};
const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;

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
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

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

export default function PhysicianDashboard() {
  const { stats, refetch: refetchStats } = useStats();
  const { data: residentRows } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "include=incidents,medications&take=300", tables: ["Resident", "Incident", "Medication"] }
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
  const { data: medRows } = useLiveQuery<Record<string, unknown>>(
    "medications", { query: "include=resident&take=500", tables: ["Medication"] }
  );
  const { data: noteRows } = useLiveQuery<Record<string, unknown>>(
    "medical-notes", { query: "take=50", tables: ["MedicalNote"] }
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
        resident: residentName(res), room: res?.roomNumber ?? "—",
        abnormal: isAbnormal(type, value),
      };
    }),
    [vitalRows]
  );
  const meds = useMemo<MedVM[]>(() =>
    medRows.map((row) => {
      const rel = row.resident as { firstName?: string; lastName?: string } | undefined;
      return {
        id: String(row.id), name: asStr(row.name), dosage: asStr(row.dosage),
        residentName: rel ? `${rel.firstName ?? ""} ${rel.lastName ?? ""}`.trim() : "Unknown",
        status: asStr(row.status) || "ACTIVE", prescribedBy: asStr(row.prescribedBy),
      };
    }), [medRows]);
  const notes = useMemo<NoteVM[]>(() =>
    noteRows.map((row) => ({
      id: String(row.id), title: asStr(row.title), content: asStr(row.content),
      authorName: asStr(row.authorName), createdAt: row.createdAt ? String(row.createdAt) : null,
      residentId: asStr(row.residentId),
    })), [noteRows]);

  const openIncidents = useMemo(() => incidents.filter((i) => !i.resolved), [incidents]);
  const criticalIncidents = useMemo(
    () => openIncidents.filter((i) => i.severity === "critical" || i.severity === "high"),
    [openIncidents]
  );
  const pendingBells = useMemo(() => {
    const bells = bellRows.map((row) => {
      const res = row.resident as { firstName?: string; lastName?: string; roomNumber?: string } | undefined;
      return {
        id: String(row.id), status: asStr(row.status) || "PENDING",
        reason: row.reason ? String(row.reason) : "Assistance requested",
        resident: residentName(res), room: res?.roomNumber ?? "—",
        createdAt: row.createdAt ? String(row.createdAt) : null,
      };
    });
    return bells.filter((b) => b.status === "PENDING");
  }, [bellRows]);
  const abnormalVitals = useMemo(
    () => vitals.filter((v) => v.abnormal)
      .sort((a, b) => new Date(b.recordedAt ?? 0).getTime() - new Date(a.recordedAt ?? 0).getTime())
      .slice(0, 8),
    [vitals]
  );
  const attentionResidents = useMemo(
    () => residents.filter((r) => r.alertsCount > 0).sort((a, b) => b.alertsCount - a.alertsCount).slice(0, 6),
    [residents]
  );

  const physicianMeds = useMemo(
    () => meds.filter((m) => m.prescribedBy && m.status === "ACTIVE").slice(0, 6),
    [meds]
  );

  const recentNotes = useMemo(
    () => notes.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).slice(0, 5),
    [notes]
  );

  const hr = useMemo(() => {
    const readings = vitals.filter((v) => v.type === "HEART_RATE" && v.recordedAt)
      .map((v) => ({ ts: new Date(v.recordedAt as string).getTime(), n: parseFloat(v.value) }))
      .filter((x) => !isNaN(x.n))
      .sort((a, b) => a.ts - b.ts);
    const avg = readings.length ? Math.round(readings.reduce((s, x) => s + x.n, 0) / readings.length) : 0;
    const trend = readings.map((x) => ({
      name: new Date(x.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      HR: x.n,
    }));
    return { avg, trend };
  }, [vitals]);

  const severityData = useMemo(
    () => SEVERITY_ORDER.map((s) => ({ name: SEVERITY_META[s].label, value: openIncidents.filter((i) => i.severity === s).length, color: SEVERITY_META[s].color }))
      .filter((d) => d.value > 0),
    [openIncidents]
  );

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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <ShiftIcon className="w-6 h-6 text-yellow-500 flex-shrink-0" />
            <span className="bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent">{shift.greeting} — Physician Dashboard</span>
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
            <span className="inline-flex items-center gap-1 text-green-600">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live
            </span>
            {shift.label} &middot; {nowTs ? new Date(nowTs).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : "—"}
          </p>
        </div>
        <button onClick={refreshAll} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium self-start">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        <Stat label="Patient Census" value={String(stats?.residents ?? residents.length)} icon={Users} tone="blue" />
        <Stat label="Critical Alerts" value={String(criticalIncidents.length)} icon={ShieldAlert} tone="red" />
        <Stat label="Open Incidents" value={String(stats?.activeIncidents ?? openIncidents.length)} icon={AlertTriangle} tone="amber" />
        <Stat label="Abnormal Vitals" value={String(abnormalVitals.length)} icon={Activity} tone="rose" />
        <Stat label="Avg Heart Rate" value={hr.avg ? String(hr.avg) : "—"} unit={hr.avg ? "bpm" : ""} icon={HeartPulse} tone="purple" />
        <Stat label="Pending Bells" value={String(pendingBells.length)} icon={BellRing} tone="green" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Heart Rate Trend" icon={HeartPulse} className="lg:col-span-2">
          {hr.trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={hr.trend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="physHrFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis domain={["dataMin - 10", "dataMax + 10"]} fontSize={12} tickLine={false} axisLine={false} width={28} />
                <Tooltip />
                <Area type="monotone" dataKey="HR" stroke="#ef4444" strokeWidth={2} fill="url(#physHrFill)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : <Empty text="No heart-rate readings recorded." />}
        </Card>

        <Card title="Incidents by Severity" icon={AlertTriangle}>
          {severityData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={severityData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {severityData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : <Empty text="No open incidents." />}
        </Card>
      </div>

      {/* Clinical feeds */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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
                    <p className="text-xs text-gray-600 truncate">{i.resident} &middot; Room {i.room} &middot; {relTime(String(i.timestamp), nowTs)}</p>
                  </div>
                  <button onClick={() => void resolveIncident(i.id)} className="flex items-center gap-1 px-2.5 py-1 text-green-600 hover:bg-green-100 rounded text-sm font-medium transition flex-shrink-0">
                    <CheckCircle2 className="w-4 h-4" /> Resolve
                  </button>
                </div>
              ))}
            </div>
          ) : <Empty text="No critical or high-severity incidents open." />}
        </Card>

        <Card title="Abnormal Vitals" icon={Activity} count={abnormalVitals.length}>
          {abnormalVitals.length > 0 ? (
            <div className="space-y-2">
              {abnormalVitals.map((v) => (
                <div key={v.id} className="p-2.5 rounded-lg bg-amber-50 border border-amber-100">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-900 text-sm">{humanizeVital(v.type)}</span>
                    <span className="font-bold text-amber-700 text-sm">{v.value} {v.unit}</span>
                  </div>
                  <p className="text-xs text-gray-600 truncate">{v.resident} &middot; Room {v.room} &middot; {relTime(v.recordedAt, nowTs)}</p>
                </div>
              ))}
            </div>
          ) : <Empty text="All recorded vitals within range." />}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="My Prescriptions — Active" icon={Pill} count={physicianMeds.length}>
          {physicianMeds.length > 0 ? (
            <div className="space-y-2">
              {physicianMeds.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-blue-50 border border-blue-100">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate text-sm">{m.name} <span className="text-gray-500 font-normal">{m.dosage}</span></p>
                    <p className="text-xs text-gray-600 truncate">{m.residentName}</p>
                  </div>
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-semibold flex-shrink-0">Active</span>
                </div>
              ))}
            </div>
          ) : <Empty text="No active prescriptions on file." />}
        </Card>

        <Card title="Recent Clinical Notes" icon={FileText} count={recentNotes.length}>
          {recentNotes.length > 0 ? (
            <div className="space-y-2">
              {recentNotes.map((n) => (
                <div key={n.id} className="p-2.5 rounded-lg bg-purple-50 border border-purple-100">
                  <p className="font-medium text-gray-900 truncate text-sm">{n.title || "Clinical Note"}</p>
                  <p className="text-xs text-gray-600 truncate mt-0.5">{n.authorName || "Unknown"} &middot; {relTime(n.createdAt, nowTs)}</p>
                </div>
              ))}
            </div>
          ) : <Empty text="No clinical notes recorded yet." />}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Pending Call Bells" icon={BellRing} count={pendingBells.length}>
          {pendingBells.length > 0 ? (
            <div className="space-y-2">
              {pendingBells.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-purple-50 border border-purple-100">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{b.resident}</p>
                    <p className="text-xs text-gray-600 truncate">Room {b.room} &middot; {b.reason}</p>
                  </div>
                  <span className="text-xs text-purple-700 font-medium flex items-center gap-1 flex-shrink-0"><Clock className="w-3 h-3" /> {relTime(b.createdAt, nowTs)}</span>
                </div>
              ))}
            </div>
          ) : <Empty text="No pending call bells." />}
        </Card>

        <Card title="Patients Needing Attention" icon={Users} count={attentionResidents.length}>
          {attentionResidents.length > 0 ? (
            <div className="space-y-2">
              {attentionResidents.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-red-50 border border-red-100">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{r.name}</p>
                    <p className="text-xs text-gray-600">Room {r.room} &middot; {r.careLevel}</p>
                  </div>
                  <span className="px-2 py-1 bg-red-500 text-white rounded-full text-xs font-bold flex-shrink-0">{r.alertsCount} alerts</span>
                </div>
              ))}
            </div>
          ) : <Empty text="All patients stable." />}
        </Card>
      </div>
    </div>
  );
}

const TONES: Record<string, { wrap: string; icon: string; value: string }> = {
  blue: { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-500", value: "text-blue-600" },
  amber: { wrap: "bg-amber-50 border-amber-200", icon: "text-amber-500", value: "text-amber-600" },
  red: { wrap: "bg-red-50 border-red-200", icon: "text-red-500", value: "text-red-600" },
  purple: { wrap: "bg-purple-50 border-purple-200", icon: "text-purple-500", value: "text-purple-600" },
  rose: { wrap: "bg-rose-50 border-rose-200", icon: "text-rose-500", value: "text-rose-600" },
  green: { wrap: "bg-green-50 border-green-200", icon: "text-green-500", value: "text-green-600" },
};

function Stat({ label, value, unit, icon: Icon, tone }: { label: string; value: string; unit?: string; icon: LucideIcon; tone: keyof typeof TONES }) {
  const t = TONES[tone];
  return (
    <div className={`p-4 rounded-lg border ${t.wrap}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs sm:text-sm text-gray-600 font-semibold">{label}</p>
        <Icon className={`w-4 h-4 ${t.icon}`} />
      </div>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 ${t.value}`}>{value}{unit ? <span className="text-base font-medium ml-1">{unit}</span> : null}</p>
    </div>
  );
}

function Card({ title, icon: Icon, count, className, children }: { title: string; icon: LucideIcon; count?: number; className?: string; children: React.ReactNode }) {
  return (
    <div className={`bg-white rounded-lg border border-gray-200 p-4 ${className ?? ""}`}>
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
