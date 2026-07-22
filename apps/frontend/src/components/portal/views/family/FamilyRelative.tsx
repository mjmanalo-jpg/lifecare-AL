"use client";

import { useState } from "react";
import {
  Heart, Activity, HeartPulse, AlertTriangle, Droplets, Wind, Thermometer,
  Pill, CheckCircle2,
} from "lucide-react";
import ChartContainer from "@/components/portal/widgets/ChartContainer";
import CameraVisionFeed from "@/components/CameraVisionFeed";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { humanize } from "@/lib/adapters";
import {
  useRelative, relVitalsOf, latestVitalOf, TabLoading, EmptyState,
  LiveBadge, EMPTY_VITALS_TREND, type Row,
} from "./shared";

const VITALS = [
  { key: "HEART_RATE", label: "Heart Rate", icon: Heart, color: "text-red-500" },
  { key: "BLOOD_PRESSURE", label: "Blood Pressure", icon: Droplets, color: "text-blue-500" },
  { key: "TEMPERATURE", label: "Temperature", icon: Thermometer, color: "text-orange-500" },
  { key: "OXYGEN", label: "Oxygen", icon: Wind, color: "text-green-500" },
];

const sevBadge = (s: string) =>
  s === "CRITICAL" ? "bg-red-100 text-red-700"
  : s === "SEVERE" ? "bg-orange-100 text-orange-700"
  : s === "MODERATE" ? "bg-yellow-100 text-yellow-700"
  : "bg-blue-100 text-blue-700";

