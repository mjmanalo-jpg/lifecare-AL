"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState } from "react";
import {
  Fuel, RefreshCw, Plus, X, Trash2, Gauge, Droplets, CircleDollarSign,
  Hash, Route, TrendingUp, Bus, Leaf,
  type LucideIcon,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  AreaChart, Area,
} from "recharts";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

/* ── Constants ── */

const FUEL_TYPES = ["Diesel", "Gasoline", "Electric kWh"];

const FUEL_TYPE_STYLES: Record<string, string> = {
  Diesel: "bg-amber-100 text-amber-700",
  Gasoline: "bg-blue-100 text-blue-700",
  "Electric kWh": "bg-green-100 text-green-700",
};

const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;

/* ── Adapt helpers ── */

type Row = Record<string, unknown>;

const rel = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});

const adaptFuelLog = (r: Row) => {
  const vehicle = rel(r.vehicle);
  const driver = rel(r.driver);
  return {
    id: String(r.id ?? ""),
    vehicleId: String(r.vehicleId ?? ""),
    vehicleName: String(vehicle.name ?? "—"),
    vehiclePlate: String(vehicle.licensePlate ?? ""),
    driverName: String(driver.name ?? ""),
    logDate: r.logDate ? String(r.logDate) : "",
    odometer: Number(r.odometer ?? 0),
    liters: Number(r.liters ?? 0),
    cost: Number(r.cost ?? 0),
    fuelType: String(r.fuelType ?? "Diesel"),
    notes: String(r.notes ?? ""),
  };
};
type FuelLog = ReturnType<typeof adaptFuelLog>;

const adaptVehicle = (r: Row) => ({
  id: String(r.id ?? ""),
  name: String(r.name ?? "Vehicle"),
  licensePlate: String(r.licensePlate ?? ""),
  odometer: Number(r.odometer ?? 0),
});
type Vehicle = ReturnType<typeof adaptVehicle>;

const adaptDriver = (r: Row) => ({
  id: String(r.id ?? ""),
  name: String(r.name ?? "Driver"),
  isActive: r.isActive !== false,
});
type Driver = ReturnType<typeof adaptDriver>;

/* ── Date helpers ── */

const isThisMonth = (iso: string) => {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
};

const toLocalInputValue = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const emptyForm = () => ({
  vehicleId: "", driverId: "", logDate: toLocalInputValue(new Date()),
  odometer: "", liters: "", cost: "", fuelType: "Diesel", notes: "",
});

