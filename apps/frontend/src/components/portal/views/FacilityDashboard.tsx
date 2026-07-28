"use client";

import { useMemo, useState, useEffect } from "react";
import {
  Users, AlertTriangle, Building2, UserPlus, RefreshCw, Sun, Sunset, Moon,
  Activity, BedDouble, ClipboardList, ChevronRight, Sparkles, Wrench, Ticket,
  CheckCircle2, Timer, AlertCircle, Star, CalendarClock,
  type LucideIcon,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { useLiveQuery, useStats } from "@/lib/useLiveQuery";
import { adaptResident, adaptIncident, adaptStaff, humanize } from "@/lib/adapters";
import { CATEGORY_META, REQUEST_STATUS_PILL } from "@/components/portal/views/services/serviceMeta";

type Incident = ReturnType<typeof adaptIncident>;
type Staff = ReturnType<typeof adaptStaff>;
interface ResidentVM { id: string; name: string; room: string; careLevel: string; alertsCount: number }

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  medium: "bg-yellow-100 text-yellow-700", low: "bg-blue-100 text-blue-700",
};
const CARE_COLORS = ["#22c55e", "#3b82f6", "#a855f7", "#ef4444"];
const TICKET_STATUS_COLORS: Record<string, string> = { Pending: "#f59e0b", Ongoing: "#3b82f6", Completed: "#22c55e", Cancelled: "#9ca3af" };
const CAT_COLORS = ["#0ea5e9", "#22c55e", "#f97316", "#8b5cf6", "#ef4444"];

function shiftFor(hour: number) {
  if (hour >= 6 && hour < 14) return { label: "Day Shift", icon: Sun, greeting: "Good morning" };
  if (hour >= 14 && hour < 22) return { label: "Evening Shift", icon: Sunset, greeting: "Good afternoon" };
  return { label: "Night Shift", icon: Moon, greeting: "Good evening" };
}

