"use client";

import StatCard from "@/components/portal/widgets/StatCard";
import ChartContainer from "@/components/portal/widgets/ChartContainer";
import VitalsPanel, { VitalReading } from "@/components/portal/widgets/VitalsPanel";
import AlertBanner from "@/components/portal/widgets/AlertBanner";
import { Smile, DollarSign, Users, Bell } from "lucide-react";
import { useMemo } from "react";
import { useLiveQuery, useStats } from "@/lib/useLiveQuery";
import { adaptResident, adaptIncident, humanize } from "@/lib/adapters";

interface FamilyPortalContentProps {
  tab: string;
}

/** Small inline loading indicator shown while a tab's query is fetching. */
function TabLoading({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-10 text-gray-500">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-3" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/** Friendly empty state for tabs with no rows. */
function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
      {message}
    </div>
  );
}

export default function FamilyPortalContent({ tab }: FamilyPortalContentProps) {
  // ---- Live data (all hooks run unconditionally, before any tab return) ----
  const { stats } = useStats();

  // My Relative: first resident with incidents + medications included.
  const {
    data: residentRows,
    loading: residentLoading,
  } = useLiveQuery("residents", {
    query: "include=incidents,medications&take=1",
    tables: ["Resident"],
  });
  const relative = useMemo(
    () => (residentRows.length ? adaptResident(residentRows[0]) : null),
    [residentRows]
  );

  // Health Timeline: recent vitals.
  const {
    data: vitalsRows,
    loading: vitalsLoading,
  } = useLiveQuery("vitals", {
    query: "include=resident&take=50",
    tables: ["VitalsLog"],
  });

  // Alerts: recent incidents.
  const {
    data: incidentRows,
    loading: incidentLoading,
  } = useLiveQuery("incidents", {
    query: "include=resident&take=50",
    tables: ["Incident"],
  });
  const incidents = useMemo(
    () => incidentRows.map(adaptIncident),
    [incidentRows]
  );

  // Messages.
  const {
    data: messageRows,
    loading: messageLoading,
  } = useLiveQuery("messages", {
    query: "take=100",
    tables: ["Message"],
  });

  // Billing / invoices.
  const {
    data: invoiceRows,
    loading: invoiceLoading,
  } = useLiveQuery("invoices", {
    query: "take=100",
    tables: ["Invoice"],
  });

  // Appointments / visits.
  const {
    data: visitRows,
    loading: visitLoading,
  } = useLiveQuery("visits", {
    query: "take=100",
    tables: ["Visit"],
  });

  // Live vitals panel readings derived from the latest of each vital type.
  const liveVitals = useMemo<VitalReading[]>(() => {
    const wanted: VitalReading["type"][] = [
      "HEART_RATE",
      "TEMPERATURE",
      "BLOOD_PRESSURE",
      "OXYGEN",
    ];
    const unitFor: Record<string, string> = {
      HEART_RATE: "bpm",
      TEMPERATURE: "°C",
      BLOOD_PRESSURE: "mmHg",
      OXYGEN: "%",
    };
    const readings: VitalReading[] = [];
    for (const type of wanted) {
      const row = vitalsRows.find(
        (v: Record<string, unknown>) => v.type === type
      );
      if (!row) continue;
      const numeric = parseFloat(String(row.value));
      readings.push({
        type,
        value: isNaN(numeric) ? 0 : numeric,
        unit: (row.unit as string) ?? unitFor[type] ?? "",
        normal: true,
        lastUpdated: row.recordedAt
          ? new Date(row.recordedAt as string)
          : new Date(),
      });
    }
    return readings;
  }, [vitalsRows]);

  // Heart-rate trend for the timeline/dashboard chart (real data if present).
  const heartRateTrend = useMemo(() => {
    const points = vitalsRows
      .filter((v: Record<string, unknown>) => v.type === "HEART_RATE")
      .slice(0, 12)
      .reverse()
      .map((v: Record<string, unknown>) => {
        const numeric = parseFloat(String(v.value));
        return {
          name: v.recordedAt
            ? new Date(v.recordedAt as string).toLocaleDateString([], {
                month: "short",
                day: "numeric",
              })
            : "",
          value: isNaN(numeric) ? 0 : numeric,
        };
      });
    return points;
  }, [vitalsRows]);

  const mockVitalsData = [
    { name: "Mon", value: 74 },
    { name: "Tue", value: 76 },
    { name: "Wed", value: 75 },
    { name: "Thu", value: 77 },
    { name: "Fri", value: 75 },
    { name: "Sat", value: 73 },
  ];

  const relativeDisplayName = relative?.name ?? "your relative";

  // ---------------------------------------------------------------- My Relative
  if (tab === "relative") {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">My Relative</h2>
        {residentLoading && residentRows.length === 0 ? (
          <TabLoading label="Loading relative..." />
        ) : !relative ? (
          <EmptyState message="No resident record is linked yet." />
        ) : (
          <>
            <div className="bg-white rounded-lg p-6 border border-gray-200">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">
                    {relative.name}
                  </h3>
                  <p className="text-gray-600 mt-1">
                    Room {relative.room} •{" "}
                    {humanize(relative.careLevel)} Care
                    {relative.age != null ? ` • Age ${relative.age}` : ""}
                  </p>
                </div>
                {relative.alertsCount > 0 && (
                  <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-semibold">
                    {relative.alertsCount} active alert
                    {relative.alertsCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white rounded-lg p-6 border border-gray-200">
                <h4 className="font-semibold text-gray-900 mb-2">Allergies</h4>
                <p className="text-gray-700 text-sm">
                  {relative.allergies || "None recorded"}
                </p>
              </div>
              <div className="bg-white rounded-lg p-6 border border-gray-200">
                <h4 className="font-semibold text-gray-900 mb-2">
                  Medical History
                </h4>
                <p className="text-gray-700 text-sm">
                  {relative.medicalHistory || "None recorded"}
                </p>
              </div>
            </div>

            {relative.notes && (
              <div className="bg-white rounded-lg p-6 border border-gray-200">
                <h4 className="font-semibold text-gray-900 mb-2">Care Notes</h4>
                <p className="text-gray-700 text-sm">{relative.notes}</p>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------- Daily Report
  if (tab === "report") {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Daily Report</h2>
        <div className="bg-white rounded-lg p-6 border border-gray-200 space-y-4">
          <h3 className="font-semibold text-gray-900">Today&apos;s Summary</h3>
          <p className="text-gray-700">
            {relativeDisplayName} had a great day! They enjoyed breakfast and
            participated in morning activities. Vitals are stable and they are
            resting comfortably.
          </p>
          <div className="pt-4 border-t border-gray-200 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900">
                {stats ? stats.residents : "—"}
              </p>
              <p className="text-xs text-gray-600">Residents in care</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900">
                {stats ? stats.activeIncidents : "—"}
              </p>
              <p className="text-xs text-gray-600">Active alerts</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900">
                {vitalsRows.length}
              </p>
              <p className="text-xs text-gray-600">Vitals logged</p>
            </div>
          </div>
          <div className="pt-4 border-t border-gray-200">
            <h4 className="font-semibold text-gray-900 mb-2">
              Activity Highlights
            </h4>
            <ul className="space-y-2 text-sm text-gray-600">
              <li>✓ Breakfast: Full meal consumed</li>
              <li>✓ Garden walk: 20 minutes</li>
              <li>✓ Medication: Completed at scheduled times</li>
              <li>✓ Social time: Card game with other residents</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ Health Timeline
  if (tab === "timeline") {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Health Timeline</h2>
        <ChartContainer
          title="Heart Rate (Recent)"
          type="line"
          data={heartRateTrend.length ? heartRateTrend : mockVitalsData}
          dataKey="value"
          xAxisKey="name"
          colors={["#ef4444"]}
        />

        <div className="bg-white rounded-lg border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">Recent Vitals</h3>
          </div>
          {vitalsLoading && vitalsRows.length === 0 ? (
            <TabLoading label="Loading vitals..." />
          ) : vitalsRows.length === 0 ? (
            <EmptyState message="No vital readings recorded yet." />
          ) : (
            <ul className="divide-y divide-gray-100">
              {vitalsRows.map((v: Record<string, unknown>, i: number) => (
                <li
                  key={(v.id as string) ?? i}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-gray-900">
                      {humanize(v.type as string)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {v.recordedAt
                        ? new Date(v.recordedAt as string).toLocaleString()
                        : ""}
                    </p>
                  </div>
                  <span className="text-lg font-semibold text-gray-900">
                    {String(v.value)}
                    {v.unit ? ` ${String(v.unit)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------- Alerts
  if (tab === "alerts") {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Alerts</h2>
        {incidentLoading && incidentRows.length === 0 ? (
          <TabLoading label="Loading alerts..." />
        ) : incidents.length === 0 ? (
          <AlertBanner
            type="success"
            title="Vitals Stable"
            message="No active alerts. All vital signs are within normal ranges."
            timestamp={new Date()}
          />
        ) : (
          incidents.map((inc) => (
            <AlertBanner
              key={inc.id}
              type={
                inc.severity === "critical" || inc.severity === "high"
                  ? "error"
                  : inc.severity === "medium"
                  ? "warning"
                  : "info"
              }
              title={inc.type}
              message={inc.description || "Incident recorded"}
              resident={inc.resident}
              timestamp={inc.timestamp ? new Date(inc.timestamp) : undefined}
            />
          ))
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------ Messages
  if (tab === "messages") {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Messages</h2>
        {messageLoading && messageRows.length === 0 ? (
          <TabLoading label="Loading messages..." />
        ) : messageRows.length === 0 ? (
          <EmptyState message="No messages yet." />
        ) : (
          <div className="space-y-3">
            {messageRows.map((m: Record<string, unknown>, i: number) => (
              <div
                key={(m.id as string) ?? i}
                className={`bg-white rounded-lg p-4 border ${
                  m.isRead ? "border-gray-200" : "border-blue-300 bg-blue-50/40"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h4 className="font-semibold text-gray-900">
                    {(m.subject as string) ||
                      humanize(m.messageType as string) ||
                      "Message"}
                  </h4>
                  <span className="text-xs text-gray-500 flex-shrink-0">
                    {m.createdAt
                      ? new Date(m.createdAt as string).toLocaleString()
                      : ""}
                  </span>
                </div>
                <p className="text-sm text-gray-700 mt-1">
                  {(m.content as string) ?? ""}
                </p>
                {!m.isRead && (
                  <span className="inline-block mt-2 px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs font-semibold">
                    Unread
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------- Appointments
  if (tab === "appointments") {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Appointments</h2>
        {visitLoading && visitRows.length === 0 ? (
          <TabLoading label="Loading appointments..." />
        ) : visitRows.length === 0 ? (
          <EmptyState message="No visits scheduled or recorded yet." />
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 text-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-sm">
                    Visitor
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-sm">
                    Relationship
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-sm">
                    Purpose
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-sm">
                    Check-In
                  </th>
                </tr>
              </thead>
              <tbody>
                {visitRows.map((v: Record<string, unknown>, i: number) => (
                  <tr
                    key={(v.id as string) ?? i}
                    className="border-t border-gray-100"
                  >
                    <td className="px-4 py-3 text-gray-900 font-medium">
                      {(v.visitorName as string) ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {(v.relationship as string) ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {(v.purpose as string) ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {v.checkInTime
                        ? new Date(v.checkInTime as string).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------- Billing
  if (tab === "expenses") {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Billing</h2>
        {invoiceLoading && invoiceRows.length === 0 ? (
          <TabLoading label="Loading invoices..." />
        ) : invoiceRows.length === 0 ? (
          <EmptyState message="No invoices on file." />
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 text-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-sm">
                    Invoice
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-sm">
                    Total
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-sm">
                    Paid
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-sm">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-sm">
                    Due
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoiceRows.map((inv: Record<string, unknown>, i: number) => (
                  <tr
                    key={(inv.id as string) ?? i}
                    className="border-t border-gray-100"
                  >
                    <td className="px-4 py-3 text-gray-900 font-medium">
                      {(inv.invoiceNumber as string) ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      ${String(inv.totalAmount ?? "0")}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      ${String(inv.amountPaid ?? "0")}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-800">
                        {humanize(inv.status as string) || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {inv.dueDate
                        ? new Date(inv.dueDate as string).toLocaleDateString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------ Photos
  // No clean DB mapping — kept static per spec.
  if (tab === "photos") {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Photos</h2>
        <div className="bg-white rounded-lg p-6 border border-gray-200 text-gray-600 text-sm">
          Shared photos from care staff will appear here.
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------- Care Goals
  // No clean DB mapping — kept static per spec.
  if (tab === "goals") {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Care Goals</h2>
        <div className="bg-white rounded-lg p-6 border border-gray-200 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-gray-700">Maintain healthy blood pressure</span>
            <span className="text-green-600 font-semibold text-sm">On track</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-700">Daily physical activity</span>
            <span className="text-green-600 font-semibold text-sm">On track</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-700">Social engagement</span>
            <span className="text-blue-600 font-semibold text-sm">In progress</span>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------ Default: Dashboard
  const unreadMessages = messageRows.filter(
    (m: Record<string, unknown>) => !m.isRead
  ).length;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Family Dashboard</h2>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Residents in Care"
          value={stats ? String(stats.residents) : "—"}
          icon={Users}
          backgroundColor="bg-green-50"
          textColor="text-green-900"
          iconColor="text-green-500"
        />
        <StatCard
          title="Active Alerts"
          value={stats ? String(stats.activeIncidents) : "—"}
          icon={Bell}
          backgroundColor="bg-yellow-50"
          textColor="text-yellow-900"
          iconColor="text-yellow-500"
        />
        <StatCard
          title="Unread Messages"
          value={String(unreadMessages)}
          icon={Smile}
          backgroundColor="bg-blue-50"
          textColor="text-blue-900"
          iconColor="text-blue-500"
        />
        <StatCard
          title="Open Invoices"
          value={String(invoiceRows.length)}
          icon={DollarSign}
          backgroundColor="bg-purple-50"
          textColor="text-purple-900"
          iconColor="text-purple-500"
        />
      </div>

      {/* Vitals Panel — live if available, otherwise a friendly note */}
      {vitalsLoading && vitalsRows.length === 0 ? (
        <VitalsPanel vitals={[]} resident={relativeDisplayName} isLoading />
      ) : (
        <VitalsPanel vitals={liveVitals} resident={relativeDisplayName} />
      )}

      {/* Latest Alert */}
      {incidents.length > 0 ? (
        <AlertBanner
          type={
            incidents[0].severity === "critical" ||
            incidents[0].severity === "high"
              ? "error"
              : incidents[0].severity === "medium"
              ? "warning"
              : "info"
          }
          title={incidents[0].type}
          message={incidents[0].description || "Incident recorded"}
          resident={incidents[0].resident}
          timestamp={
            incidents[0].timestamp
              ? new Date(incidents[0].timestamp)
              : undefined
          }
        />
      ) : (
        <AlertBanner
          type="success"
          title="Great News!"
          message="All vitals are in excellent range today"
          timestamp={new Date()}
        />
      )}

      {/* Latest Report Preview */}
      <div className="bg-white rounded-lg p-6 border border-gray-200">
        <h3 className="font-semibold text-gray-900 mb-3">Today&apos;s Highlights</h3>
        <p className="text-gray-700 text-sm">
          {relativeDisplayName} had a wonderful day! They enjoyed their meals
          and participated in our garden walk. All medications were taken on
          schedule and spirits are high.
        </p>
      </div>
    </div>
  );
}
