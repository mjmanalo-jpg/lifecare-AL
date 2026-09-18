"use client";

/**
 * Care Delivery — completion KPIs for the governed care plan. Facility roll-up with a
 * By-resident / By-caregiver switch and a shift filter: completion against the plan,
 * missed tasks, exceptions/variances, escalations and reassessment flags.
 *
 * Completion is `completed / SCHEDULED` — the denominator is the materialised plan
 * (RoutineOccurrence), not the events that happened to be charted. A task nobody
 * charted writes no CareEvent at all, so counting events alone can only ever report
 * 100%; it cannot see a miss. All of it is aggregated server-side by
 * /api/care-events/rollup (the generic /api/db reader caps `take` at 500, which would
 * silently truncate a real facility's period).
 *
 * Live: realtime on CareEvent + RoutineOccurrence with a 15s polling fallback, so the
 * figures move as caregivers chart. Read-only; Nurse + Care Manager.
 */

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Activity, RefreshCw, UserRound } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { type ClinicianRole } from "./useClinician";
import { ClinicalPage, ClinicalHeader, ClinicalCard, DataState, SERIF } from "./clinical-ui";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const fmtTime = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); };

/** Charted non-completion outcome → the label + tone shown in the Exceptions list. */
function exceptionMeta(outcome: string): { label: string; tone: "amber" | "coral" } {
  const o = (outcome || "").toLowerCase();
  if (o.includes("refus") || o.includes("declin")) return { label: "Resident declined", tone: "amber" };
  if (o.includes("unsafe") || o.includes("unable")) return { label: "Unsafe to perform", tone: "coral" };
  if (o.includes("clinical")) return { label: "Clinical change", tone: "coral" };
  if (o.includes("frequency") || o.includes("variance")) return { label: "Frequency variance", tone: "amber" };
  if (o.includes("increased")) return { label: "Increased assist", tone: "amber" };
  return { label: outcome || "Exception", tone: "amber" };
}

/** KPI tile — big figure over a plain-language explanation of what it counts. */
function KpiCard({ label, value, accent, hint }: { label: string; value: string | number; accent: "ink" | "green" | "amber" | "coral"; hint: string }) {
  const color = accent === "green" ? "var(--clinical-green)" : accent === "amber" ? "var(--clinical-amber)" : accent === "coral" ? "var(--clinical-coral)" : "var(--clinical-ink)";
  return (
    <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--clinical-muted)]">{label}</p>
      <p className="mt-1.5 text-3xl font-bold leading-none tabular-nums" style={{ color, fontFamily: SERIF }}>{value}</p>
      <p className="mt-2 text-[11px] leading-snug text-[var(--clinical-muted)]">{hint}</p>
    </div>
  );
}

const PERIODS = [{ key: "1", label: "Today", days: 1 }, { key: "7", label: "7 days", days: 7 }, { key: "30", label: "30 days", days: 30 }] as const;
const SHIFT_KEYS = ["AM", "PM", "NOC"] as const;
type ShiftKey = (typeof SHIFT_KEYS)[number];

/** One row of the roll-up — the server fills both the plan-side and the actor-side counts. */
interface Bucket {
  id: string; name: string;
  /** Resident buckets carry their room for the reliability table sub-label. */
  room?: string;
  /** Resident rows: nobody rostered today, which is why the row may read 0%. */
  uncoveredToday?: boolean;
  scheduled: number; due: number; dueNow: number; completed: number; missed: number;
  exceptions: number; escalations: number; reassess: boolean;
  onTime: number; timed: number; charted: number; last: string;
  shifts: Record<ShiftKey, number>;
}

/** One charted non-completion — powers the Exceptions list. */
interface CareException {
  id: string; name: string; residentName: string; room: string;
  shift: string | null; outcome: string; reason: string; caregiver: string; at: string;
}

interface Rollup {
  scheduled: number; due: number; completed: number; missed: number;
  exceptions: number; escalations: number; reassessResidents: number; charted: number;
  outcomes: { outcome: string; n: number }[];
  exceptionList: CareException[];
  byResident: Bucket[];
  byCaregiver: Bucket[];
}

const EMPTY: Rollup = {
  scheduled: 0, due: 0, completed: 0, missed: 0, exceptions: 0, escalations: 0, reassessResidents: 0, charted: 0,
  outcomes: [], exceptionList: [], byResident: [], byCaregiver: [],
};

