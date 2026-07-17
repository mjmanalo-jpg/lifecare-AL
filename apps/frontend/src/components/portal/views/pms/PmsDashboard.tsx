"use client";

import { useMemo } from "react";
import {
  Building2, RefreshCw, Percent, Timer, Star, ShieldCheck, CircleDollarSign,
  DoorOpen, Users, CalendarDays, Megaphone, UtensilsCrossed, type LucideIcon,
} from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { UNIT_STATUS_META, UNIT_STATUS_ORDER } from "./pmsMeta";

/**
 * PMS central hub — Reporting & Analytics KPIs (Phase 7). Every figure is
 * computed live from Prisma/Supabase via useLiveQuery (realtime + polling):
 * occupancy rate · unit turnover time · resident satisfaction · service SLA
 * compliance · ancillary revenue. No aggregate is stored — always real-time.
 */

type Row = Record<string, unknown>;
const DAY_MS = 86400000;
const num = (v: unknown) => Number(v ?? 0);

// SLA windows (hours) by service-request priority.
const SLA_HOURS: Record<string, number> = { EMERGENCY: 2, URGENT: 8, ROUTINE: 48 };
const ANCILLARY_CATEGORIES = new Set(["Hotel Services", "Concierge Services", "Dining Services", "Specialist Therapy"]);
const isLast30 = (iso: string) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !isNaN(t) && Date.now() - t <= 30 * DAY_MS;
};

