"use client";

import {
  Heart, Activity, HeartPulse, AlertTriangle, Droplets, Wind, Thermometer,
  Pill, Calendar, MessageSquare,
} from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { humanize } from "@/lib/adapters";
import {
  useRelative, useNowTs, relVitalsOf, latestVitalOf, ReportStat, LiveBadge,
  type Row,
} from "./shared";

const SNAPSHOT = [
  { key: "HEART_RATE", label: "Heart Rate", icon: Heart, color: "text-red-500" },
  { key: "BLOOD_PRESSURE", label: "Blood Pressure", icon: Droplets, color: "text-blue-500" },
  { key: "TEMPERATURE", label: "Temperature", icon: Thermometer, color: "text-orange-500" },
  { key: "OXYGEN", label: "Oxygen", icon: Wind, color: "text-green-500" },
];

/** Daily Report — a live one-page summary of the relative's day. */
export default function FamilyDailyReport() {
  const { relative, displayName } = useRelative();
  const nowTs = useNowTs();

  const { data: vitalsRows } = useLiveQuery("vitals", {
    query: "include=resident&take=50",
    tables: ["VitalsLog"],
  });
  const { data: visitRows } = useLiveQuery("visits", {
    query: "take=100",
    tables: ["Visit"],
  });
  const { data: messageRows } = useLiveQuery("messages", {
    query: "include=sender&take=100",
    tables: ["Message"],
  });

  const relVitals = relVitalsOf(vitalsRows, relative);
  const rawMeds = (relative?.raw?.medications ?? []) as Row[];
  const rawIncidents = (relative?.raw?.incidents ?? []) as Row[];

  const isToday = (iso: string) => {
    if (!iso || !nowTs) return false;
    const d = new Date(iso), n = new Date(nowTs);
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  };
  const vitalsToday = relVitals.filter((v) => isToday(String(v.recordedAt))).length;
  const openAlerts = rawIncidents.filter((i) => !i.resolvedAt).length;

  type Ev = { icon: typeof Heart; color: string; title: string; detail: string; ts: number; when: string };
  const t = (iso: unknown) => (iso ? new Date(String(iso)).getTime() : 0);
  const events: Ev[] = [
    ...relVitals.map((v) => ({ icon: HeartPulse, color: "text-red-500", title: `${humanize(String(v.type))} recorded`, detail: `${String(v.value)}${v.unit ? ` ${String(v.unit)}` : ""}`, ts: t(v.recordedAt), when: v.recordedAt ? new Date(String(v.recordedAt)).toLocaleString() : "" })),
    ...rawIncidents.map((i) => ({ icon: AlertTriangle, color: "text-orange-500", title: humanize(String(i.incidentType ?? "")) || "Incident", detail: String(i.description ?? ""), ts: t(i.incidentDate), when: i.incidentDate ? new Date(String(i.incidentDate)).toLocaleString() : "" })),
    ...visitRows.map((v: Row) => ({ icon: Calendar, color: "text-purple-500", title: `Visit — ${String(v.visitorName ?? "Guest")}`, detail: String(v.purpose ?? ""), ts: t(v.checkInTime), when: v.checkInTime ? new Date(String(v.checkInTime)).toLocaleString() : "" })),
    ...messageRows.map((m: Row) => ({ icon: MessageSquare, color: "text-blue-500", title: String(m.subject ?? humanize(String(m.messageType ?? ""))) || "Message", detail: String(m.content ?? ""), ts: t(m.createdAt), when: m.createdAt ? new Date(String(m.createdAt)).toLocaleString() : "" })),
  ].filter((e) => e.ts > 0).sort((a, b) => b.ts - a.ts).slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Activity className="w-6 h-6 text-yellow-500 flex-shrink-0" /> Daily Report
        </h1>
        <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
          <LiveBadge />
          {displayName} • {nowTs ? new Date(nowTs).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : "—"}
        </p>
      </div>

      {/* Live summary sentence */}
      <div className="bg-gradient-to-br from-green-50 to-blue-50 border border-green-200 rounded-lg p-5">
        <p className="text-gray-800">
          {displayName} has <span className="font-bold">{vitalsToday}</span> vital reading{vitalsToday === 1 ? "" : "s"} logged today,
          {" "}<span className="font-bold">{rawMeds.length}</span> active medication{rawMeds.length === 1 ? "" : "s"}, and
          {" "}{openAlerts > 0 ? <span className="font-bold text-red-600">{openAlerts} open alert{openAlerts === 1 ? "" : "s"}</span> : <span className="font-bold text-green-600">no open alerts</span>}. {openAlerts > 0 ? "Care staff are attending." : "All is well."}
        </p>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <ReportStat label="Vitals Today" value={vitalsToday} icon={HeartPulse} tone="rose" />
        <ReportStat label="Medications" value={rawMeds.length} icon={Pill} tone="blue" />
        <ReportStat label="Open Alerts" value={openAlerts} icon={AlertTriangle} tone={openAlerts > 0 ? "red" : "green"} />
        <ReportStat label="Total Vitals" value={relVitals.length} icon={Activity} tone="gray" />
      </div>

      {/* Vitals snapshot */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-3">Vitals Snapshot</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {SNAPSHOT.map(({ key, label, icon: Icon, color }) => {
            const v = latestVitalOf(relVitals, key);
            return (
              <div key={key} className="bg-white p-4 rounded-lg border border-gray-200">
                <p className="text-xs text-gray-600 font-semibold flex items-center gap-1"><Icon className={`w-3.5 h-3.5 ${color}`} /> {label}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{v ? String(v.value) : "—"}<span className="text-sm font-medium text-gray-500 ml-1">{v?.unit ? String(v.unit) : ""}</span></p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Activity timeline */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><Activity className="w-4 h-4 text-blue-500" /> Activity Timeline</h3>
          {events.length > 0 ? (
            <ol className="relative border-l-2 border-gray-100 ml-2 space-y-4">
              {events.map((e, i) => {
                const Icon = e.icon;
                return (
                  <li key={i} className="ml-4">
                    <span className="absolute -left-[9px] flex items-center justify-center w-4 h-4 bg-white rounded-full ring-2 ring-gray-100">
                      <Icon className={`w-3 h-3 ${e.color}`} />
                    </span>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 text-sm">{e.title}</p>
                        {e.detail && <p className="text-xs text-gray-600 truncate">{e.detail}</p>}
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">{e.when}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-sm text-gray-500 py-6 text-center">No recent activity recorded.</p>
          )}
        </div>

        {/* Medication schedule */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><Pill className="w-4 h-4 text-blue-500" /> Medications</h3>
          {rawMeds.length > 0 ? (
            <div className="space-y-2">
              {rawMeds.map((m, i) => (
                <div key={i} className="p-2.5 rounded-lg bg-blue-50 border border-blue-100">
                  <p className="font-medium text-gray-900 text-sm">💊 {String(m.name ?? "")} <span className="text-gray-500 font-normal">{String(m.dosage ?? "")}</span></p>
                  <p className="text-xs text-gray-600">{String(m.frequency ?? "")}{m.status ? ` • ${humanize(String(m.status))}` : ""}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 py-4 text-center">No active medications.</p>
          )}
        </div>
      </div>
    </div>
  );
}
