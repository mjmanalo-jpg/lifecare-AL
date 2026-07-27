"use client";

import { useMemo, useState, useEffect } from "react";
import {
  Camera, Search, RefreshCw, AlertTriangle, TrendingDown, Bell,
  Activity, ChevronLeft, ChevronRight, HeartPulse, Thermometer, Wind,
  type LucideIcon,
} from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";

/**
 * Camera Activity Log — read-only manager review of the TIMESTAMPED per-resident
 * events captured by AI camera monitoring (fall/pre-fall/alert/analysis/snapshot).
 * Data is already recorded on CameraMonitoringLog; this UI lets a manager audit
 * every detection even when no one acted on the alert. No create/edit.
 */

type Row = Record<string, unknown>;

const asStr = (v: unknown): string => (v == null ? "" : String(v));
const asNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

const adaptLog = (r: Row) => ({
  id: asStr(r.id),
  residentName: asStr(r.residentName) || "—",
  roomNumber: asStr(r.roomNumber),
  logType: asStr(r.logType) || "ANALYSIS",
  emotion: asStr(r.emotion),
  emotionConfidence: asNum(r.emotionConfidence),
  behavior: asStr(r.behavior),
  posture: asStr(r.posture),
  alert: Boolean(r.alert),
  alertReason: asStr(r.alertReason),
  summary: asStr(r.summary),
  heartRate: asNum(r.heartRate),
  respirationRate: asNum(r.respirationRate),
  temperature: asNum(r.temperature),
  oxygen: asNum(r.oxygen),
  bloodPressureSys: asNum(r.bloodPressureSys),
  bloodPressureDia: asNum(r.bloodPressureDia),
  createdAt: asStr(r.createdAt),
});
type CameraLog = ReturnType<typeof adaptLog>;

const LOG_TYPES = [
  { value: "all", label: "All Events" },
  { value: "ANALYSIS", label: "Analysis" },
  { value: "FALL_DETECTION", label: "Fall Detection" },
  { value: "PRE_FALL_RISK", label: "Pre-Fall Risk" },
  { value: "ALERT", label: "Alert" },
  { value: "SNAPSHOT", label: "Snapshot" },
];

const LOG_TYPE_BADGE: Record<string, string> = {
  FALL_DETECTION: "bg-red-100 text-red-700 border-red-300",
  PRE_FALL_RISK: "bg-amber-100 text-amber-700 border-amber-300",
  ALERT: "bg-amber-100 text-amber-700 border-amber-300",
  ANALYSIS: "bg-gray-100 text-gray-600 border-gray-300",
  SNAPSHOT: "bg-gray-100 text-gray-600 border-gray-300",
};

function fmtDateTime(iso: string): { date: string; time: string } {
  if (!iso) return { date: "—", time: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "—", time: "" };
  return {
    date: d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
    time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
  };
}

