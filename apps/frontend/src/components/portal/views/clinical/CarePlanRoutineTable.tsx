"use client";

// Care Plan Routine Table — the New-Review preview's editable 24-hour routine as a
// flat schedule table (Time · Activities · Level of Assistance · Assisted By),
// mirroring the facility's paper routine sheet. Seeded from the plan's generated
// 24-hour routine (RoutineEvent[]); the saved table then wins, with "Re-seed from
// routine" to re-sync. Migration-free (app-setting `resident_daily_performance`).
//
// (Formerly the ResidentDailyPerformance component; that name now belongs to the
// monthly performance grid. This flat table is the care-plan-review seed editor.)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, RotateCcw } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import type { RoutineEvent } from "@/lib/lifecare/carePlanRoutine";
import {
  DAILY_PERFORMANCE_KEY, ASSISTANCE_LEVELS, ASSISTED_BY,
  parseDailyPerformance, upsertDailyPerformance, seedFromRoutine,
  type PerformanceRow,
} from "@/lib/lifecare/dailyPerformance";
import { ClinicalButton } from "./clinical-ui";

const newId = () => globalThis.crypto?.randomUUID?.() ?? `pr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const cell = "w-full rounded-md border bg-[var(--clinical-surface)] px-2 py-1.5 text-sm text-[var(--clinical-ink)] outline-none focus:border-[var(--clinical-panel)]";

export default function CarePlanRoutineTable({ residentId, routine, scoreByCode }: {
  residentId: string;
  routine: RoutineEvent[];
  scoreByCode: Record<string, number>;
}) {
  const { data: settingRows, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const savedMap = useMemo(() => parseDailyPerformance(settingRows.find((r) => (r.key || r.id) === DAILY_PERFORMANCE_KEY)?.value), [settingRows]);
  const saved = savedMap[residentId];
  const seed = useMemo(() => seedFromRoutine(routine, scoreByCode), [routine, scoreByCode]);

  const [rows, setRows] = useState<PerformanceRow[]>(saved?.rows?.length ? saved.rows : seed);
  const [edited, setEdited] = useState(false);

  const [hydrated, setHydrated] = useState(false);
  if (!hydrated && !edited && saved?.rows) {
    setHydrated(true);
    setRows(saved.rows);
  }

  const settingRef = useRef(settingRows);
  useEffect(() => { settingRef.current = settingRows; }, [settingRows]);
  const persist = useCallback(async (next: PerformanceRow[]) => {
    const cur = parseDailyPerformance(settingRef.current.find((r) => (r.key || r.id) === DAILY_PERFORMANCE_KEY)?.value);
    const map = upsertDailyPerformance(cur, residentId, { rows: next, updatedAt: new Date().toISOString() });
    await upsertRecord("app-settings", DAILY_PERFORMANCE_KEY, { key: DAILY_PERFORMANCE_KEY, value: JSON.stringify(map) });
    await refetch();
  }, [residentId, refetch]);

  useEffect(() => {
    if (!edited) return;
    const t = setTimeout(() => void persist(rows), 700);
    return () => clearTimeout(t);
  }, [rows, persist, edited]);

  const setCell = (id: string, patch: Partial<PerformanceRow>) => { setEdited(true); setRows((a) => a.map((r) => (r.id === id ? { ...r, ...patch } : r))); };
  const addRow = () => { setEdited(true); setRows((a) => [...a, { id: newId(), time: "", activity: "", assistance: "Supervision", assistedBy: "CGs" }]); };
  const removeRow = (id: string) => { setEdited(true); setRows((a) => a.filter((r) => r.id !== id)); };
  const reseed = async () => {
    const c = await Swal.fire({ title: "Re-seed from routine?", text: "Replaces this table with a fresh copy of the current 24-hour routine. Manual edits will be lost.", icon: "warning", showCancelButton: true, confirmButtonColor: "#4F46E5", confirmButtonText: "Re-seed" });
    if (!c.isConfirmed) return;
    setEdited(true);
    setRows(seed);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--clinical-muted)]">Seeded from the 24-hour routine — edit Time, Activities, Level of Assistance and Assisted By, add or remove rows. Saved automatically for this resident.</p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void reseed()} disabled={seed.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-[var(--clinical-panel)] transition hover:bg-[var(--clinical-surface-2)] disabled:opacity-50"
            style={{ borderColor: "var(--clinical-line-strong)" }}>
            <RotateCcw className="h-3.5 w-3.5" /> Re-seed from routine
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--clinical-line)" }}>
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--clinical-muted)]" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
              <th className="px-3 py-2 font-bold">Time</th>
              <th className="px-3 py-2 font-bold">Activities</th>
              <th className="px-3 py-2 font-bold">Level of Assistance</th>
              <th className="px-3 py-2 font-bold">Assisted By</th>
              <th className="px-2 py-2" aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t" style={{ borderColor: "var(--clinical-line)" }}>
                <td className="px-2 py-1.5 align-top" style={{ width: 84 }}>
                  <input value={r.time} onChange={(e) => setCell(r.id, { time: e.target.value })} placeholder="0800" inputMode="numeric" className={`${cell} text-center font-mono`} style={{ borderColor: "var(--clinical-line)" }} aria-label="Time" />
                </td>
                <td className="px-2 py-1.5 align-top">
                  <input value={r.activity} onChange={(e) => setCell(r.id, { activity: e.target.value })} placeholder="Activity…" className={cell} style={{ borderColor: "var(--clinical-line)" }} aria-label="Activity" />
                </td>
                <td className="px-2 py-1.5 align-top" style={{ width: 168 }}>
                  <select value={r.assistance} onChange={(e) => setCell(r.id, { assistance: e.target.value })} className={cell} style={{ borderColor: "var(--clinical-line)" }} aria-label="Level of assistance">
                    {(ASSISTANCE_LEVELS as readonly string[]).includes(r.assistance) ? null : <option value={r.assistance}>{r.assistance || "—"}</option>}
                    {ASSISTANCE_LEVELS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5 align-top" style={{ width: 118 }}>
                  <select value={r.assistedBy} onChange={(e) => setCell(r.id, { assistedBy: e.target.value })} className={cell} style={{ borderColor: "var(--clinical-line)" }} aria-label="Assisted by">
                    {(ASSISTED_BY as readonly string[]).includes(r.assistedBy) ? null : <option value={r.assistedBy}>{r.assistedBy || "—"}</option>}
                    {ASSISTED_BY.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5 align-top">
                  <button type="button" onClick={() => removeRow(r.id)} aria-label="Remove row"
                    className="mt-1 rounded-md p-1.5 text-[var(--clinical-muted)] transition hover:bg-[var(--clinical-surface-2)] hover:text-[var(--clinical-coral)]">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-[var(--clinical-muted)]">No routine yet. Add rows manually, or generate/adjust the care plan to seed the daily routine.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3">
        <ClinicalButton variant="secondary" size="sm" onClick={addRow}><Plus className="h-3.5 w-3.5" /> Add row</ClinicalButton>
      </div>
    </div>
  );
}
