"use client";

/**
 * Shift Summary — today's documentation-completion matrix across the seven core
 * care domains (Vitals, Meals, Elimination, Mood, Pain, Mobility, Sleep) for
 * every resident, plus an overall-completion header. Rolls up the same DailyRounds
 * data as Care Logs via the shared useCareLogData hook (Elimination folds
 * bowel/urine/edema/concerns). Read-only; no schema changes.
 */

import { useMemo } from "react";
import { Activity, Utensils, Droplets, Smile, Zap, Footprints, Moon, Wind, CheckCircle2, Circle, AlertTriangle, RefreshCw, type LucideIcon } from "lucide-react";
import { useCareLogData, levelOf } from "./CareLogsBoard";
import { type ClinicianRole } from "./useClinician";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const s = (v: unknown) => (v == null ? "" : String(v));

// Ten domain columns — the same ten areas as Daily Rounds / the quick-log modal.
const COLS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: "vitals", label: "Vitals", icon: Activity },
  { key: "meals", label: "Meals", icon: Utensils },
  { key: "bowel", label: "Bowel", icon: Droplets },
  { key: "urine", label: "Urine", icon: Droplets },
  { key: "edema", label: "Edema", icon: Wind },
  { key: "concerns", label: "Concerns", icon: AlertTriangle },
  { key: "mood", label: "Mood", icon: Smile },
  { key: "pain", label: "Pain", icon: Zap },
  { key: "mobility", label: "Mobility", icon: Footprints },
  { key: "sleep", label: "Sleep", icon: Moon },
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

  const doneTone = (n: number) => (n === COLS.length ? "text-green-600" : n === 0 ? "text-red-600" : "text-amber-600");
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Shift Summary</h1>
          <p className="text-sm text-slate-500 mt-1">{today}</p>
        </div>
        <button onClick={() => refetchAll()} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"><RefreshCw className="w-4 h-4" /> Refresh</button>
      </div>

      {/* Overall completion */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="font-semibold text-slate-700">Overall Documentation Completion</p>
          <p className="text-2xl font-bold text-blue-600">{stats.pct}%</p>
        </div>
        <div className="h-2.5 rounded-full bg-blue-100 overflow-hidden"><div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${stats.pct}%` }} /></div>
        <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
          <span>{stats.full} of {residents.length} residents fully documented</span>
          <span>{entries.length} total logs today</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-sm text-slate-500">
        <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-600" /> Done</span>
        <span className="inline-flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-red-500" /> Alert</span>
        <span className="inline-flex items-center gap-1.5"><Circle className="w-4 h-4 text-slate-300" /> Missing</span>
      </div>

      {/* Matrix */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm min-w-[1100px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60">
              <th className="text-left font-semibold text-slate-500 px-4 py-3">Rm</th>
              <th className="text-left font-semibold text-slate-500 px-4 py-3">Resident</th>
              <th className="text-left font-semibold text-slate-500 px-4 py-3">Level</th>
              {COLS.map((c) => { const Icon = c.icon; return (
                <th key={c.key} className="px-2 py-3 text-center"><div className="flex flex-col items-center gap-1 text-slate-500"><Icon className="w-4 h-4" /><span className="text-xs font-semibold">{c.label}</span></div></th>
              ); })}
              <th className="px-4 py-3 text-center font-semibold text-slate-500">Done</th>
            </tr>
          </thead>
          <tbody>
            {residents.map((r: Row) => {
              const doneCount = COLS.filter((c) => isDone(s(r.id), c)).length;
              const lvl = levelOf(r);
              return (
                <tr key={s(r.id)} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-semibold text-slate-700">{s(r.room)}</td>
                  <td className="px-4 py-3 font-bold text-slate-900">{s(r.name)}</td>
                  <td className="px-4 py-3"><span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${lvl.badge}`}>L{lvl.n}</span></td>
                  {COLS.map((c) => (
                    <td key={c.key} className="px-2 py-3 text-center">{isDone(s(r.id), c) ? <CheckCircle2 className="w-5 h-5 text-green-600 inline" /> : <Circle className="w-5 h-5 text-slate-200 inline" />}</td>
                  ))}
                  <td className={`px-4 py-3 text-center font-bold ${doneTone(doneCount)}`}>{doneCount}/{COLS.length}</td>
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
