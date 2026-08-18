"use client";

/**
 * Shift Summary — today's documentation-completion matrix across the 14 LifeCare
 * v4.2 assessment domains (AS-01 … AS-14) for every resident, plus an overall-
 * completion header. Rolls up the same data as Care Logs via the shared
 * useCareLogData hook (whose domainsByRes is now keyed by the AS-codes).
 * Read-only; no schema changes.
 */

import { useMemo } from "react";
import { Activity, Utensils, Droplets, Smile, Footprints, Moon, Wind, CheckCircle2, Circle, AlertTriangle, RefreshCw, Bath, TrendingDown, Brain, Pill, MessageCircle, Dumbbell, ShieldAlert, type LucideIcon } from "lucide-react";
import { useCareLogData, levelOf } from "./CareLogsBoard";
import { type ClinicianRole } from "./useClinician";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const s = (v: unknown) => (v == null ? "" : String(v));

// 14 domain columns — the LifeCare v4.2 assessment domains (AS-01 … AS-14), the
// same domain keys the shared hook's domainsByRes now uses. Pain is a standalone
// symptom log (not one of the 14), so it is not a completion column here.
const COLS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: "AS-01", label: "ADLs", icon: Bath },
  { key: "AS-02", label: "Mobility", icon: Footprints },
  { key: "AS-03", label: "Fall Risk", icon: TrendingDown },
  { key: "AS-04", label: "Cognition", icon: Brain },
  { key: "AS-05", label: "Behavior", icon: Smile },
  { key: "AS-06", label: "Clinical", icon: Activity },
  { key: "AS-07", label: "Medication", icon: Pill },
  { key: "AS-08", label: "Nutrition", icon: Utensils },
  { key: "AS-09", label: "Communication", icon: MessageCircle },
  { key: "AS-10", label: "Continence", icon: Droplets },
  { key: "AS-11", label: "Skin", icon: Wind },
  { key: "AS-12", label: "Sleep", icon: Moon },
  { key: "AS-13", label: "Safety", icon: ShieldAlert },
  { key: "AS-14", label: "Reablement", icon: Dumbbell },
];

export default function ShiftSummaryBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { residents, entries, domainsByRes, refetchAll } = useCareLogData(clinicianRole);

  const isDone = (resId: string, col: (typeof COLS)[number]) => {
    const set = domainsByRes.get(resId);
    return set ? set.has(col.key as never) : false;
  };

  const stats = useMemo(() => {
    let done = 0;
    let full = 0;
    residents.forEach((r: Row) => {
      const d = COLS.filter((c) => isDone(s(r.id), c)).length;
      done += d;
      if (d === COLS.length) full++;
    });
    const cells = residents.length * COLS.length || 1;
    return { pct: Math.round((done / cells) * 100), full };
  }, [residents, domainsByRes]); // eslint-disable-line react-hooks/exhaustive-deps

  const doneTone = (n: number) => (n === COLS.length ? "#16A34A" : n === 0 ? "#DC2626" : "#D97706");
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="-m-4 sm:-m-6 p-4 sm:p-6 min-h-full space-y-4" style={{ background: "#F7F8FA" }}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.75rem]">Shift Summary</h1>
          <p className="mt-1 text-sm text-slate-500">{today}</p>
        </div>
        <button onClick={() => refetchAll()} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"><RefreshCw className="h-4 w-4" /> Refresh</button>
      </div>

      {/* Overall completion */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-semibold text-slate-800">Overall Documentation Completion</p>
          <p className="text-2xl font-bold tabular-nums text-[#4F46E5]">{stats.pct}%</p>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#4F46E5] transition-all" style={{ width: `${stats.pct}%` }} /></div>
        <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
          <span>{stats.full} of {residents.length} residents fully documented</span>
          <span>{entries.length} total logs today</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-sm text-slate-500">
        <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-[#16A34A]" /> Done</span>
        <span className="inline-flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-[#DC2626]" /> Alert</span>
        <span className="inline-flex items-center gap-1.5"><Circle className="h-4 w-4 text-slate-300" /> Missing</span>
      </div>

      {/* Matrix */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1100px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60">
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rm</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Resident</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Level</th>
              {COLS.map((c) => { const Icon = c.icon; return (
                <th key={c.key} className="px-2 py-3 text-center"><div className="flex flex-col items-center gap-1 text-slate-500"><Icon className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wide">{c.label}</span></div></th>
              ); })}
              <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">Done</th>
            </tr>
          </thead>
          <tbody>
            {residents.map((r: Row) => {
              const doneCount = COLS.filter((c) => isDone(s(r.id), c)).length;
              const lvl = levelOf(r);
              return (
                <tr key={s(r.id)} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-3 font-semibold text-slate-600">{s(r.room)}</td>
                  <td className="px-4 py-3 font-bold text-slate-900">{s(r.name)}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${lvl.badge}`}>L{lvl.n}</span></td>
                  {COLS.map((c) => (
                    <td key={c.key} className="px-2 py-3 text-center">{isDone(s(r.id), c) ? <CheckCircle2 className="inline h-5 w-5 text-[#16A34A]" /> : <Circle className="inline h-5 w-5 text-slate-300" />}</td>
                  ))}
                  <td className="px-4 py-3 text-center font-bold tabular-nums" style={{ color: doneTone(doneCount) }}>{doneCount}/{COLS.length}</td>
                </tr>
              );
            })}
            {residents.length === 0 && <tr><td colSpan={COLS.length + 4} className="px-4 py-8 text-center text-slate-400">No residents.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