/** A clean completion stays green; a dipping one warns before it is a failure. */
const rateAccent = (rate: number) => (rate >= 95 ? "green" : rate >= 85 ? "amber" : "coral");

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--clinical-muted)]">{label}</span>
      <div className="inline-flex rounded-lg p-0.5" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
        {options.map(([v, text]) => (
          <button key={v} onClick={() => onChange(v)} aria-pressed={value === v}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${value === v ? "bg-[var(--clinical-panel)] text-white shadow-sm" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function CareDeliveryBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const router = useRouter();
  const pathname = usePathname();
  const roleSeg = (pathname || "").split("/").filter(Boolean)[0] || clinicianRole.toLowerCase();
  const [periodKey, setPeriodKey] = useState<string>("7");
  const [groupBy, setGroupBy] = useState<"resident" | "caregiver">("resident");
  const [shiftFilter, setShiftFilter] = useState<ShiftKey | "ALL">("ALL");

  const period = PERIODS.find((p) => p.key === periodKey) ?? PERIODS[1];

  // Realtime on both tables: closing an occurrence writes RoutineOccurrence AND a
  // CareEvent, so either change re-pulls the roll-up within a beat.
  const { data, loading, error, refetch } = useLiveQuery<Rollup>("rollup", {
    basePath: "/api/care-events",
    tables: ["CareEvent", "RoutineOccurrence"],
    query: `days=${period.days}&shift=${shiftFilter}`,
    pollMs: 15000,
  });
  const k = data[0] ?? EMPTY;

  // Against DUE work, not everything on the calendar — a task later today is not a miss.
  const completionRate = pct(k.completed, k.due);
  const rows = groupBy === "resident" ? k.byResident : k.byCaregiver;
  const openNow = k.byResident.reduce((a, b) => a + (b.dueNow || 0), 0);
  const maxExc = Math.max(1, ...rows.map((r) => r.exceptions));

  return (
    <ClinicalPage>
      <ClinicalHeader title="Care Delivery Reliability" subtitle="Completion against the governed care plan — what was delivered, what was refused or unsafe, and where the plan needs a second look." />

      <div className="mt-4 mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Segmented label="Period" value={periodKey} onChange={setPeriodKey} options={PERIODS.map((p) => [p.key, p.label] as const)} />
        <Segmented<ShiftKey | "ALL"> label="Shift" value={shiftFilter} onChange={setShiftFilter}
          options={[["ALL", "All"], ...SHIFT_KEYS.map((sk) => [sk, sk] as const)]} />
        <Segmented<"resident" | "caregiver"> label="Group by" value={groupBy} onChange={setGroupBy} options={[["resident", "Resident"], ["caregiver", "Caregiver"]]} />
        <button onClick={() => void refetch()} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-[var(--clinical-ink-soft)] transition hover:bg-[var(--clinical-surface-2)]" style={{ borderColor: "var(--clinical-line)" }}><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
      </div>

      <DataState loading={loading && data.length === 0} error={error} empty={false} onRetry={() => void refetch()} skeletonRows={4}>
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Care delivered" value={`${completionRate}%`} accent={rateAccent(completionRate)} hint={`Completed against care due or past due (${k.completed}/${k.due}). Upcoming work is excluded.`} />
          <KpiCard label="Exceptions" value={k.exceptions} accent={k.exceptions > 0 ? "amber" : "ink"} hint="Closed without counting as completion — refused, unable, unsafe, clinical change or variance." />
          <KpiCard label="Open now" value={openNow} accent={openNow > 0 ? "amber" : "ink"} hint="Due and not yet actioned. Counted in the denominator, but the shift still has time to deliver." />
          <KpiCard label={groupBy === "resident" ? "Residents" : "Caregivers"} value={rows.length} accent="ink" hint={`Distinct ${groupBy}s with care events in the current filter.`} />
        </div>

        {k.scheduled === 0 && rows.length === 0 ? (
          <div className="rounded-2xl border p-10 text-center text-sm text-[var(--clinical-muted)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
            No care tasks scheduled{shiftFilter === "ALL" ? "" : ` on the ${shiftFilter} shift`} in this period. Generate a resident routine from the care plan and its occurrences appear here.
          </div>
        ) : (
          <>
            <ClinicalCard className="p-0 overflow-hidden">
              <div className="flex items-center gap-2 border-b px-5 py-3.5" style={{ borderColor: "var(--clinical-line)" }}>
                {groupBy === "resident" ? <Activity className="h-4 w-4 text-[var(--clinical-panel)]" /> : <UserRound className="h-4 w-4 text-[var(--clinical-panel)]" />}
                <div className="min-w-0">
                  <p className="font-bold leading-tight text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>Reliability by {groupBy}</p>
                  <p className="text-xs text-[var(--clinical-muted)]">Ordered by exceptions. Where care is repeatedly not delivered as planned, the plan is usually wrong.</p>
                </div>
                <span className="ml-auto shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-[var(--clinical-muted)]" style={{ backgroundColor: "var(--clinical-surface-2)" }}>{rows.length} row{rows.length === 1 ? "" : "s"}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead><tr className="border-b text-left text-[11px] uppercase tracking-[0.06em] text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line)" }}>
                    <th className="px-5 py-2.5 font-bold">{groupBy === "resident" ? "Resident" : "Caregiver"}</th>
                    <th className="px-3 py-2.5 font-bold text-right">Events</th>
                    <th className="px-3 py-2.5 font-bold text-right">Completed</th>
                    <th className="px-3 py-2.5 font-bold">Exceptions</th>
                    <th className="px-3 py-2.5 font-bold text-right">Reliability</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => {
                      const events = groupBy === "resident" ? r.due + r.dueNow : r.charted;
                      const denom = r.completed + r.exceptions;
                      const rel = denom > 0 ? Math.round((r.completed / denom) * 100) : null;
                      const relColor = rel === null ? "var(--clinical-muted)" : rel >= 95 ? "var(--clinical-green)" : rel >= 50 ? "var(--clinical-amber)" : "var(--clinical-coral)";
                      const sub = groupBy === "resident" ? (r.room ? `Room ${r.room}` : (r.uncoveredToday ? "No caregiver today" : "")) : SHIFT_KEYS.filter((sk) => r.shifts[sk] > 0).map((sk) => `${sk} ${r.shifts[sk]}`).join(" · ");
                      return (
                        <tr key={r.id} className={`border-b last:border-0 transition hover:bg-[var(--clinical-surface-2)] ${groupBy === "resident" ? "cursor-pointer" : ""}`} style={{ borderColor: "var(--clinical-line)" }} onClick={groupBy === "resident" ? () => router.push(`/${roleSeg}/residentjourney`) : undefined}>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ backgroundColor: "var(--clinical-surface-2)", color: "var(--clinical-ink-soft)" }}>{initials(r.name)}</span>
                              <div className="min-w-0">
                                <p className="font-semibold text-[var(--clinical-ink)]">{r.name}</p>
                                {sub && <p className="text-[11px] text-[var(--clinical-muted)]">{sub}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-[var(--clinical-ink-soft)]">{events}</td>
                          <td className="px-3 py-3 text-right tabular-nums text-[var(--clinical-ink-soft)]">{r.completed}</td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
                                <div className="h-full rounded-full" style={{ width: `${pct(r.exceptions, maxExc)}%`, backgroundColor: r.exceptions > 0 ? "var(--clinical-coral)" : "transparent" }} />
                              </div>
                              <span className="tabular-nums" style={{ color: r.exceptions > 0 ? "var(--clinical-coral)" : "var(--clinical-muted)" }}>{r.exceptions}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right"><span className="font-bold tabular-nums" style={{ color: relColor }}>{rel === null ? "—" : `${rel}%`}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </ClinicalCard>

            {k.exceptionList.length > 0 && (
              <ClinicalCard className="mt-5 p-0 overflow-hidden">
                <div className="border-b px-5 py-3.5" style={{ borderColor: "var(--clinical-line)" }}>
                  <p className="font-bold leading-tight text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>Exceptions</p>
                  <p className="text-xs text-[var(--clinical-muted)]">Every occurrence closed without counting as completion.</p>
                </div>
                <div>
                  {k.exceptionList.map((ex) => {
                    const meta = exceptionMeta(ex.outcome);
                    const tone = meta.tone === "coral" ? "var(--clinical-coral)" : "var(--clinical-amber)";
                    const when = [ex.shift, fmtTime(ex.at)].filter(Boolean).join(" ");
                    const line = [ex.residentName, ex.room ? `Room ${ex.room}` : "", when, ex.caregiver].filter(Boolean).join(" · ");
                    return (
                      <div key={ex.id} className="flex items-start justify-between gap-4 border-b px-5 py-3.5 last:border-0" style={{ borderColor: "var(--clinical-line)" }}>
                        <div className="min-w-0">
                          <p className="font-semibold text-[var(--clinical-ink)]">{ex.name}</p>
                          <p className="mt-0.5 text-xs text-[var(--clinical-muted)]">{line}</p>
                          {ex.reason && <p className="mt-1 text-xs text-[var(--clinical-ink-soft)]"><span className="font-semibold">{ex.outcome}:</span> {ex.reason}</p>}
                        </div>
                        <span className="shrink-0 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-[0.04em]" style={{ backgroundColor: `color-mix(in srgb, ${tone} 16%, transparent)`, color: tone }}>{meta.label}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t px-5 py-3 text-xs text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line)" }}>
                  An exception is not completion, and escalating is not delivering — the original stays in the audit record and the next recurrence generates separately.
                </div>
              </ClinicalCard>
            )}
          </>
        )}
      </DataState>
    </ClinicalPage>
  );
}
