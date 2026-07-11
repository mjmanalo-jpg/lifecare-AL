"use client";

import {
  Stethoscope, Pill, ClipboardList, BellRing, PenTool, Users, CheckCircle2,
  Clock, AlertTriangle, Activity, HeartPulse,
} from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { humanize } from "@/lib/adapters";
import {
  useRelative, useNowTs, relTime, relVitalsOf, ReportStat, LiveBadge, EmptyState,
  type Row,
} from "./shared";

const TASK_BADGE: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-700",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-green-100 text-green-700",
  CANCELLED: "bg-gray-100 text-gray-400",
};
const PRIORITY_BADGE: Record<string, string> = {
  URGENT: "bg-red-100 text-red-700",
  HIGH: "bg-orange-100 text-orange-700",
  MEDIUM: "bg-yellow-100 text-yellow-700",
  LOW: "bg-blue-100 text-blue-700",
};
const BELL_BADGE: Record<string, string> = {
  PENDING: "bg-red-100 text-red-700",
  RESPONDED: "bg-blue-100 text-blue-700",
  RESOLVED: "bg-green-100 text-green-700",
};

/**
 * Care Team — one live view of everything each role is doing for the relative:
 * physician orders & clinical notes, nurse vitals & medication rounds,
 * caregiver tasks & call bells, plus the on-duty staff roster.
 */
