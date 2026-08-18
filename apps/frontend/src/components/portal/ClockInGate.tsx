"use client";

/**
 * Clock-in gate — nurses & caregivers must be verified-clocked-in (facial match
 * + geofence, recorded in `staff_clock_events`) before they can open a task /
 * documentation board (daily care, MAR, ADL, weight, wound care, rounds, …).
 * Read-only, overview, and the Time-In tab itself stay open. Applied once at the
 * portal mount point (app/[role]/[tab]/page.tsx).
 */

import { useMemo, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Fingerprint, ShieldAlert, Loader2 } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { useClinician, type ClinicianRole } from "@/components/portal/views/clinical/useClinician";
import { STAFF_CLOCK_KEY, parseClockEvents, isOnDuty } from "@/lib/staffClock";

type GatedRole = "NURSE" | "CAREGIVER";

// Tabs that count as "performing daily tasks" — blocked until clocked in.
const DUTY_REQUIRED = new Set<string>([
  "carelogs", "dailyrounds", "mar", "adlmonitoring", "weightmonitoring", "woundcare",
  "tasks", "taskboard", "taskassignment", "shiftendorsements", "endorsementdashboard",
  "todayscare", "careacuity", "rounds", "careplans", "prescreen", "documentation",
  "medications", "additionalservices", "shiftsummary",
]);

export default function ClockInGate({ role, tab, children }: { role: GatedRole; tab: string; children: ReactNode }) {
  // Non-gated tabs (dashboard, clockin, read/overview) skip the guard entirely —
  // no extra query, and hooks stay unconditional inside <Guard/>.
  if (!DUTY_REQUIRED.has(tab)) return <>{children}</>;
  return <Guard role={role}>{children}</Guard>;
}

function Guard({ role, children }: { role: GatedRole; children: ReactNode }) {
  const { userId } = useClinician(role as ClinicianRole);
  const { data: settingRows, loading } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const router = useRouter();
  const pathname = usePathname();

  const onDuty = useMemo(() => {
    const raw = settingRows.find((r) => String(r.key || r.id) === STAFF_CLOCK_KEY)?.value;
    return isOnDuty(parseClockEvents(raw), userId);
  }, [settingRows, userId]);

  // Still resolving settings → show a light loader rather than flashing the block.
  if (loading && settingRows.length === 0) {
    return <div className="flex min-h-[60vh] items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  // Fail-open if we genuinely can't resolve the signed-in identity (avoid lockout).
  if (!userId || onDuty) return <>{children}</>;

  const seg = (pathname || "").split("/").filter(Boolean)[0] || role.toLowerCase();
  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600"><ShieldAlert className="h-7 w-7" /></span>
        <h2 className="mt-4 text-xl font-bold text-slate-900">Clock in to start your shift</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          You need to be verified on duty before documenting care. Clocking in confirms it&apos;s you (face match) and that you&apos;re on-site (location) — then daily care, MAR, ADL, weight, wound care and the rest unlock.
        </p>
        <button onClick={() => router.push(`/${seg}/clockin`)} className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--clinical-panel,#2E4A48)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110">
          <Fingerprint className="h-4 w-4" /> Go to Time In
        </button>
      </div>
    </div>
  );
}
