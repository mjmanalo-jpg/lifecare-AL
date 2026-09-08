"use client";

// Resident Daily Performance — the client's paper "RESIDENTS DAILY PERFORMANCE
// ROUTINE" as a monthly grid: rows = the resident's APPROVED Care Task activities
// (Time + Activity), columns = days 1..N of the selected month. A cell auto-checks
// (green ✓) when the caregiver COMPLETED the matching-time occurrence that day;
// lifestyle rows with no clinical occurrence can be manually ticked (✓, toggleable).
// Migration-free (app-settings `care_task_routine` for rows, `resident_performance_ticks`
// for manual ticks). Asia/Manila throughout.

import { useMemo, useState } from "react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { activityRows, daysInMonth, checkedCells, cellKey } from "@/lib/lifecare/monthlyPerformance";
import { careDay } from "@/lib/lifecare/routineCompletions";
import { CARE_TASK_KEY, parseCareTask, mergeCareTaskRows, to12h, careDayRank, type CareTaskRow } from "@/lib/lifecare/careTask";
import { DataState } from "./clinical-ui";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type DefRow = Record<string, unknown>;
const asDefs = (rows: DefRow[]) => rows as unknown as Parameters<typeof activityRows>[0];
const asOccs = (rows: Row[]) => rows as unknown as Parameters<typeof checkedCells>[0];
const hhmm = (t: string) => (t || "").replace(":", "");
const nowManila = () => new Date(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));

export default function ResidentDailyPerformance({ residentId, approvedDefs, residentName }: {
  residentId: string;
  approvedDefs: DefRow[];
  residentName?: string;
}) {
  const { data: settingRows } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const occQ = useLiveQuery<Row>("routine-occurrences", { tables: ["RoutineOccurrence"], query: residentId ? `f_residentId=${residentId}&take=1000` : "take=1", enabled: !!residentId });

  const today = nowManila();
  const [year, setYear] = useState(today.getFullYear());
  const [month1, setMonth1] = useState(today.getMonth() + 1); // 1-indexed

  // Monthly rows REPLICATE the resident's Care Task exactly — the programmed
  // routine rows + any nurse-added lifestyle rows (an approved Care Task is frozen).
  // Same merged source as the Care Task tab, so approving the routine flows through.
  const careTask = useMemo(() => parseCareTask(settingRows.find((r) => (r.key || r.id) === CARE_TASK_KEY)?.value)[residentId], [settingRows, residentId]);
  const seed = useMemo<CareTaskRow[]>(() => activityRows(asDefs(approvedDefs), careDay()).map((a) => ({ id: a.key, time: a.time, activity: a.activity, assistance: a.assistance, assistedBy: a.assistedBy })), [approvedDefs]);
  const usingCareTask = !!careTask?.approved && !!careTask.rows.length;
  const rows = useMemo(() => mergeCareTaskRows(careTask, seed).map((r) => ({ time: r.time, activity: r.activity })).sort((a, b) => careDayRank(a.time) - careDayRank(b.time)), [careTask, seed]);

  const days = daysInMonth(year, month1);
  const dayList = useMemo(() => Array.from({ length: days }, (_, i) => i + 1), [days]);
  // A cell auto-checks ONLY when a caregiver marks the matching-time occurrence
  // complete that day. No one (incl. the nurse) can tick manually — read-only.
  const auto = useMemo(() => checkedCells(asOccs(occQ.data || []), year, month1), [occQ.data, year, month1]);

  const monthName = new Date(year, month1 - 1, 1).toLocaleString("en-US", { month: "long" });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] text-[var(--clinical-muted)]">
          {residentName && <span className="mr-2 font-semibold text-[var(--clinical-ink)]">{residentName}</span>}
          {monthName} {year} · {rows.length} activit{rows.length === 1 ? "y" : "ies"}
        </div>
        <div className="flex items-center gap-2">
          {/* native month picker — value is YYYY-MM (Manila) */}
          <input type="month" value={`${year}-${String(month1).padStart(2, "0")}`}
            onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); if (y && m) { setYear(y); setMonth1(m); } }}
            className="rounded-md border bg-[var(--clinical-surface)] px-2 py-1.5 text-sm text-[var(--clinical-ink)] outline-none focus:border-[var(--clinical-panel)]"
            style={{ borderColor: "var(--clinical-line)" }} aria-label="Month" />
        </div>
      </div>

      {!usingCareTask && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[11px] text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface-2)" }}>
          Approve the resident&apos;s <b>Care Task</b> to lock the monthly rows. Showing the current approved 24-hour routine meanwhile.
        </div>
      )}

      <DataState loading={occQ.loading && !occQ.data.length} empty={rows.length === 0}
        emptyTitle="No activities" emptyHint="Approve a Care Task (or the 24-hour routine) to populate the monthly grid.">
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--clinical-line)" }}>
          <table className="border-collapse text-sm">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-[0.04em] text-[var(--clinical-muted)]" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
                <th className="sticky left-0 z-10 px-3 py-2 text-left font-bold" style={{ backgroundColor: "var(--clinical-surface-2)", minWidth: 200 }}>Time · Activity</th>
                {dayList.map((d) => <th key={d} className="px-1 py-2 text-center font-bold" style={{ minWidth: 26 }}>{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${hhmm(r.time)}#${i}`} className="border-t" style={{ borderColor: "var(--clinical-line)" }}>
                  <td className="sticky left-0 z-10 px-3 py-1.5 align-top" style={{ backgroundColor: "var(--clinical-surface)", minWidth: 200 }}>
                    <span className="text-[11px] font-semibold text-[var(--clinical-muted)] whitespace-nowrap">{to12h(r.time) || "—"}</span>{" "}
                    <span className="text-[var(--clinical-ink)]">{r.activity}</span>
                  </td>
                  {dayList.map((d) => {
                    const isAuto = auto.has(cellKey(r.time, d));
                    return (
                      <td key={d} className="border-l px-0 py-0 text-center align-middle" style={{ borderColor: "var(--clinical-line)", minWidth: 26 }}>
                        <span className="inline-block h-6 w-full text-[14px] font-bold leading-6 text-[var(--clinical-green)]"
                          title={isAuto ? "Completed by caregiver" : ""}
                          aria-label={`Day ${d} ${r.activity} ${isAuto ? "completed" : "not completed"}`}>
                          {isAuto ? "✓" : ""}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataState>

      <p className="mt-2 text-[11px] text-[var(--clinical-muted)]">
        <span className="font-bold text-[var(--clinical-green)]">✓</span> completed by caregiver — auto-checks only when the caregiver marks the task complete. This grid is read-only.
      </p>
    </div>
  );
}
