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
import { ClinicalPage, ClinicalHeader, ClinicalButton, SERIF } from "./clinical-ui";

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

  const doneTone = (n: number) => (n === COLS.length ? "var(--clinical-green)" : n === 0 ? "var(--clinical-coral)" : "var(--clinical-amber)");
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <ClinicalPage>
      <ClinicalHeader
        title="Shift Summary"
        subtitle={today}
        right={<ClinicalButton variant="secondary" onClick={() => refetchAll()}><RefreshCw className="h-4 w-4" /> Refresh</ClinicalButton>}
      />

      {/* Overall completion */}
      <div className="mt-5 mb-4 rounded-xl border p-5" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
        <div className="mb-2 flex items-center justify-between">
          <p className="font-semibold text-[var(--clinical-ink)]">Overall Documentation Completion</p>
          <p className="text-2xl font-bold tabular-nums text-[var(--clinical-panel)]" style={{ fontFamily: SERIF }}>{stats.pct}%</p>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full" style={{ backgroundColor: "var(--clinical-surface-2)" }}><div className="h-full rounded-full transition-all" style={{ width: `${stats.pct}%`, backgroundColor: "var(--clinical-panel)" }} /></div>
        <div className="mt-2 flex items-center justify-between text-xs text-[var(--clinical-muted)]">
          <span>{stats.full} of {residents.length} residents fully documented</span>
          <span>{entries.length} total logs today</span>
        </div>
      </div>

      {/* Legend */}
      <div className="mb-3 flex items-center gap-4 text-sm text-[var(--clinical-muted)]">
        <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" style={{ color: "var(--clinical-green)" }} /> Done</span>
        <span className="inline-flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" style={{ color: "var(--clinical-coral)" }} /> Alert</span>
        <span className="inline-flex items-center gap-1.5"><Circle className="h-4 w-4" style={{ color: "var(--clinical-line-strong)" }} /> Missing</span>
      </div>

      {/* Matrix */}
      <div className="overflow-x-auto rounded-xl border" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
        <table className="w-full min-w-[1100px] text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface-2)" }}>
              <th className="px-4 py-3 text-left font-semibold text-[var(--clinical-muted)]">Rm</th>
              <th className="px-4 py-3 text-left font-semibold text-[var(--clinical-muted)]">Resident</th>
              <th className="px-4 py-3 text-left font-semibold text-[var(--clinical-muted)]">Level</th>
              {COLS.map((c) => { const Icon = c.icon; return (
                <th key={c.key} className="px-2 py-3 text-center"><div className="flex flex-col items-center gap-1 text-[var(--clinical-muted)]"><Icon className="h-4 w-4" /><span className="text-xs font-semibold">{c.label}</span></div></th>
              ); })}
              <th className="px-4 py-3 text-center font-semibold text-[var(--clinical-muted)]">Done</th>
            </tr>
          </thead>
          <tbody>
            {residents.map((r: Row) => {
              const doneCount = COLS.filter((c) => isDone(s(r.id), c)).length;
              const lvl = levelOf(r);
              return (
                <tr key={s(r.id)} className="border-b last:border-0" style={{ borderColor: "var(--clinical-line)" }}>
                  <td className="px-4 py-3 font-semibold text-[var(--clinical-ink-soft)]">{s(r.room)}</td>
                  <td className="px-4 py-3 font-bold text-[var(--clinical-ink)]">{s(r.name)}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${lvl.badge}`}>L{lvl.n}</span></td>
                  {COLS.map((c) => (
                    <td key={c.key} className="px-2 py-3 text-center">{isDone(s(r.id), c) ? <CheckCircle2 className="inline h-5 w-5" style={{ color: "var(--clinical-green)" }} /> : <Circle className="inline h-5 w-5" style={{ color: "var(--clinical-line-strong)" }} />}</td>
                  ))}
                  <td className="px-4 py-3 text-center font-bold tabular-nums" style={{ color: doneTone(doneCount) }}>{doneCount}/{COLS.length}</td>
                </tr>
              );
            })}
            {residents.length === 0 && <tr><td colSpan={COLS.length + 4} className="px-4 py-8 text-center text-[var(--clinical-muted)]">No residents.</td></tr>}
          </tbody>
        </table>
      </div>
    </ClinicalPage>
  );
}