export default function CameraActivityLog() {
  const { data: rows, loading, error, refetch } = useLiveQuery<Row>(
    "camera-monitoring-logs", { query: "take=500", tables: ["CameraMonitoringLog"] }
  );

  const logs = useMemo<CameraLog[]>(() => rows.map(adaptLog), [rows]);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  /* eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset to page 1 when filters change */
  useEffect(() => { setPage(1); }, [search, typeFilter, alertsOnly, fromDate, toDate, perPage]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromTs = fromDate ? new Date(fromDate + "T00:00:00").getTime() : null;
    const toTs = toDate ? new Date(toDate + "T23:59:59.999").getTime() : null;
    return logs
      .filter((l) => {
        if (q && !l.residentName.toLowerCase().includes(q) && !l.roomNumber.toLowerCase().includes(q)) return false;
        if (typeFilter !== "all" && l.logType !== typeFilter) return false;
        if (alertsOnly && !l.alert) return false;
        if (fromTs != null || toTs != null) {
          const t = new Date(l.createdAt).getTime();
          if (isNaN(t)) return false;
          if (fromTs != null && t < fromTs) return false;
          if (toTs != null && t > toTs) return false;
        }
        return true;
      })
      // Sortable by time, newest first.
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [logs, search, typeFilter, alertsOnly, fromDate, toDate]);

  const stats = useMemo(() => ({
    total: logs.length,
    falls: logs.filter((l) => l.logType === "FALL_DETECTION").length,
    preFalls: logs.filter((l) => l.logType === "PRE_FALL_RISK").length,
    alerts: logs.filter((l) => l.alert).length,
  }), [logs]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const start = (page - 1) * perPage;
  const paginated = filtered.slice(start, start + perPage);

  const resetFilters = () => {
    setSearch(""); setTypeFilter("all"); setAlertsOnly(false); setFromDate(""); setToDate("");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
            <Camera className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Camera Activity Log
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
            Timestamped events detected by AI monitoring
          </p>
        </div>
        <button onClick={() => void refetch()} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium self-start">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat label="Total Events" value={stats.total} icon={Activity} tone="gray" />
        <Stat label="Falls Detected" value={stats.falls} icon={TrendingDown} tone="red" />
        <Stat label="Pre-Fall Warnings" value={stats.preFalls} icon={AlertTriangle} tone="amber" />
        <Stat label="Alerts Raised" value={stats.alerts} icon={Bell} tone="blue" />
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Search resident or room…" value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
          </div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-yellow-400 outline-none">
            {LOG_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <button onClick={() => setAlertsOnly((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-semibold transition border ${
              alertsOnly ? "bg-red-500 text-white border-red-500" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}>
            <Bell className="w-4 h-4" /> Alerts Only
          </button>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-sm">
            <label className="text-gray-600 font-medium">From</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label className="text-gray-600 font-medium">To</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
          </div>
          {(search || typeFilter !== "all" || alertsOnly || fromDate || toDate) && (
            <button onClick={resetFilters} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 underline">Clear filters</button>
          )}
          <span className="text-sm text-gray-500 sm:ml-auto">{filtered.length} event{filtered.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load: {error}</div>}

      {/* Event log table */}
      {loading && logs.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading camera activity...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">No camera events match your filters.</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Time</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Resident &middot; Room</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Event</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Emotion / Behavior / Posture</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Vitals</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.map((l) => {
                const dt = fmtDateTime(l.createdAt);
                const highlight = l.logType === "FALL_DETECTION"
                  ? "bg-red-50 hover:bg-red-100"
                  : l.logType === "PRE_FALL_RISK"
                    ? "bg-amber-50 hover:bg-amber-100"
                    : "hover:bg-gray-50";
                return (
                  <tr key={l.id} className={`transition ${highlight}`}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-medium text-gray-900">{dt.time}</p>
                      <p className="text-xs text-gray-500">{dt.date}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{l.residentName}</p>
                      <p className="text-xs text-gray-500">Room {l.roomNumber || "—"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${LOG_TYPE_BADGE[l.logType] ?? LOG_TYPE_BADGE.ANALYSIS}`}>
                        {l.logType.replace(/_/g, " ")}
                      </span>
                      {l.alert && (
                        <span className="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500 text-white">
                          <Bell className="w-2.5 h-2.5" /> ALERT
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {l.emotion && (
                        <p>
                          <span className="text-gray-900 font-medium">{l.emotion}</span>
                          {l.emotionConfidence != null && <span className="text-gray-400"> ({Math.round(l.emotionConfidence)}%)</span>}
                        </p>
                      )}
                      {l.behavior && <p>Behavior: {l.behavior}</p>}
                      {l.posture && <p>Posture: {l.posture}</p>}
                      {!l.emotion && !l.behavior && !l.posture && <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      <div className="flex flex-col gap-0.5">
                        {l.heartRate != null && <span className="inline-flex items-center gap-1"><HeartPulse className="w-3 h-3 text-red-500" /> {l.heartRate} bpm</span>}
                        {l.temperature != null && <span className="inline-flex items-center gap-1"><Thermometer className="w-3 h-3 text-orange-500" /> {l.temperature}&deg;</span>}
                        {l.oxygen != null && <span className="inline-flex items-center gap-1"><Wind className="w-3 h-3 text-green-500" /> {l.oxygen}% SpO&#8322;</span>}
                        {l.heartRate == null && l.temperature == null && l.oxygen == null && <span className="text-gray-400">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-[260px]">
                      {l.alertReason && <p className="text-red-600 font-medium">{l.alertReason}</p>}
                      {l.summary && <p className="text-gray-600 mt-0.5" title={l.summary}>{l.summary}</p>}
                      {!l.alertReason && !l.summary && <span className="text-gray-400">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {filtered.length > perPage && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="text-sm text-gray-600">Showing {start + 1}–{Math.min(start + perPage, filtered.length)} of {filtered.length}</div>
            <select value={perPage} onChange={(e) => setPerPage(parseInt(e.target.value))}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none">
              <option value={10}>10 / page</option>
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium flex items-center gap-1 text-sm">
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <span className="px-3 py-2 text-sm font-medium text-gray-700">Page {page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium flex items-center gap-1 text-sm">
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────── */

const TONES: Record<string, { wrap: string; icon: string; value: string }> = {
  gray: { wrap: "bg-white border-gray-200", icon: "text-gray-500", value: "text-gray-900" },
  blue: { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-500", value: "text-blue-600" },
  red: { wrap: "bg-red-50 border-red-200", icon: "text-red-500", value: "text-red-600" },
  amber: { wrap: "bg-amber-50 border-amber-200", icon: "text-amber-500", value: "text-amber-600" },
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