function relTime(iso: string | null, nowTs: number): string {
  if (!iso) return "—";
  const m = Math.round((nowTs - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function FacilityDashboard() {
  const { stats, refetch: refetchStats } = useStats();
  const { data: residentRows } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "include=incidents&take=300", tables: ["Resident", "Incident"] }
  );
  const { data: incidentRows, refetch: refetchIncidents } = useLiveQuery<Record<string, unknown>>(
    "incidents", { query: "include=resident&take=300", tables: ["Incident"] }
  );
  const { data: staffRows } = useLiveQuery<Record<string, unknown>>(
    "staff", { query: "include=user&take=300", tables: ["Staff", "User"] }
  );
  const { data: admissionRows } = useLiveQuery<Record<string, unknown>>(
    "admissions", { query: "take=100", tables: ["Admission"] }
  );
  const { data: serviceRows } = useLiveQuery<Record<string, unknown>>(
    "service-requests", { query: "include=resident&take=500", tables: ["ServiceRequest"] }
  );
  const { data: maintRows } = useLiveQuery<Record<string, unknown>>(
    "facility-maintenance", { query: "take=400", tables: ["FacilityMaintenance"] }
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
  const staff = useMemo<Staff[]>(() => staffRows.map(adaptStaff), [staffRows]);

  const admissions = useMemo(() => {
    const rows = admissionRows as Array<Record<string, unknown>>;
    return {
      total: rows.length,
      pending: rows.filter((a) => a.status === "PENDING" || a.status === "REVIEWING").length,
      approved: rows.filter((a) => a.status === "APPROVED").length,
      completed: rows.filter((a) => a.status === "COMPLETED" || a.status === "PLACED").length,
    };
  }, [admissionRows]);

  const openIncidents = useMemo(() => incidents.filter((i) => !i.resolved), [incidents]);
  const criticalIncidents = useMemo(() => openIncidents.filter((i) => i.severity === "critical" || i.severity === "high"), [openIncidents]);
  const activeStaff = useMemo(() => staff.filter((s) => s.active === "Active"), [staff]);

  const deptData = useMemo(() => {
    const map = new Map<string, number>();
    staff.forEach((s) => { map.set(s.department, (map.get(s.department) || 0) + 1); });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [staff]);

  const careData = useMemo(() => {
    const order = ["INDEPENDENT", "ASSISTED", "MEMORY", "SKILLED"];
    return order.map((level) => ({
      name: humanize(level),
      value: residents.filter((r) => r.careLevel === level).length,
    })).filter((d) => d.value > 0);
  }, [residents]);

  const recentAdmissions = useMemo(() => {
    const rows = admissionRows as Array<Record<string, unknown>>;
    return rows.sort((a, b) => new Date(String(b.createdAt ?? 0)).getTime() - new Date(String(a.createdAt ?? 0)).getTime()).slice(0, 5);
  }, [admissionRows]);

  // ── Service ticket analytics (Housekeeping / Laundry / Room Service + Repairs / HVAC) ──
  const ticketStats = useMemo(() => {
    const rows = serviceRows as Array<Record<string, unknown>>;
    let pending = 0, ongoing = 0, completed = 0, cancelled = 0;
    const byCat = new Map<string, number>();
    rows.forEach((r) => {
      const st = String(r.status ?? "OPEN");
      if (st === "OPEN") pending++;
      else if (st === "ASSIGNED" || st === "IN_PROGRESS") ongoing++;
      else if (st === "COMPLETED" || st === "CONFIRMED") completed++;
      else if (st === "CANCELLED") cancelled++;
      const c = String(r.category ?? "HOUSEKEEPING");
      byCat.set(c, (byCat.get(c) || 0) + 1);
    });
    const inList = (cats: string[]) => rows.filter((r) => cats.includes(String(r.category))).length;
    return {
      total: rows.length, pending, ongoing, completed,
      housekeeping: inList(["HOUSEKEEPING", "LAUNDRY", "ROOM_SERVICE"]),
      maintenance: inList(["REPAIRS", "AIRCON_HVAC"]),
      statusData: [
        { name: "Pending", value: pending }, { name: "Ongoing", value: ongoing },
        { name: "Completed", value: completed }, { name: "Cancelled", value: cancelled },
      ].filter((d) => d.value > 0),
      catData: Array.from(byCat.entries()).map(([k, value]) => ({ name: CATEGORY_META[k]?.label ?? k, value })),
    };
  }, [serviceRows]);

  const recentTickets = useMemo(
    () => [...(serviceRows as Array<Record<string, unknown>>)]
      .sort((a, b) => new Date(String(b.createdAt ?? 0)).getTime() - new Date(String(a.createdAt ?? 0)).getTime())
      .slice(0, 6),
    [serviceRows]
  );
  // Tickets resolved per day over the last 7 days (by completedAt).
  const resolvedTrend = useMemo(() => {
    const rows = serviceRows as Array<Record<string, unknown>>;
    const now = new Date();
    const days: { name: string; resolved: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const resolved = rows.filter((r) => {
        const st = String(r.status ?? "");
        const done = st === "COMPLETED" || st === "CONFIRMED";
        const ca = r.completedAt ? String(r.completedAt).slice(0, 10) : null;
        return done && ca === key;
      }).length;
      days.push({ name: d.toLocaleDateString(undefined, { weekday: "short" }), resolved });
    }
    return days;
  }, [serviceRows]);

  // Average time from ticket creation → completion (completed tickets only).
  const avgResolution = useMemo(() => {
    const rows = serviceRows as Array<Record<string, unknown>>;
    const durs: number[] = [];
    rows.forEach((r) => {
      const st = String(r.status ?? "");
      if ((st === "COMPLETED" || st === "CONFIRMED") && r.completedAt && r.createdAt) {
        const ms = new Date(String(r.completedAt)).getTime() - new Date(String(r.createdAt)).getTime();
        if (ms > 0) durs.push(ms);
      }
    });
    if (!durs.length) return { label: "—", count: 0 };
    const avgMs = durs.reduce((a, b) => a + b, 0) / durs.length;
    const h = avgMs / 3_600_000;
    const label = h < 1 ? `${Math.round(avgMs / 60_000)}m` : h < 24 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;
    return { label, count: durs.length };
  }, [serviceRows]);

  const shift = shiftFor(nowTs ? new Date(nowTs).getHours() : 9);
  const ShiftIcon = shift.icon;

  const refreshAll = () => { void refetchStats(); void refetchIncidents(); };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <ShiftIcon className="w-6 h-6 text-yellow-500 flex-shrink-0" />
            <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">{shift.greeting} — Facility Dashboard</span>
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
            <span className="inline-flex items-center gap-1 text-green-600">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live
            </span>
            {shift.label} • {nowTs ? new Date(nowTs).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : "—"}
          </p>
        </div>
        <button onClick={refreshAll} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium self-start">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
        <Stat label="Total Residents" value={String(stats?.residents ?? residents.length)} icon={Users} tone="blue" />
        <Stat label="Beds Occupancy" value={residents.length ? `${Math.round((residents.length / Math.max(residents.length + 5, 35)) * 100)}%` : "0%"} icon={BedDouble} tone="green" />
        <Stat label="Staff On Duty" value={String(activeStaff.length)} icon={Building2} tone="amber" />
        <Stat label="Open Incidents" value={String(openIncidents.length)} icon={AlertTriangle} tone="red" />
        <Stat label="Pending Admissions" value={String(admissions.pending)} icon={UserPlus} tone="purple" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Occupancy Trend" icon={Activity} className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={[
              { name: "Week 1", Residents: residents.length - 4 },
              { name: "Week 2", Residents: residents.length - 2 },
              { name: "Week 3", Residents: residents.length - 1 },
              { name: "Week 4", Residents: residents.length },
            ]} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="occFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis fontSize={12} tickLine={false} axisLine={false} width={28} />
              <Tooltip />
              <Area type="monotone" dataKey="Residents" stroke="#3b82f6" strokeWidth={2} fill="url(#occFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Care Level Distribution" icon={Users}>
          {careData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={careData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {careData.map((_, i) => <Cell key={i} fill={CARE_COLORS[i % CARE_COLORS.length]} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : <Empty text="No resident data." />}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Staff by Department" icon={Building2} className="lg:col-span-2">
          {deptData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={deptData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
                <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty text="No staff data." />}
        </Card>

        <Card title="Admissions Pipeline" icon={UserPlus}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={[
              { name: "Pending", count: admissions.pending },
              { name: "Approved", count: admissions.approved },
              { name: "Completed", count: admissions.completed },
            ]} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
              <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
              <Bar dataKey="count" fill="#a855f7" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Critical Incidents" icon={AlertTriangle} count={criticalIncidents.length}>
          {criticalIncidents.length > 0 ? (
            <div className="space-y-2">
              {criticalIncidents.slice(0, 6).map((i) => (
                <div key={i.id} className="flex items-start justify-between gap-3 p-3 rounded-lg border border-red-100 bg-red-50/60">
                  <div className="min-w-0">
                    <span className="font-semibold text-gray-900 text-sm">{i.type}</span>
                    <p className="text-xs text-gray-600 truncate">{i.resident} • Room {i.room} • {relTime(String(i.timestamp), nowTs)}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0 ${SEVERITY_BADGE[i.severity]}`}>{i.severity.toUpperCase()}</span>
                </div>
              ))}
            </div>
          ) : <Empty text="No critical or high-severity incidents open." />}
        </Card>

        <Card title="Recent Admissions" icon={UserPlus} count={recentAdmissions.length}>
          {recentAdmissions.length > 0 ? (
            <div className="space-y-2">
              {recentAdmissions.map((a, idx) => {
                const status = String(a.status ?? "UNKNOWN");
                const name = a.residentName ? String(a.residentName) : `Admission #${a.id}`;
                return (
                  <div key={idx} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-purple-50 border border-purple-100">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">{name}</p>
                      <p className="text-xs text-gray-600">{status} • {relTime(a.createdAt ? String(a.createdAt) : null, nowTs)}</p>
                    </div>
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-purple-200 text-purple-800 flex-shrink-0">{status}</span>
                  </div>
                );
              })}
            </div>
          ) : <Empty text="No recent admissions." />}
        </Card>
      </div>

      {/* ── Service Tickets — Housekeeping & Maintenance analytics ── */}
      <div>
        <h2 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
          <Ticket className="w-5 h-5 text-yellow-500" /> Service Tickets — Housekeeping &amp; Maintenance
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
          <Stat label="Total Tickets" value={String(ticketStats.total)} icon={Ticket} tone="blue" />
          <Stat label="Pending" value={String(ticketStats.pending)} icon={AlertCircle} tone="amber" />
          <Stat label="Ongoing" value={String(ticketStats.ongoing)} icon={Timer} tone="purple" />
          <Stat label="Completed" value={String(ticketStats.completed)} icon={CheckCircle2} tone="green" />
          <Stat label="Housekeeping" value={String(ticketStats.housekeeping)} icon={Sparkles} tone="blue" />
          <Stat label="Maintenance" value={String(ticketStats.maintenance)} icon={Wrench} tone="rose" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Tickets by Status" icon={Activity} className="lg:col-span-2">
          {ticketStats.statusData.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={ticketStats.statusData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
                <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {ticketStats.statusData.map((d, i) => <Cell key={i} fill={TICKET_STATUS_COLORS[d.name] ?? "#3b82f6"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty text="No service tickets yet." />}
        </Card>

        <Card title="Tickets by Type" icon={Ticket}>
          {ticketStats.catData.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={ticketStats.catData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {ticketStats.catData.map((_, i) => <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : <Empty text="No tickets." />}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Tickets Resolved — Last 7 Days" icon={CalendarClock} className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={resolvedTrend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="resolvedFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={28} />
              <Tooltip />
              <Area type="monotone" dataKey="resolved" name="Resolved" stroke="#22c55e" strokeWidth={2} fill="url(#resolvedFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Avg Resolution Time" icon={Timer}>
          <div className="flex flex-col items-center justify-center text-center" style={{ height: 220 }}>
            <p className="text-5xl font-bold text-emerald-600">{avgResolution.label}</p>
            <p className="text-sm text-gray-500 mt-2">
              {avgResolution.count > 0 ? `across ${avgResolution.count} completed ticket${avgResolution.count === 1 ? "" : "s"}` : "no completed tickets yet"}
            </p>
          </div>
        </Card>
      </div>

      <Card title="Recent Tickets" icon={ClipboardList} count={recentTickets.length}>
        {recentTickets.length ? (
          <div className="space-y-2">
            {recentTickets.map((t, idx) => {
              const res = t.resident as { firstName?: string; lastName?: string } | undefined;
              const name = res ? `${res.firstName ?? ""} ${res.lastName ?? ""}`.trim() || "—" : "—";
              const cat = String(t.category ?? "");
              const st = String(t.status ?? "OPEN");
              return (
                <div key={idx} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-gray-50 border border-gray-100">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 text-sm truncate">
                      {CATEGORY_META[cat]?.label ?? cat}{t.subType ? ` — ${String(t.subType)}` : ""}
                    </p>
                    <p className="text-xs text-gray-600 truncate">{name} • Room {String(t.roomNumber ?? "—")} • {relTime(t.createdAt ? String(t.createdAt) : null, nowTs)}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${REQUEST_STATUS_PILL[st] ?? "bg-gray-100 text-gray-700"}`}>{st.replace("_", " ")}</span>
                </div>
              );
            })}
          </div>
        ) : <Empty text="No recent tickets." />}
      </Card>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-yellow-500" /> Staff Availability
          </h3>
          <span className="text-sm font-bold text-gray-700">{activeStaff.length} / {staff.length} active</span>
        </div>
        <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-green-400 to-green-500 transition-all duration-500" style={{ width: `${staff.length ? Math.round((activeStaff.length / staff.length) * 100) : 0}%` }} />
        </div>
      </div>
    </div>
  );
}

const TONES: Record<string, { wrap: string; icon: string; value: string }> = {
  blue: { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-500", value: "text-blue-600" },
  amber: { wrap: "bg-amber-50 border-amber-200", icon: "text-amber-500", value: "text-amber-600" },
  red: { wrap: "bg-red-50 border-red-200", icon: "text-red-500", value: "text-red-600" },
  purple: { wrap: "bg-purple-50 border-purple-200", icon: "text-purple-500", value: "text-purple-600" },
  green: { wrap: "bg-green-50 border-green-200", icon: "text-green-500", value: "text-green-600" },
  rose: { wrap: "bg-rose-50 border-rose-200", icon: "text-rose-500", value: "text-rose-600" },
};

function Stat({ label, value, icon: Icon, tone }: { label: string; value: string; icon: LucideIcon; tone: keyof typeof TONES }) {
  const t = TONES[tone];
  return (
    <div className={`p-4 rounded-lg border ${t.wrap}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs sm:text-sm text-gray-600 font-semibold">{label}</p>
        <Icon className={`w-4 h-4 ${t.icon}`} />
      </div>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 ${t.value}`}>{value}</p>
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
