"use client";

import {
  Stethoscope, Pill, PenTool, HeartPulse, AlertTriangle, Users, BellRing,
  Clock, CheckCircle2, ShieldAlert,
} from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { humanize } from "@/lib/adapters";
// Generic live-portal primitives (shared across role modules).
import {
  useNowTs, relTime, ReportStat, LiveBadge, type Row,
} from "@/components/portal/views/family/shared";

/**
 * Care Team — the caregiver's cross-role coordination board:
 * physician medication orders to administer, nurse vitals recency per
 * resident, shared clinical notes, resident safety flags (allergies),
 * open incidents / pending call bells, and staff currently on shift.
 */
export default function CaregiverCareTeam() {
  const nowTs = useNowTs();

  const { data: residentRows } = useLiveQuery("residents", {
    query: "take=100",
    tables: ["Resident"],
  });
  const { data: medicationRows } = useLiveQuery("medications", {
    query: "include=resident&f_status=ACTIVE&take=100",
    tables: ["Medication"],
  });
  const { data: noteRows } = useLiveQuery("medical-notes", {
    query: "include=resident&take=50",
    tables: ["MedicalNote"],
  });
  const { data: vitalsRows } = useLiveQuery("vitals", {
    query: "include=resident&take=100",
    tables: ["VitalsLog"],
  });
  const { data: incidentRows } = useLiveQuery("incidents", {
    query: "include=resident&f_resolvedAt=null&take=50",
    tables: ["Incident"],
  });
  const { data: bellRows } = useLiveQuery("call-bells", {
    query: "include=resident&take=50",
    tables: ["CallBell"],
  });
  const { data: shiftRows } = useLiveQuery("time-tracking", {
    query: "include=staff&take=50",
    tables: ["TimeTracking", "Staff"],
  });

  const ts = (iso: unknown) => (iso ? new Date(String(iso)).getTime() : 0);
  const residentName = (r: Row) => {
    const res = r.resident as { firstName?: string; lastName?: string; roomNumber?: string } | undefined;
    if (!res) return "";
    return `${res.firstName ?? ""} ${res.lastName ?? ""}`.trim() + (res.roomNumber ? ` (Rm ${res.roomNumber})` : "");
  };

  // Non-confidential notes only — confidential ones stay physician/nurse-side.
  const notes = noteRows.filter((n) => !n.isConfidential);
  const pendingBells = bellRows.filter((b) => String(b.status) === "PENDING");
  const onShift = shiftRows.filter((s) => !s.endTime);

  // Residents whose latest vitals reading is older than 4 hours (or missing)
  // — the nurse-alignment signal that a check-in round is due.
  const staleThreshold = 4 * 60 * 60 * 1000;
  const latestVitalByResident = new Map<string, number>();
  vitalsRows.forEach((v) => {
    const id = String(v.residentId ?? "");
    const t = ts(v.recordedAt);
    if (!id) return;
    if ((latestVitalByResident.get(id) ?? 0) < t) latestVitalByResident.set(id, t);
  });
  const dueForCheck = residentRows.filter((r) => {
    const last = latestVitalByResident.get(String(r.id)) ?? 0;
    return !nowTs || nowTs - last > staleThreshold;
  });

  // Allergy safety flags — critical for meal & medication assistance.
  const allergyResidents = residentRows.filter((r) => String(r.allergies ?? "").trim());

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Stethoscope className="w-6 h-6 text-teal-500 flex-shrink-0" /> Care Team
        </h1>
        <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
          <LiveBadge />
          Physician orders, nurse rounds &amp; shift coordination in one board
        </p>
      </div>

      {/* Cross-role stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <ReportStat label="Active Med Orders" value={medicationRows.length} icon={Pill} tone="blue" />
        <ReportStat label="Vitals Checks Due" value={dueForCheck.length} icon={HeartPulse} tone={dueForCheck.length > 0 ? "rose" : "green"} />
        <ReportStat label="Open Incidents" value={incidentRows.length} icon={AlertTriangle} tone={incidentRows.length > 0 ? "red" : "green"} />
        <ReportStat label="Pending Call Bells" value={pendingBells.length} icon={BellRing} tone={pendingBells.length > 0 ? "red" : "green"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Physician: medication orders to assist with ── */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <Pill className="w-4 h-4 text-blue-500" /> Physician Orders — Medication Assistance
          </h3>
          <p className="text-xs text-gray-500 mb-4">Active prescriptions from the physician portal. Confirm identity and route before assisting.</p>
          {medicationRows.length > 0 ? (
            <div className="space-y-2">
              {medicationRows.slice(0, 8).map((m: Row, i: number) => (
                <div key={String(m.id ?? i)} className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-gray-900 text-sm">💊 {String(m.name ?? "")} <span className="text-gray-500 font-normal">{String(m.dosage ?? "")}</span></p>
                    <span className="text-xs font-semibold text-blue-700 flex-shrink-0">{humanize(String(m.route ?? "oral"))}</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {residentName(m) || "Unassigned"} • {String(m.frequency ?? "")}
                    {m.prescribedBy ? ` • ${String(m.prescribedBy)}` : ""}
                  </p>
                  {m.contraindications ? (
                    <p className="text-xs text-red-700 mt-1 flex items-center gap-1"><ShieldAlert className="w-3 h-3 flex-shrink-0" /> {String(m.contraindications)}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 py-4 text-center">No active medication orders.</p>
          )}
        </div>

        {/* ── Nurse: vitals check-in rounds ── */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <HeartPulse className="w-4 h-4 text-rose-500" /> Nurse Alignment — Vitals Check-ins
          </h3>
          <p className="text-xs text-gray-500 mb-4">Residents with no vitals reading in the last 4 hours — flag to nursing or assist with a check-in.</p>
          {residentRows.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">No residents on file.</p>
          ) : dueForCheck.length > 0 ? (
            <div className="space-y-2">
              {dueForCheck.slice(0, 8).map((r: Row, i: number) => {
                const last = latestVitalByResident.get(String(r.id)) ?? 0;
                return (
                  <div key={String(r.id ?? i)} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-rose-50/60 border border-rose-100">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">{String(r.firstName ?? "")} {String(r.lastName ?? "")}</p>
                      <p className="text-xs text-gray-500">Room {String(r.roomNumber ?? "—")} • {humanize(String(r.careLevel ?? ""))}</p>
                    </div>
                    <span className="text-xs font-semibold text-rose-700 flex-shrink-0 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> {last ? `${relTime(last, nowTs)}` : "No reading"}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg p-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> Every resident has a recent vitals reading. Rounds are up to date.
            </p>
          )}
        </div>

        {/* ── Shared clinical notes ── */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <PenTool className="w-4 h-4 text-indigo-500" /> Clinical Notes — Care Instructions
          </h3>
          <p className="text-xs text-gray-500 mb-4">Non-confidential notes from physicians and nurses that affect daily care.</p>
          {notes.length > 0 ? (
            <div className="space-y-2">
              {notes.slice(0, 5).map((n: Row, i: number) => (
                <div key={String(n.id ?? i)} className="p-3 rounded-lg bg-indigo-50/60 border border-indigo-100">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-gray-900 text-sm truncate">{String(n.title ?? humanize(String(n.noteType ?? ""))) || "Care note"}</p>
                    <span className="text-xs text-gray-400 flex-shrink-0">{relTime(ts(n.createdAt), nowTs)}</span>
                  </div>
                  <p className="text-xs text-gray-700 mt-1 line-clamp-2">{String(n.content ?? "")}</p>
                  <p className="text-xs text-gray-500 mt-1">{residentName(n)}{n.authorName ? ` • ${String(n.authorName)}` : ""}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 py-4 text-center">No shared care notes.</p>
          )}
        </div>

        {/* ── Safety flags: allergies + open incidents ── */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-500" /> Safety Flags
          </h3>
          <p className="text-xs text-gray-500 mb-4">Allergies to respect during meals &amp; medication, plus unresolved incidents.</p>

          {allergyResidents.length > 0 && (
            <div className="space-y-1.5 mb-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Allergies</p>
              {allergyResidents.slice(0, 5).map((r: Row, i: number) => (
                <div key={String(r.id ?? i)} className="flex items-start justify-between gap-2 p-2.5 rounded-lg bg-red-50/60 border border-red-100 text-sm">
                  <span className="font-medium text-gray-900 flex-shrink-0">{String(r.firstName ?? "")} {String(r.lastName ?? "")} <span className="text-gray-500 font-normal">Rm {String(r.roomNumber ?? "—")}</span></span>
                  <span className="text-xs text-red-700 font-semibold text-right">{String(r.allergies ?? "")}</span>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Open Incidents</p>
          {incidentRows.length > 0 ? (
            <div className="space-y-1.5">
              {incidentRows.slice(0, 4).map((inc: Row, i: number) => (
                <div key={String(inc.id ?? i)} className="p-2.5 rounded-lg bg-orange-50/60 border border-orange-100">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-900 text-sm truncate">{humanize(String(inc.incidentType ?? "")) || "Incident"}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700 flex-shrink-0">{humanize(String(inc.severity ?? ""))}</span>
                  </div>
                  <p className="text-xs text-gray-600 truncate">{residentName(inc)} • {relTime(ts(inc.incidentDate), nowTs)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg p-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> No open incidents.
            </p>
          )}
        </div>
      </div>

      {/* ── Staff currently on shift ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
          <Users className="w-4 h-4 text-teal-500" /> On Shift Now
        </h3>
        <p className="text-xs text-gray-500 mb-4">Colleagues clocked in via Time Clock — your handoff and escalation contacts.</p>
        {onShift.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {onShift.slice(0, 9).map((s: Row, i: number) => {
              const staff = s.staff as { position?: string; department?: string } | undefined;
              return (
                <div key={String(s.id ?? i)} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 bg-gray-50/50">
                  <div className="w-9 h-9 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center font-bold flex-shrink-0">
                    {(staff?.position ?? "S").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 text-sm truncate">{staff?.position ?? "Staff"}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {humanize(String(s.shiftType ?? ""))} shift • in since {s.startTime ? new Date(String(s.startTime)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}
                    </p>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse ml-auto flex-shrink-0" />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-500 py-4 text-center">No colleagues clocked in right now.</p>
        )}
      </div>
    </div>
  );
}
