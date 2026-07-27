"use client";

import { useMemo } from "react";
import {
  Shield, ShieldAlert, DoorOpen, ClipboardList, MapPin, type LucideIcon,
} from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import SecurityLogBoard from "@/components/portal/views/security/SecurityLogBoard";
import CaregiverTimeClock from "@/components/portal/views/caregiver/CaregiverTimeClock";
import CameraActivityLog from "@/components/portal/views/clinical/CameraActivityLog";

/**
 * Guard/Security portal content — dispatches by `tab`:
 *   dashboard   → Security Command overview (stat cards + recent logs)
 *   securitylog → full SecurityLogBoard
 *   timeclock   → shared CaregiverTimeClock (same clock-in workflow)
 *   cameralogs  → placeholder (wired by another process)
 */

type Row = Record<string, unknown>;

const TYPE_LABEL: Record<string, string> = {
  PATROL: "Patrol",
  INCIDENT: "Incident",
  GATE_EVENT: "Gate Event",
  VISITOR: "Visitor",
  HAZARD: "Hazard",
};

const SEVERITY_PILL: Record<string, string> = {
  MINOR: "bg-gray-100 text-gray-700",
  MODERATE: "bg-yellow-100 text-yellow-800",
  SEVERE: "bg-orange-100 text-orange-800",
  CRITICAL: "bg-red-100 text-red-700",
};

const STATUS_PILL: Record<string, string> = {
  OPEN: "bg-amber-100 text-amber-800",
  RESOLVED: "bg-green-100 text-green-800",
};

export default function SecurityPortalContent({ tab }: { tab: string }) {
  if (tab === "securitylog") return <SecurityLogBoard />;
  if (tab === "timeclock") return <CaregiverTimeClock />;
  if (tab === "cameralogs") return <CameraActivityLog />;
  return <SecurityDashboard />;
}

/* ── Dashboard ── */

function SecurityDashboard() {
  const { data: rows, loading } = useLiveQuery<Row>(
    "security-logs", { query: "take=300", tables: ["SecurityLog"] }
  );

  const logs = useMemo(
    () => rows.map(r => ({
      id: String(r.id ?? ""),
      logType: String(r.logType ?? "PATROL"),
      title: String(r.title ?? ""),
      location: String(r.location ?? ""),
      severity: String(r.severity ?? "MINOR"),
      status: String(r.status ?? "OPEN"),
      occurredAt: r.occurredAt ? String(r.occurredAt) : "",
    })),
    [rows]
  );

  const stats = useMemo(() => ({
    total: logs.length,
    open: logs.filter(l => l.status === "OPEN").length,
    incidents: logs.filter(l => l.logType === "INCIDENT").length,
    gateEvents: logs.filter(l => l.logType === "GATE_EVENT").length,
  }), [logs]);

  const recent = useMemo(
    () => [...logs].sort((a, b) => (b.occurredAt || "").localeCompare(a.occurredAt || "")).slice(0, 8),
    [logs]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-slate-700 to-slate-900 bg-clip-text text-transparent mb-2 flex items-center gap-2">
          <Shield className="w-8 h-8 text-slate-700 flex-shrink-0" />
          Security Command
        </h1>
        <p className="text-gray-600">Live patrol, incident, gate and hazard overview for the facility.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatBox label="Total Logs" value={String(stats.total)} icon={ClipboardList} color="blue" />
        <StatBox label="Open" value={String(stats.open)} icon={Shield} color="amber" />
        <StatBox label="Incidents" value={String(stats.incidents)} icon={ShieldAlert} color="red" />
        <StatBox label="Gate Events" value={String(stats.gateEvents)} icon={DoorOpen} color="indigo" />
      </div>

      {/* Recent logs */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
          <ClipboardList className="w-4 h-4 text-slate-600" /> Recent Logs
        </h3>
        {loading && logs.length === 0 ? (
          <p className="text-sm text-gray-500 py-8 text-center">Loading security logs…</p>
        ) : recent.length === 0 ? (
          <p className="text-sm text-gray-500 py-8 text-center">No security logs recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {recent.map(l => (
              <div key={l.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 hover:border-slate-300 hover:shadow-sm transition">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-gray-900 truncate">{l.title || "Untitled log"}</p>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700">
                      {TYPE_LABEL[l.logType] ?? l.logType}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${SEVERITY_PILL[l.severity] ?? SEVERITY_PILL.MINOR}`}>{l.severity}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                    {l.location && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {l.location}</span>}
                    {l.occurredAt && <span>{new Date(l.occurredAt).toLocaleString()}</span>}
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold flex-shrink-0 ${STATUS_PILL[l.status] ?? "bg-gray-100 text-gray-700"}`}>{l.status}</span>
              </div>
            ))}
          </div>
        )}
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
    indigo: "text-indigo-600 bg-indigo-50 border-indigo-200",
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
