"use client";

import { useMemo } from "react";
import {
  DollarSign, Heart, Activity, HeartPulse, MessageSquare, Calendar,
  AlertTriangle, ClipboardList,
} from "lucide-react";
import StatCard from "@/components/portal/widgets/StatCard";
import ChartContainer from "@/components/portal/widgets/ChartContainer";
import VitalsPanel, { VitalReading } from "@/components/portal/widgets/VitalsPanel";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptIncident, humanize } from "@/lib/adapters";
import AppointmentCalendar from "@/components/portal/AppointmentCalendar";
import {
  useRelative, Panel, LiveBadge, EMPTY_VITALS_TREND, type Row,
} from "./shared";

/** Family Dashboard — the live overview that ties every module together. */
export default function FamilyDashboard() {
  const { relative, displayName } = useRelative();

  const { data: vitalsRows, loading: vitalsLoading } = useLiveQuery("vitals", {
    query: "include=resident&take=50",
    tables: ["VitalsLog"],
  });
  const { data: incidentRows } = useLiveQuery("incidents", {
    query: "include=resident&take=50",
    tables: ["Incident"],
  });
  const { data: messageRows } = useLiveQuery("messages", {
    query: "include=sender&take=100",
    tables: ["Message"],
  });
  const { data: invoiceRows } = useLiveQuery("invoices", {
    query: "include=resident&take=100",
    tables: ["Invoice"],
  });
  const { data: visitRows } = useLiveQuery("visits", {
    query: "take=100",
    tables: ["Visit"],
  });
  const { data: taskRows } = useLiveQuery("tasks", {
    query: "take=50",
    tables: ["Task"],
  });

  const incidents = useMemo(() => incidentRows.map(adaptIncident), [incidentRows]);

  // Live vitals panel readings derived from the latest of each vital type.
  const liveVitals = useMemo<VitalReading[]>(() => {
    const wanted: VitalReading["type"][] = ["HEART_RATE", "TEMPERATURE", "BLOOD_PRESSURE", "OXYGEN"];
    const unitFor: Record<string, string> = {
      HEART_RATE: "bpm", TEMPERATURE: "°C", BLOOD_PRESSURE: "mmHg", OXYGEN: "%",
    };
    const readings: VitalReading[] = [];
    for (const type of wanted) {
      const row = vitalsRows.find((v: Row) => v.type === type);
      if (!row) continue;
      const numeric = parseFloat(String(row.value));
      readings.push({
        type,
        value: isNaN(numeric) ? 0 : numeric,
        unit: (row.unit as string) ?? unitFor[type] ?? "",
        normal: true,
        lastUpdated: row.recordedAt ? new Date(row.recordedAt as string) : new Date(),
      });
    }
    return readings;
  }, [vitalsRows]);

  // Heart-rate trend for the dashboard chart (real data if present).
  const heartRateTrend = useMemo(() => {
    return vitalsRows
      .filter((v: Row) => v.type === "HEART_RATE")
      .slice(0, 12)
      .reverse()
      .map((v: Row) => {
        const numeric = parseFloat(String(v.value));
        return {
          name: v.recordedAt
            ? new Date(v.recordedAt as string).toLocaleDateString([], { month: "short", day: "numeric" })
            : "",
          value: isNaN(numeric) ? 0 : numeric,
        };
      });
  }, [vitalsRows]);

  const unreadMessages = messageRows.filter((m: Row) => !m.isRead).length;

  const balanceDue = invoiceRows.reduce((sum: number, inv: Row) => {
    if (String(inv.status ?? "") === "PAID") return sum;
    const total = parseFloat(String(inv.totalAmount ?? 0)) || 0;
    const paid = parseFloat(String(inv.amountPaid ?? 0)) || 0;
    return sum + Math.max(0, total - paid);
  }, 0);

  const tasks = relative ? taskRows.filter((t) => !t.residentId || t.residentId === relative.id) : taskRows;
  const openTasks = tasks.filter((t) => String(t.status) !== "COMPLETED" && String(t.status) !== "CANCELLED");

  const recentMessages = messageRows.slice(0, 3);
  const upcomingVisits = visitRows.slice(0, 3);
  const topAlerts = incidents.slice(0, 4);
  const latestHR = liveVitals.find((v) => v.type === "HEART_RATE");

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Heart className="w-5 h-5 sm:w-6 sm:h-6 text-red-500 flex-shrink-0" /> Welcome — {displayName}
        </h1>
        <p className="text-gray-600 flex items-center gap-2 text-xs sm:text-sm mt-1">
          <LiveBadge />
          {relative ? `Room ${relative.room} • ${humanize(relative.careLevel)} Care${relative.age != null ? ` • Age ${relative.age}` : ""}` : "Your family member's care overview"}
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-3 lg:gap-4">
        <StatCard
          title="Care Status"
          value={relative && relative.alertsCount > 0 ? `${relative.alertsCount} alert${relative.alertsCount === 1 ? "" : "s"}` : "Stable"}
          icon={Activity}
          backgroundColor={relative && relative.alertsCount > 0 ? "bg-red-50" : "bg-green-50"}
          textColor={relative && relative.alertsCount > 0 ? "text-red-900" : "text-green-900"}
          iconColor={relative && relative.alertsCount > 0 ? "text-red-500" : "text-green-500"}
        />
        <StatCard
          title="Heart Rate"
          value={latestHR ? String(latestHR.value) : "—"}
          unit={latestHR ? "bpm" : ""}
          icon={HeartPulse}
          backgroundColor="bg-rose-50"
          textColor="text-rose-900"
          iconColor="text-rose-500"
        />
        <StatCard
          title="Unread Messages"
          value={String(unreadMessages)}
          icon={MessageSquare}
          backgroundColor="bg-blue-50"
          textColor="text-blue-900"
          iconColor="text-blue-500"
        />
        <StatCard
          title="Appointments"
          value={String(visitRows.length)}
          icon={Calendar}
          backgroundColor="bg-purple-50"
          textColor="text-purple-900"
          iconColor="text-purple-500"
        />
        <StatCard
          title="Balance Due"
          value={`₱${balanceDue.toFixed(0)}`}
          icon={DollarSign}
          backgroundColor="bg-yellow-50"
          textColor="text-yellow-900"
          iconColor="text-yellow-500"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6">
        {/* Left column: relative + vitals + trend */}
        <div className="xl:col-span-2 space-y-4 sm:space-y-6">
          {relative && (
            <div className="bg-white rounded-lg p-4 sm:p-6 border border-gray-200">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-lg sm:text-xl font-bold text-gray-900">{relative.name}</h3>
                  <p className="text-gray-600 text-xs sm:text-sm mt-1">Room {relative.room} • {humanize(relative.careLevel)} Care{relative.age != null ? ` • Age ${relative.age}` : ""}</p>
                </div>
                {relative.alertsCount > 0 && (
                  <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-semibold flex-shrink-0">
                    {relative.alertsCount} active alert{relative.alertsCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              {(relative.allergies || relative.medicalHistory) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs font-semibold text-gray-600 mb-1">Allergies</p>
                    <p className="text-sm text-gray-900">{relative.allergies || "None recorded"}</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs font-semibold text-gray-600 mb-1">Medical History</p>
                    <p className="text-sm text-gray-900">{relative.medicalHistory || "None recorded"}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {vitalsLoading && vitalsRows.length === 0 ? (
            <VitalsPanel vitals={[]} resident={displayName} isLoading />
          ) : (
            <VitalsPanel vitals={liveVitals} resident={displayName} />
          )}

          <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200">
            <ChartContainer
              title="Heart Rate Trend"
              type="area"
              data={heartRateTrend.length ? heartRateTrend : EMPTY_VITALS_TREND}
              dataKey="value"
              xAxisKey="name"
              colors={["#ef4444"]}
              height={220}
            />
          </div>
        </div>

        {/* Right column: alerts, care team, messages, appointments */}
        <div className="space-y-4 sm:space-y-6">
          {relative && <AppointmentCalendar residentId={relative.id} residentName={relative.name} title="Calendar" />}
          <Panel title="Recent Alerts" icon={AlertTriangle} count={incidents.length}>
            {topAlerts.length > 0 ? (
              <div className="space-y-2">
                {topAlerts.map((inc) => (
                  <div key={inc.id} className={`p-2.5 rounded-lg border ${inc.severity === "critical" || inc.severity === "high" ? "bg-red-50 border-red-100" : "bg-gray-50 border-gray-200"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-900 text-sm truncate">{inc.type}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0 ${
                        inc.severity === "critical" ? "bg-red-100 text-red-700" : inc.severity === "high" ? "bg-orange-100 text-orange-700" : inc.severity === "medium" ? "bg-yellow-100 text-yellow-700" : "bg-blue-100 text-blue-700"
                      }`}>{inc.severity.toUpperCase()}</span>
                    </div>
                    <p className="text-xs text-gray-600 truncate">{inc.description || "Incident recorded"}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg p-3">✔ All vitals stable — no active alerts.</p>
            )}
          </Panel>

          <Panel title="Care Team Activity" icon={ClipboardList} count={openTasks.length}>
            {tasks.length > 0 ? (
              <div className="space-y-2">
                {tasks.slice(0, 3).map((t: Row, i: number) => (
                  <div key={(t.id as string) ?? i} className="p-2.5 rounded-lg bg-purple-50/60 border border-purple-100">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-medium text-sm truncate ${String(t.status) === "COMPLETED" ? "text-gray-500 line-through" : "text-gray-900"}`}>{String(t.title ?? "Care task")}</span>
                      <span className="text-xs text-gray-600 flex-shrink-0">{humanize(String(t.status ?? "PENDING"))}</span>
                    </div>
                    <p className="text-xs text-gray-600 truncate">Due {t.dueDate ? new Date(String(t.dueDate)).toLocaleDateString() : "—"}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 py-4 text-center">No care tasks scheduled.</p>
            )}
          </Panel>

          <Panel title="Recent Messages" icon={MessageSquare} count={unreadMessages}>
            {recentMessages.length > 0 ? (
              <div className="space-y-2">
                {recentMessages.map((m: Row, i: number) => (
                  <div key={(m.id as string) ?? i} className={`p-2.5 rounded-lg border ${m.isRead ? "border-gray-200" : "border-blue-200 bg-blue-50/50"}`}>
                    <p className="font-medium text-gray-900 text-sm truncate">{(m.subject as string) || humanize(m.messageType as string) || "Message"}</p>
                    <p className="text-xs text-gray-600 truncate">{(m.content as string) ?? ""}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 py-4 text-center">No messages yet.</p>
            )}
          </Panel>

          <Panel title="Upcoming Appointments" icon={Calendar} count={visitRows.length}>
            {upcomingVisits.length > 0 ? (
              <div className="space-y-2">
                {upcomingVisits.map((v: Row, i: number) => (
                  <div key={(v.id as string) ?? i} className="p-2.5 rounded-lg bg-purple-50 border border-purple-100">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-900 text-sm truncate">{(v.visitorName as string) ?? "Visit"}</span>
                      <span className="text-xs text-gray-600 flex-shrink-0">{v.checkInTime ? new Date(v.checkInTime as string).toLocaleDateString() : "—"}</span>
                    </div>
                    <p className="text-xs text-gray-600 truncate">{(v.relationship as string) ?? ""}{v.purpose ? ` • ${String(v.purpose)}` : ""}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 py-4 text-center">No appointments scheduled.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
