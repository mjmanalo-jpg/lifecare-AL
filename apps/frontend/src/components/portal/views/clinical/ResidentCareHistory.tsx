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
import { ClinicalPage, ClinicalHeader, ClinicalButton, ClinicalCard, StatCard, controlClass, SERIF } from "./clinical-ui";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const s = (v: unknown) => (v == null ? "" : String(v));
// Initials for the resident picker-card avatar.
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

// All 10 care domains, each its own grid row (matches the quick-log domains).
type HookDomain = "vitals" | "meals" | "bowel" | "urine" | "edema" | "concerns" | "mood" | "pain" | "mobility" | "sleep";
interface GridDomain { key: string; label: string; icon: LucideIcon; sources: HookDomain[]; }
const GRID_DOMAINS: GridDomain[] = [
  { key: "vitals", label: "Vitals", icon: Activity, sources: ["vitals"] },
  { key: "meals", label: "Meals", icon: Utensils, sources: ["meals"] },
  { key: "bowel", label: "Bowel", icon: Droplets, sources: ["bowel"] },
  { key: "urine", label: "Urine", icon: Droplets, sources: ["urine"] },
  { key: "edema", label: "Edema", icon: Wind, sources: ["edema"] },
  { key: "concerns", label: "Concerns", icon: AlertTriangle, sources: ["concerns"] },
  { key: "mood", label: "Mood", icon: Smile, sources: ["mood"] },
  { key: "pain", label: "Pain", icon: Zap, sources: ["pain"] },
  { key: "mobility", label: "Mobility", icon: Footprints, sources: ["mobility"] },
  { key: "sleep", label: "Sleep", icon: Moon, sources: ["sleep"] },
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
    <ClinicalPage className="print:bg-white print:m-0">
      <ClinicalHeader
        title="Care History"
        subtitle="Daily documentation grid for all 10 care domains"
        right={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {resident && (
              <ClinicalButton variant="secondary" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> Export PDF</ClinicalButton>
            )}
            <select value={resId} onChange={(e) => { setResId(e.target.value); setWindowEnd(todayIso); }} aria-label="Select resident" className={`${controlClass} w-full sm:w-64`}>
              <option value="">Select resident…</option>
              {residents.map((r: Row) => <option key={s(r.id)} value={s(r.id)}>Rm {s(r.room)} — {s(r.name)}</option>)}
            </select>
            <div className="inline-flex overflow-hidden rounded-lg border" style={{ borderColor: "var(--clinical-line-strong)" }}>
              {RANGE_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => { setRangeDays(d); setWindowEnd(todayIso); }}
                  aria-pressed={rangeDays === d}
                  className={`px-3 py-2 text-sm font-semibold ${rangeDays === d ? "bg-[var(--clinical-panel)] text-white" : "text-[var(--clinical-ink-soft)] hover:bg-[var(--clinical-surface-2)]"}`}
                >{d} days</button>
              ))}
            </div>
          </div>
        }
      />

      <div className="mt-5">
        {!resident ? (
          <div className="@container">
            <div className="mb-4 flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-[var(--clinical-panel)]" />
              <div>
                <p className="text-base font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>Select a resident to view care history</p>
                <p className="text-sm text-[var(--clinical-muted)]">Tap a resident to open their daily documentation grid</p>
              </div>
            </div>
            {residents.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed p-16 text-center text-sm text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line-strong)", backgroundColor: "var(--clinical-surface)" }}>No residents found.</div>
            ) : (
              <div className="grid grid-cols-2 gap-3 @lg:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-5">
                {residents.map((r: Row, i: number) => (
                  <button key={s(r.id)} onClick={() => { setResId(s(r.id)); setWindowEnd(todayIso); }}
                    className="group flex flex-col items-center gap-2.5 rounded-xl border p-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md animate-in fade-in slide-in-from-bottom-2 duration-300"
                    style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)", animationDelay: `${i * 40}ms`, animationFillMode: "backwards" }}>
                    <span className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold transition group-hover:brightness-95" style={{ backgroundColor: "var(--clinical-surface-2)", color: "var(--clinical-panel)" }}>{initials(s(r.name))}</span>
                    <span className="block w-full min-w-0">
                      <span className="block truncate text-sm font-semibold text-[var(--clinical-ink)]">{s(r.name)}</span>
                      <span className="block text-xs text-[var(--clinical-muted)]">Room {s(r.room)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary card */}
            <ClinicalCard className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl leading-none" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
                  <span className="text-[9px] font-semibold text-[var(--clinical-muted)]">Rm</span>
                  <span className="text-sm font-bold text-[var(--clinical-panel)]">{s(resident.room)}</span>
                </div>
                <div className="min-w-0">
                  <p className="truncate font-bold text-[var(--clinical-ink)]">{s(resident.name)}</p>
                  <p className="mt-0.5 text-xs text-[var(--clinical-muted)]">{startIso} — {endIso}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard value={`${stats.completion}%`} label="Completion" accent="ink" />
                <StatCard value={String(stats.logged)} label="Logged" accent="green" />
                <StatCard value={String(stats.escalated)} label="Escalated" accent="amber" />
                <StatCard value={String(stats.missing)} label="Missing" accent="ink" />
              </div>
            </ClinicalCard>

            {/* Documentation Grid */}
            <ClinicalCard className="p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>Documentation Grid</p>
                  <div className="mt-2 flex items-center gap-4">
                    <span className="inline-flex items-center gap-1 text-xs text-[var(--clinical-muted)]"><CheckCircle2 className="h-4 w-4 text-[var(--clinical-green)]" /> Logged</span>
                    <span className="inline-flex items-center gap-1 text-xs text-[var(--clinical-muted)]"><AlertTriangle className="h-4 w-4 text-[var(--clinical-amber)]" /> Escalated</span>
                    <span className="inline-flex items-center gap-1 text-xs text-[var(--clinical-muted)]"><span className="inline-block h-3.5 w-3.5 rounded-full border-2" style={{ borderColor: "var(--clinical-line-strong)" }} /> Missing</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 print:hidden">
                  <button onClick={() => setWindowEnd((w) => addDaysIso(w, -rangeDays))} aria-label="Previous period" className="flex h-8 w-8 items-center justify-center rounded-full border text-[var(--clinical-muted)] hover:bg-[var(--clinical-surface-2)]" style={{ borderColor: "var(--clinical-line-strong)" }}><ChevronLeft className="h-4 w-4" /></button>
                  <span className="px-1 text-sm font-medium text-[var(--clinical-ink-soft)]">{fmtRange(startIso, endIso)}</span>
                  <button onClick={() => setWindowEnd((w) => addDaysIso(w, rangeDays))} disabled={!canPageForward} aria-label="Next period" className="flex h-8 w-8 items-center justify-center rounded-full border text-[var(--clinical-muted)] hover:bg-[var(--clinical-surface-2)] disabled:cursor-not-allowed disabled:opacity-40" style={{ borderColor: "var(--clinical-line-strong)" }}><ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>

              <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
                <table className="min-w-max border-collapse">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 border-b px-3 py-2 text-left text-xs font-semibold text-[var(--clinical-muted)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>Domain</th>
                      {days.map((day) => { const d = new Date(day + "T00:00:00"); const isToday = day === todayIso; return (
                        <th key={day} className="border-b px-2 py-2 text-center" style={{ borderColor: "var(--clinical-line)", backgroundColor: isToday ? "var(--clinical-surface-2)" : undefined }}>
                          <div className="text-[10px] font-semibold uppercase text-[var(--clinical-muted)]">{d.toLocaleDateString(undefined, { weekday: "short" })}</div>
                          <div className="text-sm font-bold text-[var(--clinical-ink-soft)]">{d.getDate()}</div>
                          <div className="text-[10px] text-[var(--clinical-muted)]">{d.toLocaleDateString(undefined, { month: "short" })}</div>
                        </th>
                      ); })}
                    </tr>
                  </thead>
                  <tbody>
                    {GRID_DOMAINS.map((dom) => { const Icon = dom.icon; return (
                      <tr key={dom.key}>
                        <td className="sticky left-0 z-10 whitespace-nowrap border-b px-3 py-2" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--clinical-ink-soft)]"><Icon className="h-4 w-4 text-[var(--clinical-muted)]" /> {dom.label}</span>
                        </td>
                        {days.map((day) => { const st = grid[dom.key][day]; const isToday = day === todayIso; return (
                          <td key={day} className="border-b px-2 py-2 text-center" style={{ borderColor: "var(--clinical-line)", backgroundColor: isToday ? "var(--clinical-surface-2)" : undefined }}>
                            <StatusIcon status={st} />
                          </td>
                        ); })}
                      </tr>
                    ); })}
                  </tbody>
                </table>
              </div>
            </ClinicalCard>

            {/* Caregiver Notes Summary */}
            <ClinicalCard className="p-4 sm:p-5">
              <p className="flex items-center gap-2 font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}><MessageSquare className="h-5 w-5 text-[var(--clinical-panel)]" /> Caregiver Notes Summary</p>
              <p className="mt-0.5 text-sm text-[var(--clinical-muted)]">{notes.length} note{notes.length === 1 ? "" : "s"} recorded in this period</p>
              {notes.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--clinical-muted)]">No notes recorded in this period.</p>
              ) : (
                <div className="mt-3 max-h-96 space-y-2.5 overflow-y-auto pr-1">
                  {notes.map((e) => { const dom = GRID_DOMAINS.find((g) => g.sources.includes(e.domain as HookDomain)); return (
                    <div key={e.id} className="rounded-xl border p-3" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface-2)" }}>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold text-[var(--clinical-ink)]" style={{ borderColor: "var(--clinical-line-strong)" }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--clinical-panel)" }} />{dom?.label ?? "Concern"}
                        </span>
                        <span className="text-xs text-[var(--clinical-muted)]">{new Date(e.at).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                      </div>
                      <p className="mt-1.5 text-sm text-[var(--clinical-ink-soft)]">{e.summary}</p>
                    </div>
                  ); })}
                </div>
              )}
            </ClinicalCard>

            {/* Weight Entries */}
            <ClinicalCard className="p-4 sm:p-5">
              <p className="flex items-center gap-2 font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}><Scale className="h-5 w-5 text-[var(--clinical-panel)]" /> Weight Entries</p>
              <p className="mt-0.5 text-sm text-[var(--clinical-muted)]">Weight checks recorded in this period</p>
              {weightLogs.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--clinical-muted)]">No weight entries in this period.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {weightLogs.map((l) => (
                    <div key={l.id} className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface-2)" }}>
                      <div className="flex items-center gap-4">
                        <span className="text-sm tabular-nums text-[var(--clinical-muted)]">{dayKey(l.date)}</span>
                        <span className="text-base font-bold text-[var(--clinical-ink)]">{kg(l.weightKg!)} kg</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="rounded-full border px-2 py-0.5 text-[11px] font-semibold text-[var(--clinical-ink-soft)]" style={{ borderColor: "var(--clinical-line-strong)" }}>{WEIGHT_BADGE[l.type] ?? l.type}</span>
                        {l.by && <span className="text-xs text-[var(--clinical-muted)]">— {l.by}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ClinicalCard>

            {/* Domain Completion Summary */}
            <ClinicalCard className="p-4 sm:p-5">
              <p className="font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>Domain Completion Summary</p>
              <p className="mt-0.5 text-sm text-[var(--clinical-muted)]">Percentage of days logged per domain in the selected period</p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                {GRID_DOMAINS.map((dom) => { const c = domainCompletion.find((x) => x.key === dom.key)!; const Icon = dom.icon; return (
                  <div key={dom.key} className="rounded-xl border p-4 text-center" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface-2)" }}>
                    <Icon className="mx-auto h-5 w-5 text-[var(--clinical-muted)]" />
                    <p className="mt-1 text-sm font-semibold text-[var(--clinical-ink-soft)]">{dom.label}</p>
                    <p className="mt-1 text-2xl font-bold text-[var(--clinical-green)]" style={{ fontFamily: SERIF }}>{c.pct}%</p>
                    <p className="mt-0.5 text-[11px] text-[var(--clinical-muted)]">{c.done}/{c.total} days</p>
                  </div>
                ); })}
              </div>
            </ClinicalCard>
          </div>
        )}
      </div>
    </ClinicalPage>
  );
}

function StatusIcon({ status }: { status: CellStatus }) {
  if (status === "logged") return <CheckCircle2 className="mx-auto h-4 w-4 text-[var(--clinical-green)]" />;
  if (status === "escalated") return <AlertTriangle className="mx-auto h-4 w-4 text-[var(--clinical-amber)]" />;
  return <span className="inline-block h-3.5 w-3.5 rounded-full border-2" style={{ borderColor: "var(--clinical-line-strong)" }} />;
}
