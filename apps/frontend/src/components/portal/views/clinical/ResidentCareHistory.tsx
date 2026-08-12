"use client";

/**
 * Care History — a per-resident daily documentation grid across the 7 care
 * domains (Vitals, Meals, Elimination, Mood, Pain, Mobility, Sleep).
 *
 * Reuses `useCareLogData` from CareLogsBoard as the single data source: it loads
 * residents + daily-rounds + all ten DailyRounds domain record resources and
 * returns an `entries` array of { id, resId, domain, at, summary }. This board
 * maps the hook's 10 domains → 7 rows (Elimination = bowel + urine; edema and
 * concerns are not their own rows) and buckets entries by (domain, day).
 *
 * Per-domain, per-day status rule:
 *   • Logged    — ≥ 1 entry for that domain on that day.
 *   • Escalated — a `concerns` entry exists that day (concerns roll into no row,
 *     so a same-day concern flags the domain as escalated) OR the day's entry
 *     summary contains "severe" / "high" / "critical" / "blood: true" / a fall.
 *   • Missing   — no entry for that domain on that day.
 *
 * Weight Entries come from the same source WeightMonitoringBoard uses — the
 * app-setting `weight_logs` JSON array (date · kg · cadence badge · author).
 * Caregiver Notes are derived from the domain entries in the period (domain
 * badge + timestamp + the entry summary as text). The hook's Entry carries no
 * author field, so notes are shown without a "— Author" line rather than
 * fabricating one.
 *
 * Migration-free, read-only. Export PDF uses window.print().
 */

import { useMemo, useState } from "react";
import {
  ClipboardList, Printer, CheckCircle2, AlertTriangle, ChevronLeft, ChevronRight,
  MessageSquare, Scale, Activity, Utensils, Droplets, Smile, Zap, Footprints, Moon, Wind,
  type LucideIcon,
} from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { type ClinicianRole } from "./useClinician";
import { useCareLogData } from "./CareLogsBoard";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const s = (v: unknown) => (v == null ? "" : String(v));

// All 10 care domains, each its own grid row (matches the quick-log domains).
type HookDomain = "vitals" | "meals" | "bowel" | "urine" | "edema" | "concerns" | "mood" | "pain" | "mobility" | "sleep";
interface GridDomain { key: string; label: string; icon: LucideIcon; tint: string; bg: string; pill: string; sources: HookDomain[]; }
const GRID_DOMAINS: GridDomain[] = [
  { key: "vitals", label: "Vitals", icon: Activity, tint: "text-rose-500", bg: "bg-rose-50", pill: "bg-rose-100 text-rose-600", sources: ["vitals"] },
  { key: "meals", label: "Meals", icon: Utensils, tint: "text-green-600", bg: "bg-green-50", pill: "bg-green-100 text-green-700", sources: ["meals"] },
  { key: "bowel", label: "Bowel", icon: Droplets, tint: "text-amber-600", bg: "bg-amber-50", pill: "bg-amber-100 text-amber-700", sources: ["bowel"] },
  { key: "urine", label: "Urine", icon: Droplets, tint: "text-yellow-600", bg: "bg-yellow-50", pill: "bg-yellow-100 text-yellow-700", sources: ["urine"] },
  { key: "edema", label: "Edema", icon: Wind, tint: "text-sky-600", bg: "bg-sky-50", pill: "bg-sky-100 text-sky-700", sources: ["edema"] },
  { key: "concerns", label: "Concerns", icon: AlertTriangle, tint: "text-red-600", bg: "bg-red-50", pill: "bg-red-100 text-red-700", sources: ["concerns"] },
  { key: "mood", label: "Mood", icon: Smile, tint: "text-purple-500", bg: "bg-purple-50", pill: "bg-purple-100 text-purple-700", sources: ["mood"] },
  { key: "pain", label: "Pain", icon: Zap, tint: "text-orange-500", bg: "bg-orange-50", pill: "bg-orange-100 text-orange-700", sources: ["pain"] },
  { key: "mobility", label: "Mobility", icon: Footprints, tint: "text-teal-600", bg: "bg-teal-50", pill: "bg-teal-100 text-teal-700", sources: ["mobility"] },
  { key: "sleep", label: "Sleep", icon: Moon, tint: "text-indigo-500", bg: "bg-indigo-50", pill: "bg-indigo-100 text-indigo-700", sources: ["sleep"] },
];
// Map every hook domain → the grid row it feeds (concerns has no row of its own;
// it is used only to escalate whatever day it falls on).
const SOURCE_TO_GRID: Partial<Record<HookDomain, string>> = {};
GRID_DOMAINS.forEach((g) => g.sources.forEach((src) => { SOURCE_TO_GRID[src] = g.key; }));

