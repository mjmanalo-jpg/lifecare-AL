"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState } from "react";
import { AlertTriangle, Activity, CheckCircle2, RefreshCw, Search } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptIncident } from "@/lib/adapters";
import {
  useRelative, useNowTs, relTime, ReportStat, TabLoading, EmptyState, LiveBadge,
} from "./shared";

const SEV: Record<string, { label: string; badge: string; border: string; bar: string; color: string }> = {
  critical: { label: "Critical", badge: "bg-red-100 text-red-700", border: "border-l-red-500", bar: "bg-red-500", color: "text-red-500" },
  high: { label: "High", badge: "bg-orange-100 text-orange-700", border: "border-l-orange-500", bar: "bg-orange-500", color: "text-orange-500" },
  medium: { label: "Medium", badge: "bg-yellow-100 text-yellow-700", border: "border-l-yellow-500", bar: "bg-yellow-500", color: "text-yellow-600" },
  low: { label: "Low", badge: "bg-blue-100 text-blue-700", border: "border-l-blue-500", bar: "bg-blue-500", color: "text-blue-500" },
};
const SEV_KEYS = ["critical", "high", "medium", "low"] as const;

/** Alerts — live incident feed scoped to the linked relative, with filters. */
export default function FamilyAlerts() {
  const { relative, displayName } = useRelative();
  const nowTs = useNowTs();

  const { data: incidentRows, loading: incidentLoading, refetch: refetchIncidents } = useLiveQuery("incidents", {
    query: "include=resident&take=50",
    tables: ["Incident"],
  });

  const [alertSeverity, setAlertSeverity] = useState<string>("all");
  const [alertStatus, setAlertStatus] = useState<string>("all");
  const [alertSearch, setAlertSearch] = useState("");

  const incidents = useMemo(() => incidentRows.map(adaptIncident), [incidentRows]);
  // Scope to this relative when linked (family view); otherwise show all.
  const relAlerts = relative ? incidents.filter((i) => i.room === relative.room) : incidents;

  const openCount = relAlerts.filter((i) => !i.resolved).length;
  const criticalCount = relAlerts.filter((i) => (i.severity === "critical" || i.severity === "high") && !i.resolved).length;
  const resolvedCount = relAlerts.filter((i) => i.resolved).length;
  const sevCounts = SEV_KEYS.map((k) => ({ key: k, count: relAlerts.filter((i) => i.severity === k).length }));
  const maxSev = Math.max(1, ...sevCounts.map((s) => s.count));

  const q = alertSearch.trim().toLowerCase();
  const filtered = relAlerts
    .filter((i) => alertSeverity === "all" || i.severity === alertSeverity)
    .filter((i) => alertStatus === "all" || (alertStatus === "open" ? !i.resolved : i.resolved))
    .filter((i) => !q || i.type.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q) || i.resident.toLowerCase().includes(q))
    .sort((a, b) => new Date(String(b.timestamp ?? 0)).getTime() - new Date(String(a.timestamp ?? 0)).getTime());

  const rel = (iso: unknown) => (iso ? relTime(new Date(String(iso)).getTime(), nowTs) : "");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-orange-500 flex-shrink-0" /> Alerts
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
            <LiveBadge />
            Safety &amp; health events for {displayName}
          </p>
        </div>
        <RefreshButton onRefresh={() => void refetchIncidents()} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium self-start" />
      </div>

      {/* All-clear banner */}
      {relAlerts.length > 0 && openCount === 0 && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5" /> All alerts resolved — {displayName} is stable.
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <ReportStat label="Total Alerts" value={relAlerts.length} icon={AlertTriangle} tone="gray" />
        <ReportStat label="Open" value={openCount} icon={Activity} tone={openCount > 0 ? "red" : "green"} />
        <ReportStat label="Critical / High" value={criticalCount} icon={AlertTriangle} tone={criticalCount > 0 ? "red" : "green"} />
        <ReportStat label="Resolved" value={resolvedCount} icon={CheckCircle2} tone="green" />
      </div>

      {/* Severity breakdown */}
      {relAlerts.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Severity Breakdown</h3>
          <div className="space-y-2">
            {sevCounts.map(({ key, count }) => (
              <div key={key} className="flex items-center gap-3">
                <span className="w-16 text-xs font-semibold text-gray-600">{SEV[key].label}</span>
                <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full ${SEV[key].bar} transition-all`} style={{ width: `${(count / maxSev) * 100}%` }} />
                </div>
                <span className="w-6 text-sm font-bold text-gray-700 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <select value={alertSeverity} onChange={(e) => setAlertSeverity(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-orange-400 outline-none">
          <option value="all">All Severities</option>
          {SEV_KEYS.map((k) => <option key={k} value={k}>{SEV[k].label}</option>)}
        </select>
        <select value={alertStatus} onChange={(e) => setAlertStatus(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-orange-400 outline-none">
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
          <input type="text" placeholder="Search alerts…" value={alertSearch} onChange={(e) => setAlertSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-orange-400 focus:border-transparent outline-none" />
        </div>
      </div>

      {/* List */}
      {incidentLoading && incidentRows.length === 0 ? (
        <TabLoading label="Loading alerts..." />
      ) : relAlerts.length === 0 ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-6 text-center text-green-800 font-semibold flex items-center justify-center gap-2">
          <CheckCircle2 className="w-5 h-5" /> No alerts. All vital signs are within normal ranges.
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState message="No alerts match your filters." />
      ) : (
        <div className="space-y-3">
          {filtered.map((inc) => {
            const meta = SEV[inc.severity] ?? SEV.low;
            return (
              <div key={inc.id} className={`bg-white rounded-lg border border-gray-200 border-l-4 ${meta.border} p-4`}>
                <div className="flex items-start gap-3">
                  <AlertTriangle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${meta.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <h4 className={`font-semibold ${inc.resolved ? "text-gray-500 line-through" : "text-gray-900"}`}>{inc.type}</h4>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${meta.badge}`}>{meta.label}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${inc.resolved ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{inc.resolved ? "Resolved" : "Open"}</span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mt-0.5">{inc.resident}{inc.room ? ` • Room ${inc.room}` : ""}</p>
                    {inc.description && <p className="text-sm text-gray-800 mt-2">{inc.description}</p>}
                    {inc.notes && <p className="text-sm text-gray-600 mt-2 p-2 bg-gray-50 rounded border-l-2 border-yellow-400">📝 {inc.notes}</p>}
                    <p className="text-xs text-gray-400 mt-2">{inc.timestamp ? new Date(String(inc.timestamp)).toLocaleString() : ""}{rel(inc.timestamp) ? ` • ${rel(inc.timestamp)}` : ""}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
