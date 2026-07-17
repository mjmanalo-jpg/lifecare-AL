"use client";

import { useMemo, useState, useEffect } from "react";
import {
  TrendingUp, Search, RefreshCw, Heart, Droplets, Wind, Thermometer,
  Activity, AlertTriangle, ChevronRight, type LucideIcon,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident, residentName } from "@/lib/adapters";

interface VitalRecord {
  id: string; type: string; value: string; unit: string;
  recordedAt: string | null; residentId: string; resident: string; room: string;
  abnormal: boolean;
}

const VITAL_TYPES = [
  { key: "HEART_RATE", label: "Heart Rate", icon: Heart, color: "#ef4444", unit: "bpm" },
  { key: "BLOOD_PRESSURE", label: "Blood Pressure", icon: Droplets, color: "#3b82f6", unit: "mmHg" },
  { key: "OXYGEN", label: "Oxygen Saturation", icon: Wind, color: "#22c55e", unit: "%" },
  { key: "TEMPERATURE", label: "Temperature", icon: Thermometer, color: "#f97316", unit: "°C" },
  { key: "RESPIRATORY_RATE", label: "Respiratory Rate", icon: Activity, color: "#8b5cf6", unit: "/min" },
  { key: "BLOOD_GLUCOSE", label: "Blood Glucose", icon: Droplets, color: "#ec4899", unit: "mg/dL" },
];

const CHART_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f97316", "#8b5cf6", "#ec4899"];

const asStr = (v: unknown): string => (v == null ? "" : String(v));

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