type CellStatus = "logged" | "escalated" | "missing";

// ── date helpers (LOCAL calendar day — the care day / quick-log create their
// rounds in local time, so the grid must bucket entries by local day too, or an
// ahead-of-UTC timezone drops "today" from the window). ─────────────────────
const localYMD = (d: Date) => isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayKey = (iso: string) => localYMD(new Date(iso));
const isoDay = (d: Date) => localYMD(d);
const addDaysIso = (isoStr: string, n: number) => { const d = new Date(isoStr + "T00:00:00"); d.setDate(d.getDate() + n); return isoDay(d); };
const fmtRange = (startIso: string, endIso: string) => {
  const a = new Date(startIso + "T00:00:00"), b = new Date(endIso + "T00:00:00");
  const m = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${m(a)} – ${b.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
};

// ── weight logs (same source as WeightMonitoringBoard) ───────────────────────
const WEIGHT_KEY = "weight_logs";
interface WeightLog { id: string; residentId: string; type: string; date: string; weightKg?: number; unit?: string; note?: string; by?: string; }
const parseWeights = (raw: string | null | undefined): WeightLog[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((l) => l && typeof l.id === "string") : []; } catch { return []; } };
const WEIGHT_BADGE: Record<string, string> = { weekly: "Weekly", baseline: "Baseline", additional: "Additional" };
const kg = (w: number) => (Number.isInteger(w) ? String(w) : w.toFixed(1));

const RANGE_OPTIONS = [7, 14, 30] as const;
type RangeDays = (typeof RANGE_OPTIONS)[number];

