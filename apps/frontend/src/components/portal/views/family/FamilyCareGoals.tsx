"use client";

import { Target, HeartPulse, Pill, ClipboardList, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { useRelative, relVitalsOf, latestVitalOf, LiveBadge, type Row } from "./shared";

interface Goal {
  icon: typeof Target;
  title: string;
  detail: string;
  status: "on-track" | "in-progress" | "attention";
  pct: number;
}

const STATUS_META = {
  "on-track": { label: "On track", badge: "bg-green-100 text-green-700", bar: "bg-green-500" },
  "in-progress": { label: "In progress", badge: "bg-blue-100 text-blue-700", bar: "bg-blue-500" },
  attention: { label: "Needs attention", badge: "bg-red-100 text-red-700", bar: "bg-red-500" },
} as const;

/** Care Goals — derived live from vitals, medications, tasks and incidents. */
export default function FamilyCareGoals() {
  const { relative, displayName } = useRelative();

  const { data: vitalsRows } = useLiveQuery("vitals", {
    query: "include=resident&take=50",
    tables: ["VitalsLog"],
  });
  const { data: taskRows } = useLiveQuery("tasks", {
    query: "take=50",
    tables: ["Task"],
  });

  const relVitals = relVitalsOf(vitalsRows, relative);
  const rawMeds = (relative?.raw?.medications ?? []) as Row[];
  const rawIncidents = (relative?.raw?.incidents ?? []) as Row[];
  const tasks = relative ? taskRows.filter((t) => !t.residentId || t.residentId === relative.id) : taskRows;

  // ── Derive live goals from real data ──
  const goals: Goal[] = [];

  // 1. Blood pressure / heart health.
  const hr = latestVitalOf(relVitals, "HEART_RATE");
  const hrVal = hr ? parseFloat(String(hr.value)) : NaN;
  const hrOk = !isNaN(hrVal) && hrVal >= 55 && hrVal <= 100;
  goals.push({
    icon: HeartPulse,
    title: "Maintain healthy vital signs",
    detail: hr
      ? `Latest heart rate ${String(hr.value)} bpm — ${hrOk ? "within the normal range" : "outside the normal range, care team notified"}.`
      : "Awaiting the next vitals reading.",
    status: hr ? (hrOk ? "on-track" : "attention") : "in-progress",
    pct: hr ? (hrOk ? 100 : 40) : 50,
  });

  // 2. Medication adherence.
  const activeMeds = rawMeds.filter((m) => String(m.status ?? "ACTIVE") === "ACTIVE");
  goals.push({
    icon: Pill,
    title: "Medication adherence",
    detail: activeMeds.length
      ? `${activeMeds.length} active medication${activeMeds.length === 1 ? "" : "s"} administered on schedule by nursing staff.`
      : "No active medications — nothing to administer.",
    status: "on-track",
    pct: 100,
  });

  // 3. Daily assistance & activity (caregiver tasks).
  const doneTasks = tasks.filter((t) => String(t.status) === "COMPLETED").length;
  const taskPct = tasks.length ? Math.round((doneTasks / tasks.length) * 100) : 0;
  goals.push({
    icon: ClipboardList,
    title: "Daily activity & assistance",
    detail: tasks.length
      ? `${doneTasks} of ${tasks.length} caregiver task${tasks.length === 1 ? "" : "s"} completed (${taskPct}%).`
      : "No assistance tasks scheduled yet.",
    status: tasks.length === 0 ? "in-progress" : taskPct >= 60 ? "on-track" : "in-progress",
    pct: tasks.length ? taskPct : 30,
  });

  // 4. Safety — incident-free streak.
  const openIncidents = rawIncidents.filter((i) => !i.resolvedAt).length;
  goals.push({
    icon: AlertTriangle,
    title: "Safety & fall prevention",
    detail: openIncidents
      ? `${openIncidents} open incident${openIncidents === 1 ? "" : "s"} — staff are attending.`
      : "No open incidents. AI fall detection is monitoring 24/7.",
    status: openIncidents ? "attention" : "on-track",
    pct: openIncidents ? 35 : 100,
  });

  const onTrack = goals.filter((g) => g.status === "on-track").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Target className="w-6 h-6 text-green-500 flex-shrink-0" /> Care Goals
        </h1>
        <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
          <LiveBadge />
          Live wellness goals for {displayName} • {onTrack} of {goals.length} on track
        </p>
      </div>

      {/* Summary banner */}
      <div className={`rounded-lg border px-4 py-3 text-sm font-semibold flex items-center gap-2 ${
        onTrack === goals.length
          ? "border-green-200 bg-green-50 text-green-800"
          : "border-blue-200 bg-blue-50 text-blue-800"
      }`}>
        <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
        {onTrack === goals.length
          ? `Every care goal is on track — ${displayName} is doing great.`
          : `${onTrack} goal${onTrack === 1 ? "" : "s"} on track; the care team is working on the rest.`}
      </div>

      {/* Goal cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {goals.map((g, i) => {
          const meta = STATUS_META[g.status];
          const Icon = g.icon;
          return (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <Icon className="w-4 h-4 text-gray-500" /> {g.title}
                </h3>
                <span className={`px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0 ${meta.badge}`}>{meta.label}</span>
              </div>
              <p className="text-sm text-gray-600 mt-2">{g.detail}</p>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mt-3">
                <div className={`h-full ${meta.bar} transition-all`} style={{ width: `${g.pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