export default function PmsDashboard() {
  const roomsQ = useLiveQuery<Row>("rooms", { query: "take=500", tables: ["Room"] });
  const turnoversQ = useLiveQuery<Row>("room-turnovers", { query: "take=500", tables: ["RoomTurnover"] });
  const svcQ = useLiveQuery<Row>("service-requests", { query: "take=500", tables: ["ServiceRequest"] });
  const conciergeQ = useLiveQuery<Row>("concierge-bookings", { query: "take=500", tables: ["ConciergeBooking"] });
  const eventsQ = useLiveQuery<Row>("event-attendances", { query: "take=500", tables: ["EventAttendance"] });
  const chargesQ = useLiveQuery<Row>("service-charges", { query: "take=500", tables: ["ServiceCharge"] });
  const frontDeskQ = useLiveQuery<Row>("front-desk-visits", { query: "take=500", tables: ["FrontDeskVisit"] });
  const residentsQ = useLiveQuery<Row>("residents", { query: "take=500", tables: ["Resident"] });
  const communityQ = useLiveQuery<Row>("community-events", { query: "take=200", tables: ["CommunityEvent"] });
  const diningQ = useLiveQuery<Row>("dining-reservations", { query: "take=200", tables: ["DiningReservation"] });

  const refreshAll = () => {
    roomsQ.refetch(); turnoversQ.refetch(); svcQ.refetch(); conciergeQ.refetch();
    eventsQ.refetch(); chargesQ.refetch(); frontDeskQ.refetch(); residentsQ.refetch();
    communityQ.refetch(); diningQ.refetch();
  };

  /* ── KPI 1: Occupancy Rate ── */
  const occupancy = useMemo(() => {
    const rooms = roomsQ.data;
    const total = rooms.length;
    const occupied = rooms.filter(r => String(r.status) === "OCCUPIED").length;
    return { total, occupied, rate: total ? Math.round((occupied / total) * 100) : 0 };
  }, [roomsQ.data]);

  /* ── KPI 2: Unit Turnover Time (avg hours, completed cycles) ── */
  const turnoverTime = useMemo(() => {
    const done = turnoversQ.data.filter(t => String(t.status) === "COMPLETED" && t.readyAt && t.startedAt);
    if (!done.length) return { avgHours: 0, count: 0 };
    const totalH = done.reduce((s, t) => s + (new Date(String(t.readyAt)).getTime() - new Date(String(t.startedAt)).getTime()) / 3600000, 0);
    return { avgHours: totalH / done.length, count: done.length };
  }, [turnoversQ.data]);

  /* ── KPI 3: Resident Satisfaction (avg ★ across services, concierge, events) ── */
  const satisfaction = useMemo(() => {
    const ratings: number[] = [];
    svcQ.data.forEach(r => { if (num(r.rating) >= 1) ratings.push(num(r.rating)); });
    conciergeQ.data.forEach(r => { if (num(r.rating) >= 1) ratings.push(num(r.rating)); });
    eventsQ.data.forEach(r => { if (num(r.rating) >= 1) ratings.push(num(r.rating)); });
    if (!ratings.length) return { avg: 0, count: 0 };
    return { avg: ratings.reduce((s, r) => s + r, 0) / ratings.length, count: ratings.length };
  }, [svcQ.data, conciergeQ.data, eventsQ.data]);

  /* ── KPI 4: Service SLA Compliance (% completed within window) ── */
  const sla = useMemo(() => {
    const closed = svcQ.data.filter(r => ["COMPLETED", "CONFIRMED"].includes(String(r.status)) && r.completedAt && r.createdAt);
    if (!closed.length) return { pct: 100, met: 0, total: 0 };
    let met = 0;
    closed.forEach(r => {
      const hrs = (new Date(String(r.completedAt)).getTime() - new Date(String(r.createdAt)).getTime()) / 3600000;
      const window = SLA_HOURS[String(r.priority)] ?? 48;
      if (hrs <= window) met += 1;
    });
    return { pct: Math.round((met / closed.length) * 100), met, total: closed.length };
  }, [svcQ.data]);

  /* ── KPI 5: Ancillary Revenue (last 30 days) ── */
  const ancillary = useMemo(() => {
    const fromCharges = chargesQ.data
      .filter(c => ANCILLARY_CATEGORIES.has(String(c.category)) && isLast30(String(c.serviceDate ?? c.createdAt)))
      .reduce((s, c) => s + num(c.amount), 0);
    const fromDesk = frontDeskQ.data
      .filter(v => isLast30(String(v.arrivalTime ?? v.createdAt)))
      .reduce((s, v) => s + num(v.ancillaryTotal), 0);
    return fromCharges + fromDesk;
  }, [chargesQ.data, frontDeskQ.data]);

  /* ── Charts ── */
  const occupancyChart = useMemo(() => {
    const rooms = roomsQ.data;
    const byStatus: Record<string, number> = {};
    rooms.forEach(r => { const s = String(r.status); byStatus[s] = (byStatus[s] ?? 0) + 1; });
    const COLORS: Record<string, string> = { OCCUPIED: "#6366f1", AVAILABLE: "#22c55e", RESERVED: "#f59e0b", MAINTENANCE: "#ef4444" };
    return Object.entries(byStatus).map(([name, value]) => ({ name, value, fill: COLORS[name] ?? "#94a3b8" }));
  }, [roomsQ.data]);

  const lifecycleChart = useMemo(() => {
    const rooms = roomsQ.data;
    return UNIT_STATUS_ORDER.map(s => ({
      name: UNIT_STATUS_META[s].label,
      units: rooms.filter(r => String(r.housekeepingStatus) === s).length,
    })).filter(d => d.units > 0);
  }, [roomsQ.data]);

  const upcomingEvents = useMemo(
    () => communityQ.data
      .filter(e => new Date(String(e.startTime)).getTime() >= Date.now() - DAY_MS)
      .sort((a, b) => new Date(String(a.startTime)).getTime() - new Date(String(b.startTime)).getTime())
      .slice(0, 5),
    [communityQ.data]
  );

  const pinnedAnnouncements = useLiveQuery<Row>("announcements", { query: "f_pinned=true&take=20", tables: ["Announcement"] });

  const secondary = useMemo(() => ({
    activeTurnovers: turnoversQ.data.filter(t => String(t.status) === "IN_PROGRESS").length,
    frontDeskToday: frontDeskQ.data.filter(v => isLast30(String(v.arrivalTime)) && String(v.status) !== "CHECKED_OUT").length,
    residents: residentsQ.data.length,
    pendingDining: diningQ.data.filter(d => String(d.status) === "REQUESTED").length,
  }), [turnoversQ.data, frontDeskQ.data, residentsQ.data, diningQ.data]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            PMS Hub
          </h1>
          <p className="text-gray-600">Property Management System — central hub of hospitality operations &amp; live KPIs</p>
        </div>
        <button onClick={refreshAll} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label="Occupancy Rate" value={`${occupancy.rate}%`} sub={`${occupancy.occupied}/${occupancy.total} units`} icon={Percent} color="indigo" />
        <Kpi label="Unit Turnover Time" value={turnoverTime.count ? `${turnoverTime.avgHours.toFixed(1)}h` : "—"} sub={`${turnoverTime.count} cycles`} icon={Timer} color="amber" />
        <Kpi label="Resident Satisfaction" value={satisfaction.count ? `${satisfaction.avg.toFixed(1)} ★` : "—"} sub={`${satisfaction.count} ratings`} icon={Star} color="purple" />
        <Kpi label="Service SLA Compliance" value={`${sla.pct}%`} sub={`${sla.met}/${sla.total} on time`} icon={ShieldCheck} color="green" />
        <Kpi label="Ancillary Revenue (30d)" value={`₱${Math.round(ancillary).toLocaleString()}`} sub="dining · salon · services" icon={CircleDollarSign} color="yellow" />
      </div>

      {/* Secondary counters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat label="Residents" value={String(secondary.residents)} icon={Users} />
        <MiniStat label="Active Turnovers" value={String(secondary.activeTurnovers)} icon={DoorOpen} />
        <MiniStat label="Guests On-Site" value={String(secondary.frontDeskToday)} icon={Building2} />
        <MiniStat label="Pending Dining" value={String(secondary.pendingDining)} icon={UtensilsCrossed} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Occupancy by Room Status</h3>
          {occupancyChart.length === 0 ? (
            <p className="text-sm text-gray-400 py-12 text-center">No rooms yet.</p>
          ) : (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={occupancyChart} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
                    {occupancyChart.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="flex flex-wrap gap-3 justify-center mt-2">
            {occupancyChart.map(d => (
              <span key={d.name} className="inline-flex items-center gap-1 text-xs text-gray-600">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.fill }} /> {d.name} ({d.value})
              </span>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Apartment Lifecycle Distribution</h3>
          {lifecycleChart.length === 0 ? (
            <p className="text-sm text-gray-400 py-12 text-center">No lifecycle data yet.</p>
          ) : (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={lifecycleChart} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" fontSize={10} tickLine={false} axisLine={false} width={130} />
                  <Tooltip />
                  <Bar dataKey="units" name="Units" fill="#f59e0b" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Upcoming events + pinned announcements */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <CalendarDays className="w-4 h-4 text-yellow-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Upcoming Community Events</h3>
          </div>
          {upcomingEvents.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No upcoming events.</p>
          ) : (
            <div className="space-y-2">
              {upcomingEvents.map(e => (
                <div key={String(e.id)} className="flex items-center justify-between gap-3 border border-gray-100 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{String(e.title)}</p>
                    <p className="text-xs text-gray-500 truncate">{String(e.location ?? "")}</p>
                  </div>
                  <span className="text-xs text-gray-500 whitespace-nowrap">{new Date(String(e.startTime)).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <Megaphone className="w-4 h-4 text-yellow-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Pinned Announcements</h3>
          </div>
          {pinnedAnnouncements.data.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No pinned announcements.</p>
          ) : (
            <div className="space-y-2">
              {pinnedAnnouncements.data.map(a => (
                <div key={String(a.id)} className="border border-gray-100 rounded-lg px-3 py-2">
                  <p className="text-sm font-medium text-gray-900">{String(a.title)}</p>
                  <p className="text-xs text-gray-500 line-clamp-2">{String(a.body)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function Kpi({ label, value, sub, icon: Icon, color }: { label: string; value: string; sub: string; icon: LucideIcon; color: string }) {
  const COLORS: Record<string, string> = {
    indigo: "text-indigo-600 bg-indigo-50 border-indigo-200",
    amber: "text-amber-600 bg-amber-50 border-amber-200",
    purple: "text-purple-600 bg-purple-50 border-purple-200",
    green: "text-green-600 bg-green-50 border-green-200",
    yellow: "text-yellow-600 bg-yellow-50 border-yellow-200",
  };
  const c = COLORS[color] || COLORS.indigo;
  return (
    <div className={`rounded-lg border p-4 ${c}`}>
      <div className="flex items-center justify-between mb-0.5">
        <p className="text-xs font-semibold text-gray-600">{label}</p>
        <Icon className={`w-4 h-4 ${c.split(" ")[0]}`} />
      </div>
      <p className={`text-2xl sm:text-3xl font-bold ${c.split(" ")[0]}`}>{value}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>
    </div>
  );
}

function MiniStat({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 flex items-center gap-3">
      <div className="p-2 rounded-lg bg-gray-50 text-gray-500"><Icon className="w-4 h-4" /></div>
      <div>
        <p className="text-lg font-bold text-gray-900 leading-none">{value}</p>
        <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  );
}