export default function FamilyCareTeam() {
  const { relative, displayName } = useRelative();
  const nowTs = useNowTs();

  // Physician: prescriptions/orders + clinical notes.
  const { data: medicationRows } = useLiveQuery("medications", {
    query: "include=resident&take=50",
    tables: ["Medication"],
  });
  const { data: noteRows } = useLiveQuery("medical-notes", {
    query: "include=resident&take=50",
    tables: ["MedicalNote"],
  });

  // Nurse: vitals recorded around the clock.
  const { data: vitalsRows } = useLiveQuery("vitals", {
    query: "include=resident&take=50",
    tables: ["VitalsLog"],
  });

  // Caregiver: assist tasks + call bells.
  const { data: taskRows } = useLiveQuery("tasks", {
    query: "include=assignedTo,resident&take=50",
    tables: ["Task", "Staff"],
  });
  const { data: bellRows } = useLiveQuery("call-bells", {
    query: "include=resident&take=30",
    tables: ["CallBell"],
  });

  // The facility care-team roster.
  const { data: staffRows } = useLiveQuery("staff", {
    query: "include=user&f_isActive=true&take=30",
    tables: ["Staff", "User"],
  });

  // Scope everything to the linked relative where a residentId is present.
  const forRelative = (rows: Row[]) =>
    relative ? rows.filter((r) => !r.residentId || r.residentId === relative.id) : rows;

  const meds = forRelative(medicationRows).filter((m) => String(m.status ?? "ACTIVE") === "ACTIVE");
  // Confidential clinical notes stay inside the clinical team.
  const notes = forRelative(noteRows).filter((n) => !n.isConfidential);
  const relVitals = relVitalsOf(vitalsRows, relative);
  const tasks = forRelative(taskRows);
  const bells = forRelative(bellRows);

  const openTasks = tasks.filter((t) => String(t.status) !== "COMPLETED" && String(t.status) !== "CANCELLED");
  const doneTasks = tasks.filter((t) => String(t.status) === "COMPLETED");
  const pendingBells = bells.filter((b) => String(b.status) === "PENDING");

  const latestVital = relVitals[0];
  const ts = (iso: unknown) => (iso ? new Date(String(iso)).getTime() : 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Stethoscope className="w-6 h-6 text-teal-500 flex-shrink-0" /> Care Team
        </h1>
        <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
          <LiveBadge />
          What the physician, nurses &amp; caregivers are doing for {displayName}
        </p>
      </div>

      {/* Cross-role stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <ReportStat label="Active Prescriptions" value={meds.length} icon={Pill} tone="blue" />
        <ReportStat label="Open Care Tasks" value={openTasks.length} icon={ClipboardList} tone={openTasks.length > 0 ? "purple" : "green"} />
        <ReportStat label="Pending Call Bells" value={pendingBells.length} icon={BellRing} tone={pendingBells.length > 0 ? "red" : "green"} />
        <ReportStat label="Clinical Notes" value={notes.length} icon={PenTool} tone="gray" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Physician: Orders & Prescriptions ── */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <Pill className="w-4 h-4 text-blue-500" /> Physician — Orders &amp; Prescriptions
          </h3>
          <p className="text-xs text-gray-500 mb-4">Mirrors the physician portal&apos;s Orders &amp; Prescriptions module.</p>
          {meds.length > 0 ? (
            <div className="space-y-2">
              {meds.slice(0, 6).map((m, i) => (
                <div key={String(m.id ?? i)} className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-gray-900 text-sm">💊 {String(m.name ?? "")} <span className="text-gray-500 font-normal">{String(m.dosage ?? "")}</span></p>
                    <span className="text-xs font-semibold text-blue-700 flex-shrink-0">{humanize(String(m.route ?? "oral"))}</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {String(m.frequency ?? "")}
                    {m.prescribedBy ? ` • Prescribed by ${String(m.prescribedBy)}` : ""}
                  </p>
                  {m.reason && <p className="text-xs text-gray-500 mt-1 italic">For: {String(m.reason)}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 py-4 text-center">No active prescriptions on file.</p>
          )}
        </div>

        {/* ── Physician: Clinical Notes ── */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <PenTool className="w-4 h-4 text-indigo-500" /> Physician — Clinical Notes
          </h3>
          <p className="text-xs text-gray-500 mb-4">Non-confidential notes shared with the family.</p>
          {notes.length > 0 ? (
            <div className="space-y-2">
              {notes.slice(0, 5).map((n, i) => (
                <div key={String(n.id ?? i)} className="p-3 rounded-lg bg-indigo-50/60 border border-indigo-100">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-gray-900 text-sm truncate">{String(n.title ?? humanize(String(n.noteType ?? ""))) || "Clinical note"}</p>
                    <span className="text-xs text-gray-400 flex-shrink-0">{relTime(ts(n.createdAt), nowTs)}</span>
                  </div>
                  <p className="text-xs text-gray-700 mt-1 line-clamp-2">{String(n.content ?? "")}</p>
                  {n.authorName && <p className="text-xs text-gray-500 mt-1">— {String(n.authorName)}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 py-4 text-center">No shared clinical notes yet.</p>
          )}
        </div>

        {/* ── Nurse: Vitals Rounds ── */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <HeartPulse className="w-4 h-4 text-rose-500" /> Nurse — Vitals Rounds
          </h3>
          <p className="text-xs text-gray-500 mb-4">Readings logged by nursing staff and the RPPG monitor.</p>
          {relVitals.length > 0 ? (
            <div className="space-y-2">
              {relVitals.slice(0, 6).map((v, i) => (
                <div key={String(v.id ?? i)} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-rose-50/60 border border-rose-100">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 text-sm">{humanize(String(v.type ?? ""))}</p>
                    <p className="text-xs text-gray-500">
                      {v.recordedBy ? `By ${String(v.recordedBy)} • ` : ""}
                      {v.recordedAt ? new Date(String(v.recordedAt)).toLocaleString() : ""}
                    </p>
                  </div>
                  <span className="font-bold text-gray-900 flex-shrink-0">{String(v.value)}{v.unit ? ` ${String(v.unit)}` : ""}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 py-4 text-center">No vitals recorded yet.</p>
          )}
          {latestVital ? (
            <p className="text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2 mt-3 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" /> Last check {relTime(ts(latestVital.recordedAt), nowTs) || "recently"} — monitoring is active.
            </p>
          ) : null}
        </div>

        {/* ── Caregiver: Tasks & Call Bells ── */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-purple-500" /> Caregiver — Daily Assistance
          </h3>
          <p className="text-xs text-gray-500 mb-4">
            {doneTasks.length} of {tasks.length || 0} care task{tasks.length === 1 ? "" : "s"} completed • mirrors the caregiver checklist.
          </p>
          {tasks.length > 0 ? (
            <div className="space-y-2">
              {tasks.slice(0, 5).map((t, i) => {
                const assignee = t.assignedTo as { user?: { name?: string } } | undefined;
                const status = String(t.status ?? "PENDING");
                return (
                  <div key={String(t.id ?? i)} className="p-2.5 rounded-lg bg-purple-50/60 border border-purple-100">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`font-medium text-sm truncate ${status === "COMPLETED" ? "text-gray-500 line-through" : "text-gray-900"}`}>{String(t.title ?? "Care task")}</p>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${PRIORITY_BADGE[String(t.priority ?? "MEDIUM")] ?? PRIORITY_BADGE.MEDIUM}`}>{humanize(String(t.priority ?? "MEDIUM"))}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${TASK_BADGE[status] ?? TASK_BADGE.PENDING}`}>{humanize(status)}</span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Due {t.dueDate ? new Date(String(t.dueDate)).toLocaleString() : "—"}
                      {assignee?.user?.name ? ` • ${assignee.user.name}` : ""}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500 py-4 text-center">No care tasks scheduled.</p>
          )}

          {/* Call bells */}
          {bells.length > 0 && (
            <div className="mt-4 pt-3 border-t border-gray-100">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1"><BellRing className="w-3.5 h-3.5 text-yellow-500" /> Recent Call Bells</p>
              <div className="space-y-1.5">
                {bells.slice(0, 3).map((b, i) => (
                  <div key={String(b.id ?? i)} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-gray-700 truncate">{String(b.reason ?? "Assistance request")}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${BELL_BADGE[String(b.status ?? "PENDING")] ?? BELL_BADGE.PENDING}`}>{humanize(String(b.status ?? "PENDING"))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Staff roster ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
          <Users className="w-4 h-4 text-teal-500" /> Facility Care Team
        </h3>
        <p className="text-xs text-gray-500 mb-4">Active staff members looking after residents.</p>
        {staffRows.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {staffRows.slice(0, 9).map((s: Row, i: number) => {
              const user = s.user as { name?: string; email?: string } | undefined;
              const name = user?.name ?? "Staff member";
              return (
                <div key={String(s.id ?? i)} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 bg-gray-50/50">
                  <div className="w-9 h-9 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center font-bold flex-shrink-0">
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 text-sm truncate">{name}</p>
                    <p className="text-xs text-gray-500 truncate">{String(s.position ?? "")}{s.department ? ` • ${String(s.department)}` : ""}</p>
                  </div>
                  <CheckCircle2 className="w-4 h-4 text-green-500 ml-auto flex-shrink-0" />
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState message="Staff roster is not available." />
        )}
      </div>

      {/* Escalation note */}
      {pendingBells.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" /> {pendingBells.length} call bell{pendingBells.length === 1 ? "" : "s"} awaiting response — caregivers have been notified.
        </div>
      )}
    </div>
  );
}