export default function ResidentCareHistory({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  // allEntries spans ALL dates (not just today) so past days populate the grid.
  const { residents, allEntries: entries } = useCareLogData(clinicianRole);
  const { data: settingRows } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const now = new Date();
  const todayIso = isoDay(now);

  const [resId, setResId] = useState("");
  const [rangeDays, setRangeDays] = useState<RangeDays>(14);
  // windowEnd = last (rightmost) day shown; defaults to today, arrows page it.
  const [windowEnd, setWindowEnd] = useState(todayIso);

  const resident = useMemo(() => residents.find((r: Row) => s(r.id) === resId) || null, [residents, resId]);

  // The N-day window (inclusive) ending at windowEnd, oldest → newest.
  const days = useMemo(() => {
    const out: string[] = [];
    for (let i = rangeDays - 1; i >= 0; i--) out.push(addDaysIso(windowEnd, -i));
    return out;
  }, [rangeDays, windowEnd]);
  const startIso = days[0];
  const endIso = days[days.length - 1];

  // Entries for the selected resident within the visible window, bucketed by day.
  const entriesInWindow = useMemo(() => {
    if (!resId) return [] as typeof entries;
    return entries.filter((e) => {
      if (e.resId !== resId) return false;
      const k = dayKey(e.at);
      return k >= startIso && k <= endIso;
    });
  }, [entries, resId, startIso, endIso]);

  // Escalation detector for a domain entry summary.
  const isEscalatedSummary = (summary: string) => {
    const t = summary.toLowerCase();
    return t.includes("severe") || t.includes("high") || t.includes("critical")
      || t.includes("bloodpresent: true") || t.includes("fallincident: true");
  };

  // grid[gridKey][dayIso] = CellStatus
  const grid = useMemo(() => {
    const g: Record<string, Record<string, CellStatus>> = {};
    GRID_DOMAINS.forEach((d) => { g[d.key] = {}; days.forEach((day) => { g[d.key][day] = "missing"; }); });
    // Days that carry a concern → escalate every logged domain that day.
    const concernDays = new Set<string>();
    entriesInWindow.forEach((e) => { if (e.domain === "concerns") concernDays.add(dayKey(e.at)); });
    entriesInWindow.forEach((e) => {
      const gridKey = SOURCE_TO_GRID[e.domain as HookDomain];
      if (!gridKey) return; // concerns / edema — no row
      const k = dayKey(e.at);
      if (!(k in g[gridKey])) return;
      const escalated = concernDays.has(k) || isEscalatedSummary(e.summary);
      const cur = g[gridKey][k];
      if (escalated) g[gridKey][k] = "escalated";
      else if (cur === "missing") g[gridKey][k] = "logged";
    });
    return g;
  }, [entriesInWindow, days]);

  // Summary stats across all 7 domains × N days.
  const stats = useMemo(() => {
    let logged = 0, escalated = 0, missing = 0;
    GRID_DOMAINS.forEach((d) => days.forEach((day) => {
      const st = grid[d.key][day];
      if (st === "logged") logged++; else if (st === "escalated") escalated++; else missing++;
    }));
    const total = GRID_DOMAINS.length * days.length;
    const done = logged + escalated;
    const completion = total ? Math.round((done / total) * 100) : 0;
    return { logged: done, escalated, missing, total, completion };
  }, [grid, days]);

  // Per-domain completion (logged+escalated days / N days).
  const domainCompletion = useMemo(() => GRID_DOMAINS.map((d) => {
    const done = days.reduce((a, day) => a + (grid[d.key][day] !== "missing" ? 1 : 0), 0);
    return { key: d.key, done, total: days.length, pct: days.length ? Math.round((done / days.length) * 100) : 0 };
  }), [grid, days]);

  // Caregiver notes — domain entries in the window (badge + time + summary text).
  const notes = useMemo(() => entriesInWindow
    .filter((e) => e.domain !== "concerns" || true) // include concerns too (they carry the richest text)
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at)), [entriesInWindow]);

  // Weight entries in the window.
  const weightLogs = useMemo(() => {
    const all = parseWeights(settingRows.find((r) => (r.key || r.id) === WEIGHT_KEY)?.value);
    return all
      .filter((l) => l.residentId === resId && l.weightKg != null)
      .filter((l) => { const k = dayKey(l.date); return k >= startIso && k <= endIso; })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [settingRows, resId, startIso, endIso]);

  const canPageForward = endIso < todayIso;

  return (
    <div className="min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6 print:bg-white print:m-0">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 flex items-center gap-2"><ClipboardList className="w-6 h-6 text-blue-500" /> Care History</h1>
          <p className="text-sm text-slate-500 mt-1">Daily documentation grid for all 10 care domains</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {resident && (
            <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"><Printer className="w-4 h-4" /> Export PDF</button>
          )}
          <select value={resId} onChange={(e) => { setResId(e.target.value); setWindowEnd(todayIso); }} className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-blue-400/40 max-w-[220px]">
            <option value="">Select resident…</option>
            {residents.map((r: Row) => <option key={s(r.id)} value={s(r.id)}>Rm {s(r.room)} — {s(r.name)}</option>)}
          </select>
          <div className="inline-flex rounded-xl border border-slate-200 bg-white overflow-hidden">
            {RANGE_OPTIONS.map((d) => (
              <button key={d} onClick={() => { setRangeDays(d); setWindowEnd(todayIso); }} className={`px-3 py-2 text-sm font-semibold ${rangeDays === d ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{d} days</button>
            ))}
          </div>
        </div>
      </div>

      {!resident ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-16 flex flex-col items-center justify-center text-center">
          <ClipboardList className="w-12 h-12 text-slate-300 mb-3" />
          <p className="text-lg font-bold text-slate-700">Select a resident to view care history</p>
          <p className="text-sm text-slate-400 mt-1">Choose a resident from the dropdown above to see their daily documentation grid</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Summary card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex flex-col items-center justify-center leading-none shrink-0"><span className="text-[9px] font-semibold text-blue-400">Rm</span><span className="text-sm font-bold text-blue-700">{s(resident.room)}</span></div>
              <div className="min-w-0">
                <p className="font-bold text-slate-900 truncate">{s(resident.name)}</p>
                <p className="text-xs text-slate-400 mt-0.5">{startIso} — {endIso}</p>
              </div>
            </div>
            <div className="flex items-center gap-6 sm:gap-8">
              <Stat value={`${stats.completion}%`} label="Completion" tone="text-slate-900" />
              <Stat value={String(stats.logged)} label="Logged" tone="text-green-600" />
              <Stat value={String(stats.escalated)} label="Escalated" tone="text-amber-600" />
              <Stat value={String(stats.missing)} label="Missing" tone="text-slate-400" />
            </div>
          </div>

          {/* Documentation Grid */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <p className="font-bold text-slate-900">Documentation Grid</p>
                <div className="flex items-center gap-4 mt-2">
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500"><CheckCircle2 className="w-4 h-4 text-green-500" /> Logged</span>
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500"><AlertTriangle className="w-4 h-4 text-amber-500" /> Escalated</span>
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500"><span className="w-3.5 h-3.5 rounded-full border-2 border-slate-300 inline-block" /> Missing</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 print:hidden">
                <button onClick={() => setWindowEnd((w) => addDaysIso(w, -rangeDays))} className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50"><ChevronLeft className="w-4 h-4" /></button>
                <span className="text-sm font-medium text-slate-600 px-1">{fmtRange(startIso, endIso)}</span>
                <button onClick={() => setWindowEnd((w) => addDaysIso(w, rangeDays))} disabled={!canPageForward} className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>

            <div className="overflow-x-auto -mx-4 sm:-mx-5 px-4 sm:px-5">
              <table className="border-collapse min-w-max">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-white text-left px-3 py-2 text-xs font-semibold text-slate-500 border-b border-slate-100">Domain</th>
                    {days.map((day) => { const d = new Date(day + "T00:00:00"); const isToday = day === todayIso; return (
                      <th key={day} className={`px-2 py-2 text-center border-b border-slate-100 ${isToday ? "bg-blue-50/60" : ""}`}>
                        <div className="text-[10px] font-semibold uppercase text-slate-400">{d.toLocaleDateString(undefined, { weekday: "short" })}</div>
                        <div className="text-sm font-bold text-slate-700">{d.getDate()}</div>
                        <div className="text-[10px] text-slate-400">{d.toLocaleDateString(undefined, { month: "short" })}</div>
                      </th>
                    ); })}
                  </tr>
                </thead>
                <tbody>
                  {GRID_DOMAINS.map((dom) => { const Icon = dom.icon; return (
                    <tr key={dom.key}>
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 border-b border-slate-50 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700"><Icon className={`w-4 h-4 ${dom.tint}`} /> {dom.label}</span>
                      </td>
                      {days.map((day) => { const st = grid[dom.key][day]; const isToday = day === todayIso; return (
                        <td key={day} className={`px-2 py-2 text-center border-b border-slate-50 ${isToday ? "bg-blue-50/40" : ""}`}>
                          <StatusIcon status={st} />
                        </td>
                      ); })}
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Caregiver Notes Summary */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <p className="font-bold text-slate-900 flex items-center gap-2"><MessageSquare className="w-5 h-5 text-blue-500" /> Caregiver Notes Summary</p>
            <p className="text-sm text-slate-400 mt-0.5">{notes.length} note{notes.length === 1 ? "" : "s"} recorded in this period</p>
            {notes.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">No notes recorded in this period.</p>
            ) : (
              <div className="mt-3 space-y-2.5 max-h-96 overflow-y-auto pr-1">
                {notes.map((e) => { const dom = GRID_DOMAINS.find((g) => g.sources.includes(e.domain as HookDomain)); return (
                  <div key={e.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${dom?.pill ?? "bg-slate-100 text-slate-500"}`}>{dom?.label ?? "Concern"}</span>
                      <span className="text-xs text-slate-400">{new Date(e.at).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    <p className="text-sm text-slate-700 mt-1.5">{e.summary}</p>
                  </div>
                ); })}
              </div>
            )}
          </div>

          {/* Weight Entries */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <p className="font-bold text-slate-900 flex items-center gap-2"><Scale className="w-5 h-5 text-blue-500" /> Weight Entries</p>
            <p className="text-sm text-slate-400 mt-0.5">Weight checks recorded in this period</p>
            {weightLogs.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">No weight entries in this period.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {weightLogs.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-slate-400 tabular-nums">{dayKey(l.date)}</span>
                      <span className="text-base font-bold text-slate-800">{kg(l.weightKg!)} kg</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border border-slate-200 text-slate-600">{WEIGHT_BADGE[l.type] ?? l.type}</span>
                      {l.by && <span className="text-xs text-slate-400">— {l.by}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Domain Completion Summary */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <p className="font-bold text-slate-900">Domain Completion Summary</p>
            <p className="text-sm text-slate-400 mt-0.5">Percentage of days logged per domain in the selected period</p>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {GRID_DOMAINS.map((dom) => { const c = domainCompletion.find((x) => x.key === dom.key)!; const Icon = dom.icon; return (
                <div key={dom.key} className={`rounded-2xl border border-slate-100 ${dom.bg} p-4 text-center`}>
                  <Icon className={`w-5 h-5 mx-auto ${dom.tint}`} />
                  <p className="text-sm font-semibold text-slate-700 mt-1">{dom.label}</p>
                  <p className="text-2xl font-bold text-green-600 mt-1">{c.pct}%</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{c.done}/{c.total} days</p>
                </div>
              ); })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone: string }) {
  return <div className="text-center"><p className={`text-2xl font-bold ${tone}`}>{value}</p><p className="text-xs text-slate-400 mt-0.5">{label}</p></div>;
}

function StatusIcon({ status }: { status: CellStatus }) {
  if (status === "logged") return <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />;
  if (status === "escalated") return <AlertTriangle className="w-4 h-4 text-amber-500 mx-auto" />;
  return <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-200 inline-block" />;
}