export default function FleetFuel() {
  const { data: logRows, loading, error, refetch } = useLiveQuery<Row>(
    "fuel-logs", { query: "include=vehicle,driver&take=300", tables: ["FuelLog", "Vehicle"] }
  );
  const vehiclesQ = useLiveQuery<Row>("vehicles", { query: "take=300", tables: ["Vehicle"] });
  const driversQ = useLiveQuery<Row>("drivers", { query: "take=300", tables: ["Driver"] });

  const logs = useMemo<FuelLog[]>(
    () => logRows.map(adaptFuelLog).sort((a, b) => new Date(b.logDate || 0).getTime() - new Date(a.logDate || 0).getTime()),
    [logRows]
  );
  const vehicles = useMemo<Vehicle[]>(() => vehiclesQ.data.map(adaptVehicle), [vehiclesQ.data]);
  const drivers = useMemo<Driver[]>(() => driversQ.data.map(adaptDriver).filter(d => d.isActive), [driversQ.data]);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [page, setPage] = useState(1);
  const perPage = 15;

  const refreshAll = async () => { await refetch(); await vehiclesQ.refetch(); };

  /* ── Stats (this month) ── */
  const stats = useMemo(() => {
    const month = logs.filter(l => isThisMonth(l.logDate));
    const liters = month.reduce((s, l) => s + l.liters, 0);
    const cost = month.reduce((s, l) => s + l.cost, 0);
    // Km logged: per vehicle max - min odometer within this month's logs, summed.
    const byVehicle = new Map<string, number[]>();
    month.forEach(l => {
      if (!l.vehicleId || !l.odometer) return;
      const arr = byVehicle.get(l.vehicleId) ?? [];
      arr.push(l.odometer);
      byVehicle.set(l.vehicleId, arr);
    });
    let km = 0;
    byVehicle.forEach(arr => {
      if (arr.length >= 2) km += Math.max(...arr) - Math.min(...arr);
    });
    return {
      liters, cost,
      avgPerLiter: liters > 0 ? cost / liters : 0,
      fillUps: month.length,
      km,
    };
  }, [logs]);

  /* ── Charts ── */
  const costByVehicle = useMemo(() =>
    vehicles
      .map(v => ({
        name: v.name,
        cost: Math.round(logs.filter(l => l.vehicleId === v.id).reduce((s, l) => s + l.cost, 0)),
      }))
      .filter(d => d.cost > 0)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10),
  [vehicles, logs]);

  const costByWeek = useMemo(() => {
    const weeks: { name: string; start: number; cost: number }[] = [];
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    for (let i = 7; i >= 0; i--) {
      const start = now - (i + 1) * WEEK_MS;
      weeks.push({
        name: new Date(start + WEEK_MS).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        start,
        cost: 0,
      });
    }
    logs.forEach(l => {
      if (!l.logDate) return;
      const t = new Date(l.logDate).getTime();
      const w = weeks.find(x => t >= x.start && t < x.start + WEEK_MS);
      if (w) w.cost += l.cost;
    });
    return weeks.map(w => ({ name: w.name, cost: Math.round(w.cost) }));
  }, [logs]);

  /* ── Efficiency ── */
  const efficiency = useMemo(() =>
    vehicles.map(v => {
      const vLogs = logs.filter(l => l.vehicleId === v.id && l.odometer > 0);
      if (vLogs.length < 2) {
        return { id: v.id, name: v.name, plate: v.licensePlate, logs: vLogs.length, kmPerL: null as number | null };
      }
      const odos = vLogs.map(l => l.odometer);
      const km = Math.max(...odos) - Math.min(...odos);
      const liters = vLogs.reduce((s, l) => s + l.liters, 0);
      return { id: v.id, name: v.name, plate: v.licensePlate, logs: vLogs.length, kmPerL: liters > 0 ? km / liters : null };
    }),
  [vehicles, logs]);

  const totalPages = Math.max(1, Math.ceil(logs.length / perPage));
  const paginated = logs.slice((page - 1) * perPage, page * perPage);

  const selectedVehicle = vehicles.find(v => v.id === form.vehicleId);

  /* ── Create ── */
  const handleCreate = async () => {
    if (!form.vehicleId || !form.odometer || !form.liters) {
      Swal.fire({ title: "Missing Fields", text: "Vehicle, odometer, and liters are required.", icon: "warning" });
      return;
    }
    const confirmed = await Swal.fire({
      title: "Log Fuel-Up?", icon: "question", showCancelButton: true,
      confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280", confirmButtonText: "Log",
    });
    if (!confirmed.isConfirmed) return;
    try {
      const odometer = Math.round(Number(form.odometer) || 0);
      await createRecord("fuel-logs", {
        vehicleId: form.vehicleId,
        driverId: form.driverId || null,
        logDate: form.logDate ? new Date(form.logDate).toISOString() : new Date().toISOString(),
        odometer,
        liters: Number(form.liters) || 0,
        cost: Number(form.cost) || 0,
        fuelType: form.fuelType,
        notes: form.notes,
      });
      if (selectedVehicle && odometer > selectedVehicle.odometer) {
        await updateRecord("vehicles", selectedVehicle.id, { odometer, fuelLevel: 100 });
      }
      await refreshAll();
      setShowCreate(false);
      setForm(emptyForm());
      Swal.fire({ title: "Logged", text: "Fuel-up recorded.", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Log Failed", text: err instanceof Error ? err.message : "Could not log fuel-up.", icon: "error" });
    }
  };

  const handleDelete = async (log: FuelLog) => {
    const confirmed = await Swal.fire({
      title: "Delete Fuel Log?",
      text: `Remove the ${log.liters} L fill-up for ${log.vehicleName}?`,
      icon: "warning", showCancelButton: true,
      confirmButtonColor: "#ef4444", cancelButtonColor: "#6b7280", confirmButtonText: "Delete",
    });
    if (!confirmed.isConfirmed) return;
    try {
      await deleteRecord("fuel-logs", log.id);
      await refetch();
      Swal.fire({ title: "Deleted", text: "Fuel log removed.", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Delete Failed", text: err instanceof Error ? err.message : "Could not delete fuel log.", icon: "error" });
    }
  };

  const setField = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Fuel &amp; Odometer
          </h1>
          <p className="text-gray-600">Odometer &amp; fuel log · consumption analytics</p>
        </div>
        <div className="flex gap-2">
          <RefreshButton onRefresh={() => void refreshAll()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium" />
          <button onClick={() => { setForm(emptyForm()); setShowCreate(true); }} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
            <Plus className="w-4 h-4" /> Log Fuel-Up
          </button>
        </div>
      </div>

      {/* Stat Boxes */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatBox label="Liters (Month)" value={stats.liters.toLocaleString(undefined, { maximumFractionDigits: 1 })} icon={Droplets} color="blue" />
        <StatBox label="Fuel Cost (Month)" value={`₱${Math.round(stats.cost).toLocaleString()}`} icon={CircleDollarSign} color="amber" />
        <StatBox label="Avg ₱/Liter" value={stats.avgPerLiter > 0 ? `₱${stats.avgPerLiter.toFixed(2)}` : "—"} icon={Fuel} color="purple" />
        <StatBox label="Fill-Ups (Month)" value={String(stats.fillUps)} icon={Hash} color="green" />
        <StatBox label="Km Logged (Month)" value={stats.km.toLocaleString()} icon={Route} color="red" />
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Bus className="w-4 h-4 text-yellow-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Fuel Cost by Vehicle (₱)</h3>
          </div>
          <div className="h-[220px]">
            {costByVehicle.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-400">No data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={costByVehicle} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" height={40} />
                  <YAxis fontSize={10} tickLine={false} axisLine={false} width={44} />
                  <Tooltip />
                  <Bar dataKey="cost" name="Cost (₱)" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="w-4 h-4 text-yellow-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Fuel Cost — Last 8 Weeks (₱)</h3>
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={costByWeek} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="fuelCostGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#fbbf24" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" fontSize={9} tickLine={false} axisLine={false} />
                <YAxis fontSize={10} tickLine={false} axisLine={false} width={44} />
                <Tooltip />
                <Area type="monotone" dataKey="cost" name="Cost (₱)" stroke="#f59e0b" strokeWidth={2} fill="url(#fuelCostGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Fuel log table */}
      {loading && logs.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading fuel logs...</div>
      ) : logs.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No fuel-ups logged yet.</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Date</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Vehicle</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Driver</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Odometer</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Liters</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Cost</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">₱/L</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Fuel</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.map(log => (
                <tr key={log.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">
                    {log.logDate ? new Date(log.logDate).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {log.vehicleName} <span className="text-xs text-gray-400 font-normal">{log.vehiclePlate}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{log.driverName || "—"}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{log.odometer ? `${log.odometer.toLocaleString()} km` : "—"}</td>
                  <td className="px-4 py-3 text-right text-gray-900 font-medium">{log.liters.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                  <td className="px-4 py-3 text-right text-gray-900 font-medium">₱{log.cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{log.liters > 0 ? `₱${(log.cost / log.liters).toFixed(2)}` : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${FUEL_TYPE_STYLES[log.fuelType] || "bg-gray-100 text-gray-700"}`}>
                      {log.fuelType}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => handleDelete(log)} className="p-1.5 rounded hover:bg-red-100 text-red-600 transition" title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {logs.length > perPage && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm text-gray-600">{logs.length} fuel logs total</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Previous</button>
            <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm">Next</button>
          </div>
        </div>
      )}

      {/* Efficiency table */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <Leaf className="w-4 h-4 text-yellow-500" />
          <h3 className="font-semibold text-gray-900 text-sm">Fuel Efficiency (km/L)</h3>
          <span className="ml-auto text-xs text-gray-500">Needs ≥2 logs per vehicle</span>
        </div>
        {efficiency.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No vehicles.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200">
                <tr>
                  <th className="text-left py-2 font-semibold text-gray-700 text-xs">Vehicle</th>
                  <th className="text-right py-2 font-semibold text-gray-700 text-xs">Logs</th>
                  <th className="text-right py-2 font-semibold text-gray-700 text-xs">km/L</th>
                  <th className="text-left py-2 pl-4 font-semibold text-gray-700 text-xs">Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {efficiency.map(e => {
                  const cls = e.kmPerL === null ? "text-gray-400" : e.kmPerL >= 8 ? "text-green-600" : e.kmPerL >= 5 ? "text-amber-600" : "text-red-600";
                  const rating = e.kmPerL === null ? "—" : e.kmPerL >= 8 ? "Good" : e.kmPerL >= 5 ? "Fair" : "Poor";
                  const pill = e.kmPerL === null ? "bg-gray-100 text-gray-500" : e.kmPerL >= 8 ? "bg-green-100 text-green-700" : e.kmPerL >= 5 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
                  return (
                    <tr key={e.id}>
                      <td className="py-2 text-gray-900 font-medium">{e.name} <span className="text-xs text-gray-400 font-normal">{e.plate}</span></td>
                      <td className="py-2 text-right text-gray-600">{e.logs}</td>
                      <td className={`py-2 text-right font-semibold ${cls}`}>{e.kmPerL === null ? "—" : e.kmPerL.toFixed(1)}</td>
                      <td className="py-2 pl-4">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${pill}`}>{rating}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold">Log Fuel-Up</h2>
              <button onClick={() => setShowCreate(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Vehicle</label>
                  <select value={form.vehicleId} onChange={setField("vehicleId")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    <option value="">Select vehicle…</option>
                    {vehicles.map(v => <option key={v.id} value={v.id}>{v.name} ({v.licensePlate})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Driver (optional)</label>
                  <select value={form.driverId} onChange={setField("driverId")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    <option value="">No driver</option>
                    {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Date &amp; Time</label>
                  <input type="datetime-local" value={form.logDate} onChange={setField("logDate")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Odometer (km)</label>
                  <input type="number" min="0" value={form.odometer} onChange={setField("odometer")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                  {selectedVehicle && (
                    <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                      <Gauge className="w-3 h-3" /> Current: {selectedVehicle.odometer.toLocaleString()} km
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Liters</label>
                  <input type="number" min="0" step="0.1" value={form.liters} onChange={setField("liters")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Cost (₱)</label>
                  <input type="number" min="0" step="0.01" value={form.cost} onChange={setField("cost")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Fuel Type</label>
                  <select value={form.fuelType} onChange={setField("fuelType")} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
                    {FUEL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
                  <textarea value={form.notes} onChange={setField("notes")} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
                </div>
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
              <button onClick={() => setShowCreate(false)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm">Cancel</button>
              <button onClick={handleCreate} className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">Log Fuel-Up</button>
            </div>
          </div>
        </div>
      )}
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
