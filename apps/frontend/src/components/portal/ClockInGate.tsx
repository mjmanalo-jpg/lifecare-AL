"use client";

/**
 * Duty access gate.
 *
 * Clock-in is OPTIONAL now — the facial-match / geofence "Time In" tab stays
 * available for anyone who wants to log a shift, but it is no longer required to
 * open a care board. Instead, a CAREGIVER may only open a task / documentation
 * board (daily care, MAR, ADL, weight, wound care, rounds, …) on a day they have
 * a schedule: with no schedule dated today they see a "no schedule" notice (and
 * the server already scopes their reads to their scheduled residents). NURSES are
 * ungated. Applied once at the portal mount point (app/[role]/[tab]/page.tsx).
 */

import { useMemo, type ReactNode } from "react";
import { CalendarOff, Loader2 } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { useClinician, type ClinicianRole } from "@/components/portal/views/clinical/useClinician";
import { CAREGIVER_SCHEDULE_KEY, parseSchedules, activeResidentIdsFor } from "@/lib/caregiverSchedule";

type GatedRole = "NURSE" | "CAREGIVER";

// Tabs that count as "performing daily tasks" — a caregiver needs a schedule today.
const DUTY_REQUIRED = new Set<string>([
  "carelogs", "mar", "adlmonitoring", "weightmonitoring", "woundcare",
  "tasks", "taskboard", "taskassignment", "shiftendorsements", "endorsementdashboard",
  "todayscare", "careacuity", "rounds", "careplans", "prescreen", "documentation",
  "medications", "additionalservices", "shiftsummary",
]);

export default function ClockInGate({ role, tab, children }: { role: GatedRole; tab: string; children: ReactNode }) {
  // Nurses are ungated; only caregiver duty tabs are schedule-gated. Non-duty tabs
  // (dashboard, clockin, read/overview) skip the guard entirely.
  if (role !== "CAREGIVER" || !DUTY_REQUIRED.has(tab)) return <>{children}</>;
  return <Guard>{children}</Guard>;
}

function Guard({ children }: { children: ReactNode }) {
  const { userId, ready } = useClinician("CAREGIVER" as ClinicianRole);
  const { data: settingRows, loading } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  // Scheduled today = has at least one resident assigned on today's local date.
  const scheduledToday = useMemo(() => {
    const raw = settingRows.find((r) => String(r.key || r.id) === CAREGIVER_SCHEDULE_KEY)?.value;
    return activeResidentIdsFor(userId, parseSchedules(raw), new Date()).length > 0;
  }, [settingRows, userId]);

  // Hold the decision until BOTH the schedule AND the signed-in identity have
  // settled, so we never flash the block at a genuinely-scheduled caregiver.
  if (!ready || (loading && settingRows.length === 0)) {
    return <div className="flex min-h-[60vh] items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  // Fail-open if we can't resolve the signed-in identity (avoid lockout).
  if (!userId || scheduledToday) return <>{children}</>;

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600"><CalendarOff className="h-7 w-7" /></span>
        <h2 className="mt-4 text-xl font-bold text-slate-900">No schedule for today</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          You have no shift assigned today, so resident care boards are unavailable. If this is a mistake, ask your nurse or care manager to add you to today&apos;s schedule.
        </p>
      </div>
    </div>
  );
}