/** My Relative — live monitoring, vitals, medications, incidents for the linked resident. */
export default function FamilyRelative() {
  const { relative, loading: residentLoading } = useRelative();
  const [fallAlert, setFallAlert] = useState(false);
  const [fallSummary, setFallSummary] = useState("");

  const { data: vitalsRows } = useLiveQuery("vitals", {
    query: "include=resident&take=50",
    tables: ["VitalsLog"],
  });

  if (residentLoading && !relative) {
    return <div className="space-y-6"><h2 className="text-2xl font-bold text-gray-900">My Relative</h2><TabLoading label="Loading relative..." /></div>;
  }
  if (!relative) {
    return <div className="space-y-6"><h2 className="text-2xl font-bold text-gray-900">My Relative</h2><EmptyState message="No resident record is linked yet." /></div>;
  }

  const rawMeds = (relative.raw?.medications ?? []) as Row[];
  const rawIncidents = (relative.raw?.incidents ?? []) as Row[];
  const conditions = relative.medicalHistory ? relative.medicalHistory.split(",").map((c) => c.trim()).filter(Boolean) : [];

  const relVitals = relVitalsOf(vitalsRows, relative);
  const relHrTrend = relVitals
    .filter((v) => v.type === "HEART_RATE")
    .slice(0, 12).reverse()
    .map((v) => ({ name: v.recordedAt ? new Date(String(v.recordedAt)).toLocaleDateString([], { month: "short", day: "numeric" }) : "", value: parseFloat(String(v.value)) || 0 }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Heart className="w-6 h-6 text-red-500 flex-shrink-0" /> {relative.name}
        </h1>
        <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
          <LiveBadge />
          Room {relative.room} • {humanize(relative.careLevel)} Care{relative.age != null ? ` • Age ${relative.age}` : ""}
          {relative.alertsCount > 0 && (
            <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-xs font-semibold ml-1">{relative.alertsCount} alert{relative.alertsCount === 1 ? "" : "s"}</span>
          )}
        </p>
      </div>

      {/* Live Monitoring */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><Activity className="w-4 h-4 text-blue-500" /> Live Monitoring</h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <div className="lg:col-span-2">
            <div className="relative w-full aspect-[4/3] md:aspect-video bg-black rounded-2xl overflow-hidden shadow-lg border-2 border-blue-200">
              <CameraVisionFeed
                cameraMode="hybrid"
                isFallen={fallAlert}
                onFallTriggered={(a: { summary?: string }) => { setFallAlert(true); setFallSummary(a.summary || "Fall detected on camera."); }}
                onFallCleared={() => setFallAlert(false)}
              />
            </div>
          </div>
          <div className="space-y-3">
            <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">Monitoring Status</h4>
              {fallAlert ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3.5">
                  <p className="text-sm font-bold text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Fall Detected</p>
                  <p className="text-xs text-red-600 mt-1">{fallSummary}</p>
                  <p className="text-xs text-gray-500 mt-2">Care staff have been alerted. {relative.name} is in Room {relative.room}.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-xs font-semibold text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Fall detection is monitoring normally.
                </div>
              )}
            </div>
            <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm text-xs text-gray-500">
              <p className="flex items-center gap-2"><Activity className="w-3.5 h-3.5 text-blue-400" /> AI analyzes posture, motion &amp; emotion in real time.</p>
              <p className="mt-1.5">Live emotion &amp; behavior labels appear on the video feed.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Vitals */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 text-sm sm:text-base"><HeartPulse className="w-4 h-4 text-red-500" /> Latest Vital Signs</h3>
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
          {VITALS.map(({ key, label, icon: Icon, color }) => {
            const v = latestVitalOf(relVitals, key);
            return (
              <div key={key} className="bg-white p-3 sm:p-4 rounded-lg border border-gray-200">
                <p className="text-xs text-gray-600 font-semibold flex items-center gap-1"><Icon className={`w-3.5 h-3.5 ${color}`} /> {label}</p>
                <p className="text-xl sm:text-2xl font-bold text-gray-900 mt-1">{v ? String(v.value) : "—"}<span className="text-xs sm:text-sm font-medium text-gray-500 ml-1">{v?.unit ? String(v.unit) : ""}</span></p>
                <p className="text-xs text-gray-400 mt-0.5">{v?.recordedAt ? new Date(String(v.recordedAt)).toLocaleString() : "No reading"}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* HR trend */}
      <div className="bg-white rounded-lg p-3 sm:p-4 border border-gray-200">
        <ChartContainer title="Heart Rate Trend" type="area" data={relHrTrend.length ? relHrTrend : EMPTY_VITALS_TREND} dataKey="value" xAxisKey="name" colors={["#ef4444"]} height={200} />
      </div>

      {/* Medications + Conditions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        <div className="bg-white rounded-lg p-3 sm:p-4 md:p-6 border border-gray-200">
          <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 text-sm"><Pill className="w-4 h-4 text-blue-500" /> Medications ({rawMeds.length})</h4>
          <div className="space-y-2">
            {rawMeds.length ? rawMeds.map((m, i) => (
              <div key={i} className="flex items-center justify-between gap-2 p-2 bg-blue-50 rounded border border-blue-100">
                <span className="text-gray-900 text-sm truncate">{String(m.name ?? "")} <span className="text-gray-500">{String(m.dosage ?? "")}</span></span>
                <span className="text-xs text-gray-600 flex-shrink-0">{String(m.frequency ?? "")}</span>
              </div>
            )) : <p className="text-sm text-gray-500">No active medications recorded.</p>}
          </div>
        </div>
        <div className="bg-white rounded-lg p-3 sm:p-4 md:p-6 border border-gray-200">
          <h4 className="font-semibold text-gray-900 mb-3 text-sm">Conditions &amp; Allergies</h4>
          {relative.allergies && (
            <div className="mb-3 p-2 bg-red-50 border-l-4 border-red-400 rounded">
              <p className="text-xs font-semibold text-red-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Allergies</p>
              <p className="text-sm text-gray-900 mt-0.5">{relative.allergies}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {conditions.length ? conditions.map((c, i) => (
              <span key={i} className="px-2 py-1 bg-purple-50 text-purple-800 border border-purple-200 rounded text-xs font-medium">{c}</span>
            )) : <p className="text-sm text-gray-500">No chronic conditions recorded.</p>}
          </div>
        </div>
      </div>

      {/* Recent incidents */}
      {rawIncidents.length > 0 && (
        <div className="bg-white rounded-lg p-3 sm:p-4 md:p-6 border border-gray-200">
          <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 text-sm"><AlertTriangle className="w-4 h-4 text-orange-500" /> Recent Incidents</h4>
          <div className="space-y-2">
            {rawIncidents.slice(0, 5).map((i, idx) => (
              <div key={idx} className={`p-2.5 sm:p-3 rounded-lg border ${i.resolvedAt ? "bg-gray-50 border-gray-200" : "bg-red-50 border-red-100"}`}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-medium text-gray-900 text-sm">{humanize(String(i.incidentType ?? "")) || "Incident"}</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0 ${sevBadge(String(i.severity ?? ""))}`}>{humanize(String(i.severity ?? "")) || "—"}</span>
                </div>
                <p className="text-xs text-gray-600 line-clamp-2">{String(i.description ?? "")}</p>
                <p className="text-xs text-gray-400 mt-1">{i.incidentDate ? new Date(String(i.incidentDate)).toLocaleString() : "—"} • {i.resolvedAt ? "Resolved" : "Open"}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Care notes */}
      {relative.notes && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 rounded p-3 sm:p-4 md:p-6">
          <h4 className="font-semibold text-gray-900 mb-2 text-sm">Care Notes</h4>
          <p className="text-gray-700 text-sm">{relative.notes}</p>
        </div>
      )}
    </div>
  );
}
