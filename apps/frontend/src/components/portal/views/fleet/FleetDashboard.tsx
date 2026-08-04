"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo } from "react";
import {
  Bus, RefreshCw, AlertTriangle, ShieldCheck, ShieldAlert, Wrench,
  Fuel, Clock, Route, Inbox, Gauge, BadgeCheck, IdCard, FileWarning,
  Activity, TrendingUp, Users, CircleDollarSign,
  type LucideIcon,
} from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { useLiveQuery } from "@/lib/useLiveQuery";

/* ── Colors ── */

const VEHICLE_STATUS_COLORS: Record<string, string> = {
  AVAILABLE: "#22c55e",
  ON_TRIP: "#3b82f6",
  MAINTENANCE: "#f59e0b",
  OUT_OF_SERVICE: "#ef4444",
};

const REQUEST_TYPE_COLORS: Record<string, string> = {
  MEDICAL_APPOINTMENT: "#3b82f6", DIALYSIS: "#8b5cf6", THERAPY: "#06b6d4",
  FAMILY_OUTING: "#22c55e", EMERGENCY_TRANSFER: "#ef4444", OTHER: "#6b7280",
};

const TRIP_STATUS_STYLES: Record<string, string> = {
  SCHEDULED: "bg-gray-100 text-gray-700",
  INSPECTION: "bg-purple-100 text-purple-700",
  EN_ROUTE: "bg-blue-100 text-blue-700",
  ARRIVED: "bg-cyan-100 text-cyan-700",
  RETURNING: "bg-indigo-100 text-indigo-700",
  COMPLETED: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-700",
};

const ACTIVE_TRIP_STATUSES = ["EN_ROUTE", "ARRIVED", "RETURNING"];

/* ── Adapt helpers (safe coercion) ── */

type Row = Record<string, unknown>;

const rel = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});
const relName = (v: unknown) => String(rel(v).name ?? "");

const adaptVehicle = (r: Row) => ({
  id: String(r.id ?? ""),
  name: String(r.name ?? "Vehicle"),
  licensePlate: String(r.licensePlate ?? ""),
  type: String(r.type ?? "SHUTTLE"),
  status: String(r.status ?? "AVAILABLE"),
  odometer: Number(r.odometer ?? 0),
  fuelLevel: Number(r.fuelLevel ?? 0),
  insuranceExpiry: r.insuranceExpiry ? String(r.insuranceExpiry) : "",
  registrationExpiry: r.registrationExpiry ? String(r.registrationExpiry) : "",
  nextServiceDate: r.nextServiceDate ? String(r.nextServiceDate) : "",
  nextServiceOdometer: Number(r.nextServiceOdometer ?? 0),
});
type Vehicle = ReturnType<typeof adaptVehicle>;

const adaptDriver = (r: Row) => ({
  id: String(r.id ?? ""),
  name: String(r.name ?? "Driver"),
  licenseExpiry: r.licenseExpiry ? String(r.licenseExpiry) : "",
  safetyScore: Number(r.safetyScore ?? 0),
  tripHours: Number(r.tripHours ?? 0),
  isActive: r.isActive !== false,
});
type Driver = ReturnType<typeof adaptDriver>;

const adaptTrip = (r: Row) => ({
  id: String(r.id ?? ""),
  resident: relName(r.resident) || "—",
  vehicle: relName(r.vehicle),
  driver: relName(r.driver),
  status: String(r.status ?? "SCHEDULED"),
  destination: String(r.destination ?? "—"),
  scheduledAt: r.scheduledAt ? String(r.scheduledAt) : "",
});
type Trip = ReturnType<typeof adaptTrip>;

const adaptRequest = (r: Row) => ({
  id: String(r.id ?? ""),
  type: String(r.type ?? "OTHER"),
  status: String(r.status ?? "PENDING"),
});

const adaptMaintenance = (r: Row) => ({
  id: String(r.id ?? ""),
  vehicleId: String(r.vehicleId ?? ""),
  vehicleName: relName(r.vehicle),
  status: String(r.status ?? "OPEN"),
  cost: Number(r.cost ?? 0),
  downtimeHours: Number(r.downtimeHours ?? 0),
  scheduledDate: r.scheduledDate ? String(r.scheduledDate) : "",
  completedDate: r.completedDate ? String(r.completedDate) : "",
});