function relTime(iso: string | null, nowTs: number): string {
  if (!iso || !nowTs) return "—";
  const m = Math.round((nowTs - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function PhysicianVitals() {
  const { data: vitalRows, loading, refetch } = useLiveQuery<Record<string, unknown>>(
    "vitals", { query: "include=resident&take=1000", tables: ["VitalsLog"] }
  );
  const { data: residentRows } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "take=300", tables: ["Resident"] }
  );

  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  const [search, setSearch] = useState("");
  const [selectedResident, setSelectedResident] = useState("all");
  const [selectedType, setSelectedType] = useState<string>(VITAL_TYPES[0].key);

  const residents = useMemo(() => residentRows.map(adaptResident), [residentRows]);

  const vitals = useMemo<VitalRecord[]>(() => vitalRows.map((row) => {
    const rel = row.resident as { firstName?: string; lastName?: string; roomNumber?: string } | undefined;
    const type = asStr(row.type);
    const value = asStr(row.value);
    return {
      id: String(row.id), type, value, unit: asStr(row.unit),
      recordedAt: row.recordedAt ? String(row.recordedAt) : null,
      residentId: row.residentId ? String(row.residentId) : "",
      resident: rel ? `${rel.firstName ?? ""} ${rel.lastName ?? ""}`.trim() : "Unknown",
      room: rel?.roomNumber ?? "—",
      abnormal: isAbnormal(type, value),
    };
  }), [vitalRows]);

  const filteredVitals = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vitals.filter((v) => {
      if (q && !v.resident.toLowerCase().includes(q) && !v.room.toLowerCase().includes(q)) return false;
      if (selectedResident !== "all" && v.residentId !== selectedResident) return false;
      return true;
    });
  }, [vitals, search, selectedResident]);

  const chartData = useMemo(() => {
    const selected = VITAL_TYPES.find((t) => t.key === selectedType);
    if (!selected) return [];
    const byResident = new Map<string, { resident: string; data: { name: string; value: number }[] }>();
    filteredVitals
      .filter((v) => v.type === selectedType && v.recordedAt)
      .sort((a, b) => new Date(a.recordedAt!).getTime() - new Date(b.recordedAt!).getTime())
      .forEach((v) => {
        const n = parseFloat(v.value);
        if (isNaN(n)) return;
        const entry = byResident.get(v.residentId) || { resident: v.resident, data: [] };
        entry.data.push({
          name: new Date(v.recordedAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          value: n,
        });
        byResident.set(v.residentId, entry);
      });
    return Array.from(byResident.values());
  }, [filteredVitals, selectedType]);

  const abnormalVitals = useMemo(
    () => filteredVitals.filter((v) => v.abnormal)
      .sort((a, b) => new Date(b.recordedAt ?? 0).getTime() - new Date(a.recordedAt ?? 0).getTime())
      .slice(0, 20),
    [filteredVitals]
  );

  const latestByResident = useMemo(() => {
    const map = new Map<string, Record<string, VitalRecord>>();
    filteredVitals.sort((a, b) => new Date(b.recordedAt ?? 0).getTime() - new Date(a.recordedAt ?? 0).getTime())
      .forEach((v) => {
        const resMap = map.get(v.residentId) || {};
        if (!resMap[v.type]) resMap[v.type] = v;
        map.set(v.residentId, resMap);
      });
    return Array.from(map.entries()).slice(0, 20);
  }, [filteredVitals]);

  const stats = useMemo(() => ({
    total: filteredVitals.length,
    abnormal: filteredVitals.filter((v) => v.abnormal).length,
    patients: new Set(filteredVitals.map((v) => v.residentId)).size,
    types: new Set(filteredVitals.map((v) => v.type)).size,
  }), [filteredVitals]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
            <TrendingUp className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Vitals Trends
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
            Analyze vital sign trends, spot anomalies, and track patient health trajectories
          </p>
        </div>
        <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat label="Total Readings" value={stats.total} icon={Activity} tone="gray" />
        <Stat label="Abnormal" value={stats.abnormal} icon={AlertTriangle} tone="red" />
        <Stat label="Patients" value={stats.patients} icon={Heart} tone="blue" />
        <Stat label="Vital Types" value={stats.types} icon={TrendingUp} tone="purple" />
      </div>

      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
          <input type="text" placeholder="Search by patient or room..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select value={selectedResident} onChange={(e) => setSelectedResident(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none">
            <option value="all">All Patients</option>
            {residents.map((r) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
          </select>
          <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none">
            {VITAL_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-yellow-500" /> {VITAL_TYPES.find((t) => t.key === selectedType)?.label} Trend
        </h3>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis fontSize={11} tickLine={false} axisLine={false} width={40} />
              <Tooltip />
              {chartData.map((series, i) => (
                <Line key={i} data={series.data} type="monotone" dataKey="value" name={series.resident}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-gray-500 py-12 text-center">No readings for the selected vitals type and filters.</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Abnormal Vitals */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" /> Abnormal Readings ({abnormalVitals.length})
          </h3>
          {abnormalVitals.length > 0 ? (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {abnormalVitals.map((v) => (
                <div key={v.id} className="p-2.5 rounded-lg bg-amber-50 border border-amber-100">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-900 text-sm">{v.type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                    <span className="font-bold text-amber-700 text-sm">{v.value} {v.unit}</span>
                  </div>
                  <p className="text-xs text-gray-600 truncate">{v.resident} &middot; Room {v.room} &middot; {relTime(v.recordedAt, nowTs)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 py-8 text-center">All readings within normal range.</p>
          )}
        </div>

        {/* Latest by Patient */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Heart className="w-4 h-4 text-blue-500" /> Latest Readings by Patient
          </h3>
          {latestByResident.length > 0 ? (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {latestByResident.map(([rid, vMap]) => {
                const firstV = Object.values(vMap)[0];
                return (
                  <div key={rid} className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                    <p className="font-medium text-gray-900 text-sm">{firstV?.resident ?? "Unknown"}</p>
                    <div className="grid grid-cols-3 gap-1 mt-1">
                      {Object.entries(vMap).slice(0, 3).map(([type, v]) => (
                        <div key={type} className={`text-xs ${v.abnormal ? "text-amber-700 font-bold" : "text-gray-600"}`}>
                          {type.split("_")[0]}: {v.value}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500 py-8 text-center">No vitals data available.</p>
          )}
        </div>
      </div>
    </div>
  );
}

const TONES: Record<string, { wrap: string; icon: string; value: string }> = {
  gray: { wrap: "bg-white border-gray-200", icon: "text-gray-500", value: "text-gray-900" },
  blue: { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-500", value: "text-blue-600" },
  red: { wrap: "bg-red-50 border-red-200", icon: "text-red-500", value: "text-red-600" },
  purple: { wrap: "bg-purple-50 border-purple-200", icon: "text-purple-500", value: "text-purple-600" },
};
function Stat({ label, value, icon: Icon, tone }: { label: string; value: number; icon: LucideIcon; tone: keyof typeof TONES }) {
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
