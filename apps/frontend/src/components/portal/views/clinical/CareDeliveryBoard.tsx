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
import { Activity, AlertTriangle, ShieldAlert, RefreshCw, ChevronRight, UserRound } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { type ClinicianRole } from "./useClinician";
import { ClinicalPage, ClinicalHeader, ClinicalCard, StatCard, DataState, SERIF } from "./clinical-ui";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const fmtDate = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };

const PERIODS = [{ key: "1", label: "Today", days: 1 }, { key: "7", label: "7 days", days: 7 }, { key: "30", label: "30 days", days: 30 }] as const;
const SHIFT_KEYS = ["AM", "PM", "NOC"] as const;
type ShiftKey = (typeof SHIFT_KEYS)[number];

/** One row of the roll-up — the server fills both the plan-side and the actor-side counts. */
interface Bucket {
  id: string; name: string;
  scheduled: number; due: number; completed: number; missed: number;
  exceptions: number; escalations: number; reassess: boolean;
  onTime: number; timed: number; charted: number; last: string;
  shifts: Record<ShiftKey, number>;
}

interface Rollup {
  scheduled: number; due: number; completed: number; missed: number;
  exceptions: number; escalations: number; reassessResidents: number; charted: number;
  outcomes: { outcome: string; n: number }[];
  byResident: Bucket[];
  byCaregiver: Bucket[];
}

const EMPTY: Rollup = {
  scheduled: 0, due: 0, completed: 0, missed: 0, exceptions: 0, escalations: 0, reassessResidents: 0, charted: 0,
  outcomes: [], byResident: [], byCaregiver: [],
};

/** A clean completion stays green; a dipping one warns before it is a failure. */
const rateAccent = (rate: number) => (rate >= 95 ? "green" : rate >= 85 ? "amber" : "coral");