const adaptFuelLog = (r: Row) => ({
  id: String(r.id ?? ""),
  cost: Number(r.cost ?? 0),
  logDate: r.logDate ? String(r.logDate) : "",
});

/* ── Date helpers ── */

const DAY_MS = 86400000;

function daysUntil(iso: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / DAY_MS);
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isThisMonth(iso: string) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function timeAgo(iso: string) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const diff = Date.now() - t;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "ago" : "from now";
  if (abs < 60000) return "just now";
  if (abs < 3600000) return `${Math.floor(abs / 60000)}m ${suffix}`;
  if (abs < DAY_MS) return `${Math.floor(abs / 3600000)}h ${suffix}`;
  return `${Math.floor(abs / DAY_MS)}d ${suffix}`;
}

/* ── Compliance alert entry ── */

interface ComplianceAlert {
  key: string;
  severity: "red" | "amber";
  icon: LucideIcon;
  label: string;
  detail: string;
}

export default function FleetDashboard() {
  const vehiclesQ = useLiveQuery<Row>("vehicles", { query: "take=300", tables: ["Vehicle"] });
  const driversQ = useLiveQuery<Row>("drivers", { query: "take=300", tables: ["Driver"] });
  const requestsQ = useLiveQuery<Row>("transport-requests", { query: "include=resident&take=300", tables: ["TransportRequest"] });
  const tripsQ = useLiveQuery<Row>("trips", { query: "include=resident,vehicle,driver&take=300", tables: ["Trip"], pollMs: 15000 });
  const maintQ = useLiveQuery<Row>("vehicle-maintenance", { query: "include=vehicle&take=300", tables: ["VehicleMaintenance"] });
  const fuelQ = useLiveQuery<Row>("fuel-logs", { query: "include=vehicle&take=300", tables: ["FuelLog"] });

  const vehicles = useMemo<Vehicle[]>(() => vehiclesQ.data.map(adaptVehicle), [vehiclesQ.data]);
  const drivers = useMemo<Driver[]>(() => driversQ.data.map(adaptDriver), [driversQ.data]);
  const requests = useMemo(() => requestsQ.data.map(adaptRequest), [requestsQ.data]);
  const trips = useMemo<Trip[]>(() => tripsQ.data.map(adaptTrip), [tripsQ.data]);
  const workOrders = useMemo(() => maintQ.data.map(adaptMaintenance), [maintQ.data]);
  const fuelLogs = useMemo(() => fuelQ.data.map(adaptFuelLog), [fuelQ.data]);

  const loading = vehiclesQ.loading && vehicles.length === 0;
  const error = vehiclesQ.error || driversQ.error || requestsQ.error || tripsQ.error || maintQ.error || fuelQ.error;

  const refreshAll = () => {
    void vehiclesQ.refetch(); void driversQ.refetch(); void requestsQ.refetch();
    void tripsQ.refetch(); void maintQ.refetch(); void fuelQ.refetch();
  };

  /* ── Compliance alerts ── */
  const alerts = useMemo<ComplianceAlert[]>(() => {
    const out: ComplianceAlert[] = [];
    vehicles.forEach(v => {
      const ins = daysUntil(v.insuranceExpiry);
      if (ins !== null && ins <= 30) {
        out.push({
          key: `ins-${v.id}`, severity: ins < 0 ? "red" : "amber", icon: ShieldAlert,
          label: `${v.name} — insurance ${ins < 0 ? "expired" : "expiring"}`,
          detail: ins < 0 ? `Expired ${Math.abs(ins)}d ago` : `${ins}d left`,
        });
      }
      const reg = daysUntil(v.registrationExpiry);
      if (reg !== null && reg <= 30) {
        out.push({
          key: `reg-${v.id}`, severity: reg < 0 ? "red" : "amber", icon: FileWarning,
          label: `${v.name} — registration ${reg < 0 ? "expired" : "expiring"}`,
          detail: reg < 0 ? `Expired ${Math.abs(reg)}d ago` : `${reg}d left`,
        });
      }
      const svc = daysUntil(v.nextServiceDate);
      const dateDue = svc !== null && svc < 0;
      const odoDue = v.nextServiceOdometer > 0 && v.odometer >= v.nextServiceOdometer;
      if (dateDue || odoDue) {
        out.push({
          key: `svc-${v.id}`, severity: "red", icon: Wrench,
          label: `${v.name} — preventive service due`,
          detail: odoDue ? `${v.odometer.toLocaleString()} km ≥ ${v.nextServiceOdometer.toLocaleString()} km` : `Due ${Math.abs(svc ?? 0)}d ago`,
        });
      }
      if (v.fuelLevel < 20) {
        out.push({
          key: `fuel-${v.id}`, severity: v.fuelLevel < 10 ? "red" : "amber", icon: Fuel,
          label: `${v.name} — low fuel`,
          detail: `${v.fuelLevel}% remaining`,
        });
      }
    });
    drivers.forEach(d => {
      const lic = daysUntil(d.licenseExpiry);
      if (lic !== null && lic <= 30) {
        out.push({
          key: `lic-${d.id}`, severity: lic < 0 ? "red" : "amber", icon: IdCard,
          label: `${d.name} — driver license ${lic < 0 ? "expired" : "expiring"}`,
          detail: lic < 0 ? `Expired ${Math.abs(lic)}d ago` : `${lic}d left`,
        });
      }
    });
    return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "red" ? -1 : 1));
  }, [vehicles, drivers]);

  /* ── KPIs ── */
  const kpis = useMemo(() => {
    const activeTrips = trips.filter(t => ACTIVE_TRIP_STATUSES.includes(t.status)).length;
    const pendingRequests = requests.filter(r => r.status === "PENDING").length;
    const openOrders = workOrders.filter(w => !["COMPLETED", "CANCELLED"].includes(w.status)).length;
    const fuelMonth = fuelLogs.filter(f => isThisMonth(f.logDate)).reduce((s, f) => s + f.cost, 0);
    const maintMonth = workOrders
      .filter(w => isThisMonth(w.completedDate || w.scheduledDate))
      .reduce((s, w) => s + w.cost, 0);
    const downtime = workOrders.reduce((s, w) => s + w.downtimeHours, 0);
    const scored = drivers.filter(d => d.isActive);
    const avgSafety = scored.length ? scored.reduce((s, d) => s + d.safetyScore, 0) / scored.length : 0;
    return {
      fleetSize: vehicles.length,
      available: vehicles.filter(v => v.status === "AVAILABLE").length,
      activeTrips, pendingRequests, openOrders,
      alerts: alerts.length,
      fuelMonth, maintMonth, downtime, avgSafety,
    };
  }, [vehicles, drivers, trips, requests, workOrders, fuelLogs, alerts]);

  /* ── Charts data ── */
  const statusDonut = useMemo(() =>
    Object.keys(VEHICLE_STATUS_COLORS)
      .map(s => ({ name: s.replace(/_/g, " "), value: vehicles.filter(v => v.status === s).length, color: VEHICLE_STATUS_COLORS[s] }))
      .filter(d => d.value > 0),
  [vehicles]);

  const tripsPerDay = useMemo(() => {
    const days: { name: string; trips: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      // eslint-disable-next-line react-hooks/purity
      const d = new Date(Date.now() - i * DAY_MS);
      const key = d.toDateString();
      days.push({
        name: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        trips: trips.filter(t => t.scheduledAt && new Date(t.scheduledAt).toDateString() === key).length,
      });
    }
    return days;
  }, [trips]);

  const costTrend = useMemo(() => {
    const months: { name: string; key: string; fuel: number; maintenance: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ name: d.toLocaleDateString(undefined, { month: "short" }), key: monthKey(d), fuel: 0, maintenance: 0 });
    }
    fuelLogs.forEach(f => {
      if (!f.logDate) return;
      const m = months.find(x => x.key === monthKey(new Date(f.logDate)));
      if (m) m.fuel += f.cost;
    });
    workOrders.forEach(w => {
      const iso = w.completedDate || w.scheduledDate;
      if (!iso) return;
      const m = months.find(x => x.key === monthKey(new Date(iso)));
      if (m) m.maintenance += w.cost;
    });
    return months.map(m => ({ ...m, fuel: Math.round(m.fuel), maintenance: Math.round(m.maintenance) }));
  }, [fuelLogs, workOrders]);

  const requestsByType = useMemo(() =>
    Object.keys(REQUEST_TYPE_COLORS)
      .map(t => ({ name: t.replace(/_/g, " "), value: requests.filter(r => r.type === t).length, color: REQUEST_TYPE_COLORS[t] }))
      .filter(d => d.value > 0),
  [requests]);

  const leaderboard = useMemo(() =>
    [...drivers].filter(d => d.isActive).sort((a, b) => b.safetyScore - a.safetyScore).slice(0, 8),
  [drivers]);

  const downtimeReport = useMemo(() =>
    vehicles.map(v => {
      const orders = workOrders.filter(w => w.vehicleId === v.id);
      return {
        name: v.name, plate: v.licensePlate,
        orders: orders.length,
        downtime: orders.reduce((s, w) => s + w.downtimeHours, 0),
      };
    }).sort((a, b) => b.downtime - a.downtime),
  [vehicles, workOrders]);

  const liveTrips = useMemo(() =>
    [...trips]
      .sort((a, b) => new Date(b.scheduledAt || 0).getTime() - new Date(a.scheduledAt || 0).getTime())
      .slice(0, 8),
  [trips]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Fleet Dashboard
          </h1>
          <p className="text-gray-600">Fleet analytics · compliance · live operations</p>
        </div>
        <RefreshButton onRefresh={refreshAll} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium" />
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* KPI row 1 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatBox label="Fleet Size" value={String(kpis.fleetSize)} icon={Bus} color="blue" />
        <StatBox label="Available" value={String(kpis.available)} icon={BadgeCheck} color="green" />
        <StatBox label="Active Trips" value={String(kpis.activeTrips)} icon={Route} color="purple" />
        <StatBox label="Pending Requests" value={String(kpis.pendingRequests)} icon={Inbox} color="amber" />
        <StatBox label="Open Work Orders" value={String(kpis.openOrders)} icon={Wrench} color="red" />
        <StatBox label="Compliance Alerts" value={String(kpis.alerts)} icon={AlertTriangle} color={kpis.alerts > 0 ? "red" : "green"} />
      </div>

      {/* KPI row 2 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatBox label="Fuel Cost (Month)" value={`₱${Math.round(kpis.fuelMonth).toLocaleString()}`} icon={Fuel} color="amber" />
        <StatBox label="Maintenance Cost (Month)" value={`₱${Math.round(kpis.maintMonth).toLocaleString()}`} icon={CircleDollarSign} color="blue" />
        <StatBox label="Downtime Hours" value={kpis.downtime.toLocaleString()} icon={Clock} color="red" />
        <StatBox label="Avg Safety Score" value={kpis.avgSafety.toFixed(1)} icon={ShieldCheck} color="green" />
      </div>

      {loading && (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading fleet data...</div>
      )}

      {/* Compliance & Alerts */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <ShieldAlert className="w-4 h-4 text-yellow-500" />
          <h3 className="font-semibold text-gray-900 text-sm">Compliance &amp; Alerts</h3>
          <span className="ml-auto text-xs text-gray-500">Insurance · registration · preventive loop · licenses · fuel</span>
        </div>
        {alerts.length === 0 ? (
          <div className="flex items-center gap-2 text-green-600 text-sm font-medium py-4 justify-center">
            <BadgeCheck className="w-4 h-4" /> All compliant ✓
          </div>
        ) : (
          <div className="divide-y divide-gray-100 max-h-[280px] overflow-y-auto">
            {alerts.map(a => (
              <div key={a.key} className="flex items-center gap-3 py-2.5">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${a.severity === "red" ? "bg-red-500" : "bg-amber-400"}`} />
                <a.icon className={`w-4 h-4 flex-shrink-0 ${a.severity === "red" ? "text-red-500" : "text-amber-500"}`} />
                <span className="text-sm text-gray-900 font-medium flex-1 truncate">{a.label}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.severity === "red" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                  {a.detail}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Bus className="w-4 h-4 text-yellow-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Vehicle Status</h3>
          </div>
          <div className="h-[220px]">
            {statusDonut.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusDonut} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80} paddingAngle={2}>
                    {statusDonut.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Route className="w-4 h-4 text-yellow-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Trips per Day (Last 14 Days)</h3>
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tripsPerDay} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" fontSize={9} tickLine={false} axisLine={false} angle={-25} textAnchor="end" height={38} />
                <YAxis allowDecimals={false} fontSize={10} tickLine={false} axisLine={false} width={24} />
                <Tooltip />
                <Bar dataKey="trips" name="Trips" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="w-4 h-4 text-yellow-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Operating Cost Trend (₱, Last 6 Months)</h3>
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={costTrend} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis fontSize={10} tickLine={false} axisLine={false} width={44} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="fuel" name="Fuel" stackId="cost" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                <Bar dataKey="maintenance" name="Maintenance" stackId="cost" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Inbox className="w-4 h-4 text-yellow-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Requests by Type</h3>
          </div>
          <div className="h-[220px]">
            {requestsByType.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={requestsByType} dataKey="value" nameKey="name" outerRadius={80}>
                    {requestsByType.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Leaderboard + Downtime + Live feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Driver Safety leaderboard */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <Users className="w-4 h-4 text-yellow-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Driver Safety Leaderboard</h3>
          </div>
          {leaderboard.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">No active drivers.</p>
          ) : (
            <div className="space-y-3">
              {leaderboard.map((d, i) => {
                const barColor = d.safetyScore >= 90 ? "bg-green-500" : d.safetyScore >= 75 ? "bg-amber-400" : "bg-red-500";
                return (
                  <div key={d.id}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium text-gray-900 truncate">
                        <span className="text-gray-400 mr-1.5">#{i + 1}</span>{d.name}
                      </span>
                      <span className="text-xs text-gray-500">{d.tripHours.toLocaleString()} h · <span className="font-semibold text-gray-900">{d.safetyScore}</span></span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(100, Math.max(0, d.safetyScore))}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Vehicle Downtime Report */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <Gauge className="w-4 h-4 text-yellow-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Vehicle Downtime Report</h3>
          </div>
          {downtimeReport.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">No vehicles.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200">
                  <tr>
                    <th className="text-left py-2 font-semibold text-gray-700 text-xs">Vehicle</th>
                    <th className="text-right py-2 font-semibold text-gray-700 text-xs">Work Orders</th>
                    <th className="text-right py-2 font-semibold text-gray-700 text-xs">Downtime (h)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {downtimeReport.map(v => (
                    <tr key={v.name + v.plate}>
                      <td className="py-2 text-gray-900 font-medium">{v.name} <span className="text-xs text-gray-400">{v.plate}</span></td>
                      <td className="py-2 text-right text-gray-600">{v.orders}</td>
                      <td className={`py-2 text-right font-semibold ${v.downtime > 24 ? "text-red-600" : v.downtime > 0 ? "text-amber-600" : "text-green-600"}`}>{v.downtime}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Live activity */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <Activity className="w-4 h-4 text-yellow-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Live Activity</h3>
            <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-green-600 uppercase tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Live
            </span>
          </div>
          {liveTrips.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">No trips yet.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {liveTrips.map(t => (
                <div key={t.id} className="py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{t.resident}</p>
                    <p className="text-xs text-gray-500 truncate">{t.destination}{t.vehicle ? ` · ${t.vehicle}` : ""}</p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${TRIP_STATUS_STYLES[t.status] || "bg-gray-100 text-gray-700"}`}>
                    {t.status.replace(/_/g, " ")}
                  </span>
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">{timeAgo(t.scheduledAt)}</span>
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

function StatBox({ label, value, icon: Icon, color }: { label: string; value: string; icon: LucideIcon; color: string }) {
  const COLORS: Record<string, string> = {
    blue: "text-blue-600 bg-blue-50 border-blue-200",
    green: "text-green-600 bg-green-50 border-green-200",
    red: "text-red-600 bg-red-50 border-red-200",
    purple: "text-purple-600 bg-purple-50 border-purple-200",
    amber: "text-amber-600 bg-amber-50 border-amber-200",
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

function EmptyChart() {
  return <div className="h-full flex items-center justify-center text-sm text-gray-400">No data yet</div>;
}