const outcomeColor = (o: string) =>
  o === "Completed as planned" || o === "Completed" || o === "Not required" ? "var(--clinical-green)"
    : o === "Not documented" || o === "Not completed" ? "var(--clinical-coral)"
      : o === "Still open" ? "var(--clinical-line)"
        : "var(--clinical-amber)";

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--clinical-muted)]">{label}</span>
      <div className="inline-flex rounded-lg p-0.5" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
        {options.map(([v, text]) => (
          <button key={v} onClick={() => onChange(v)} aria-pressed={value === v}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${value === v ? "bg-[var(--clinical-surface)] shadow-sm text-[var(--clinical-ink)]" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}>
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
  const pending = k.scheduled - k.due;
  const rows = groupBy === "resident" ? k.byResident : k.byCaregiver;

  return (
    <ClinicalPage>
      <ClinicalHeader title="Care Delivery" subtitle="Completion against the governed care plan — documented vs scheduled, misses, variances, escalations and reassessment flags." />

      <div className="mt-4 mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Segmented label="Period" value={periodKey} onChange={setPeriodKey} options={PERIODS.map((p) => [p.key, p.label] as const)} />
        <Segmented<ShiftKey | "ALL"> label="Shift" value={shiftFilter} onChange={setShiftFilter}
          options={[["ALL", "All"], ...SHIFT_KEYS.map((sk) => [sk, sk] as const)]} />
        <Segmented<"resident" | "caregiver"> label="Group by" value={groupBy} onChange={setGroupBy} options={[["resident", "Resident"], ["caregiver", "Caregiver"]]} />
        <button onClick={() => void refetch()} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-[var(--clinical-ink-soft)] transition hover:bg-[var(--clinical-surface-2)]" style={{ borderColor: "var(--clinical-line)" }}><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
      </div>

      <DataState loading={loading && data.length === 0} error={error} empty={false} onRetry={() => void refetch()} skeletonRows={4}>
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
          <StatCard value={k.scheduled} label={pending > 0 ? `Tasks scheduled · ${pending} pending` : "Tasks scheduled"} accent="ink" />
          <StatCard value={`${completionRate}%`} label={`Completion · ${k.completed}/${k.due} due`} accent={rateAccent(completionRate)} />
          <StatCard value={k.missed} label="Missed / not documented" accent={k.missed > 0 ? "coral" : "ink"} />
          <StatCard value={k.exceptions} label="Exceptions / variances" accent={k.exceptions > 0 ? "amber" : "ink"} />
          <StatCard value={k.escalations} label="Escalations raised" accent={k.escalations > 0 ? "coral" : "ink"} />
          <StatCard value={k.reassessResidents} label="Flagged for reassessment" accent={k.reassessResidents > 0 ? "coral" : "ink"} />
        </div>

        {k.scheduled === 0 && rows.length === 0 ? (
          <div className="rounded-2xl border p-10 text-center text-sm text-[var(--clinical-muted)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
            No care tasks scheduled{shiftFilter === "ALL" ? "" : ` on the ${shiftFilter} shift`} in this period. Generate a resident routine from the care plan and its occurrences appear here.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_2fr]">
            {/* Outcome breakdown — every scheduled task, so a miss is visible. */}
            <ClinicalCard className="p-5">
              <p className="mb-1 font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>Outcomes</p>
              <p className="mb-3 text-xs text-[var(--clinical-muted)]">Of {k.scheduled} scheduled task{k.scheduled === 1 ? "" : "s"}</p>
              <div className="space-y-2.5">
                {k.outcomes.map(({ outcome, n }) => (
                  <div key={outcome}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium text-[var(--clinical-ink-soft)]">{outcome}</span>
                      <span className="tabular-nums text-[var(--clinical-muted)]">{n} · {pct(n, k.scheduled)}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: "var(--clinical-line)" }}>
                      <div className="h-full rounded-full" style={{ width: `${pct(n, k.scheduled)}%`, backgroundColor: outcomeColor(outcome) }} />
                    </div>
                  </div>
                ))}
              </div>
            </ClinicalCard>

            {/* Roll-up */}
            <ClinicalCard className="p-0 overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3.5 border-b" style={{ borderColor: "var(--clinical-line)" }}>
                {groupBy === "resident" ? <Activity className="h-4 w-4 text-[var(--clinical-panel)]" /> : <UserRound className="h-4 w-4 text-[var(--clinical-panel)]" />}
                <p className="font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>By {groupBy}</p>
                <span className="ml-auto text-xs text-[var(--clinical-muted)]">
                  {shiftFilter === "ALL" ? "All shifts" : `${shiftFilter} shift`} · {groupBy === "resident" ? `${k.scheduled} scheduled` : `${k.charted} charted`}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead><tr className="border-b text-left text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line)" }}>
                    <th className="px-5 py-2.5 font-semibold">{groupBy === "resident" ? "Resident" : "Caregiver"}</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Done</th>
                    <th className="px-3 py-2.5 font-semibold text-right">{groupBy === "resident" ? "Missed" : "On time"}</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Exceptions</th>
                    <th className="px-3 py-2.5 font-semibold">Flags</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Last</th>
                    <th className="px-3 py-2.5" />
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => {
                      // Resident: completion against that resident's own plan. Caregiver: the
                      // share of charted work they closed — a caregiver has no assigned plan
                      // (RoutineOccurrence.assignedStaffId is never written), so "of their own
                      // scheduled tasks" is not a figure that exists.
                      const done = groupBy === "resident" ? r.completed : r.charted;
                      const of = groupBy === "resident" ? r.due : k.charted;
                      return (
                        <tr key={r.id} className="border-b last:border-0 transition hover:bg-[var(--clinical-surface-2)]" style={{ borderColor: "var(--clinical-line)" }}>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ backgroundColor: "var(--clinical-surface-2)", color: "var(--clinical-ink-soft)" }}>{initials(r.name)}</span>
                              <div>
                                <span className="font-semibold text-[var(--clinical-ink)]">{r.name}</span>
                                {shiftFilter === "ALL" && (
                                  <p className="mt-0.5 text-[11px] tabular-nums text-[var(--clinical-muted)]">
                                    {SHIFT_KEYS.filter((sk) => r.shifts[sk] > 0).map((sk) => `${sk} ${r.shifts[sk]}`).join(" · ") || "—"}
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            <span className="font-semibold" style={{ color: groupBy === "resident" ? `var(--clinical-${rateAccent(pct(done, of))})` : "var(--clinical-ink)" }}>{done}</span>
                            <span className="text-[var(--clinical-muted)]">/{of}</span>
                            <span className="ml-1.5 text-[11px] text-[var(--clinical-muted)]">{pct(done, of)}%</span>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {groupBy === "resident" ? (
                              <span style={{ color: r.missed > 0 ? "var(--clinical-coral)" : "var(--clinical-muted)" }}>{r.missed}</span>
                            ) : r.timed === 0 ? (
                              // Only scheduled occurrences carry a due time; Task-based
                              // charting has none, so punctuality is not measurable.
                              <span className="text-[var(--clinical-muted)]" title="No scheduled-time tasks charted in this period">—</span>
                            ) : (
                              <span style={{ color: r.onTime < r.timed ? "var(--clinical-amber)" : "var(--clinical-muted)" }}>{pct(r.onTime, r.timed)}%</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums" style={{ color: r.exceptions > 0 ? "var(--clinical-amber)" : "var(--clinical-muted)" }}>
                            {r.exceptions}{done ? ` · ${pct(r.exceptions, done)}%` : ""}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-1">
                              {r.escalations > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-[var(--clinical-coral)] px-2 py-0.5 text-[10px] font-bold text-white"><ShieldAlert className="h-3 w-3" /> {r.escalations}</span>}
                              {r.reassess && <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: "var(--clinical-panel)" }}><RefreshCw className="h-3 w-3" /> Reassess</span>}
                              {r.escalations === 0 && !r.reassess && <span className="text-[var(--clinical-muted)]">—</span>}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right text-xs tabular-nums text-[var(--clinical-muted)]">{r.last ? fmtDate(r.last) : "—"}</td>
                          <td className="px-3 py-3 text-right">
                            {groupBy === "resident" && (
                              <button onClick={() => router.push(`/${roleSeg}/residentjourney`)} title="Open resident journey" className="text-[var(--clinical-panel)] hover:underline"><ChevronRight className="h-4 w-4" /></button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </ClinicalCard>
          </div>
        )}

        {(k.missed > 0 || k.escalations > 0 || k.reassessResidents > 0) && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "var(--clinical-amber)", backgroundColor: "color-mix(in srgb, var(--clinical-amber) 8%, transparent)" }}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--clinical-amber)]" />
            <span className="text-[var(--clinical-ink-soft)]">
              {k.missed > 0 ? `${k.missed} scheduled task${k.missed === 1 ? "" : "s"} passed its window without documentation. ` : ""}
              {k.escalations > 0 ? `${k.escalations} escalation${k.escalations === 1 ? "" : "s"} raised from care during this period. ` : ""}
              {k.reassessResidents > 0 ? `${k.reassessResidents} resident${k.reassessResidents === 1 ? "" : "s"} flagged for reassessment — review their care plan (no automatic level/fee change).` : ""}
            </span>
          </div>
        )}
      </DataState>
    </ClinicalPage>
  );
}
