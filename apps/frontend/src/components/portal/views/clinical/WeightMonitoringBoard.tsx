"use client";

/**
 * Weekly Weight Monitoring — Sunday-morning weight checks for all residents.
 * Views: Sunday Schedule (per-week completed/due/overdue/unable), Resident
 * History (baseline/latest/trend cards + Weekly/Baseline/Additional-Check entries
 * + sparkline), and Weight Concerns (pilot loss-alert rules). One shared Record
 * modal serves all three entry types. Migration-free: weight logs are a JSON array
 * in the app-setting `weight_logs`; a recorded weight also mirrors into VitalsLog.
 */

import { useMemo, useState } from "react";
import { Plus, Calendar, History, AlertTriangle, ChevronRight, TrendingUp, TrendingDown, Minus, Scale, Check, Clock } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { adaptResident } from "@/lib/adapters";
import { useClinician, type ClinicianRole } from "./useClinician";
import { ClinicalPage, ClinicalHeader, ClinicalButton, ClinicalModal, DataState, FieldLabel, SearchInput, controlClass, SERIF } from "./clinical-ui";
import { CLINICAL_ALERT_RULES } from "@/lib/lifecare/clinicalAlerts";

// Initials from a resident name for the row avatar.

// Light KPI card — big colored number over an uppercase label; the "alert"
// variant (Overdue) gets a red top rule + a faint warning glyph, per the design.
// Light status chip — colored dot + label on a soft color-tinted pill.
function WtChip({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `${color}14`, color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />{label}
    </span>
  );
}

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const WEIGHT_KEY = "weight_logs";
const s = (v: unknown) => (v == null ? "" : String(v));
const newId = () => globalThis.crypto?.randomUUID?.() ?? `w-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Weight checks are a ROLLING 7-day cadence anchored per-resident to their last
// logged date — log on a Thursday and the next check is due the following Thursday.
// Runs on Philippine (Asia/Manila) time for ALL users, so "today" and the cadence
// are identical regardless of the viewer's / server's timezone. Calendar dates are
// carried as YYYY-MM-DD strings, arithmetic done on UTC-midnight Dates (unambiguous
// carriers); only "today" is resolved through Manila.
const WEIGHT_INTERVAL_DAYS = 7;
const MANILA_TZ = "Asia/Manila";
// Today's Manila calendar date as YYYY-MM-DD (en-CA formats ISO-style).
const todayManila = () => new Intl.DateTimeFormat("en-CA", { timeZone: MANILA_TZ }).format(new Date());
// Robust to legacy values: some older logs stored `date` as a full ISO datetime,
// not YYYY-MM-DD. Take the leading date part; fall back to Date parsing for other
// shapes. iso() never throws — an unparseable date yields "".
const dParse = (dateStr: string) => {
  const head = String(dateStr ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return new Date(head + "T00:00:00Z");
  return new Date(String(dateStr ?? ""));
};
const iso = (d: Date) => (Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10));
const addDays = (isoStr: string, n: number) => { const d = dParse(isoStr); if (Number.isNaN(d.getTime())) return ""; d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const daysBetween = (a: string, b: string) => Math.round((dParse(b).getTime() - dParse(a).getTime()) / 86_400_000);
const fmtDay = (isoStr: string) => dParse(isoStr).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const fmtDate = (isoStr: string) => new Date(isoStr).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const kg = (w: number) => (Number.isInteger(w) ? String(w) : w.toFixed(1));

type EntryType = "weekly" | "baseline" | "additional";
const TYPE_LABEL: Record<EntryType, string> = { weekly: "Weekly Weight", baseline: "Baseline Weight", additional: "Additional Check" };
const MODAL_TITLE: Record<EntryType, string> = { weekly: "Sunday Weight", baseline: "Baseline Weight", additional: "Additional Check" };
const TYPE_BADGE: Record<EntryType, string> = { weekly: "Weekly", baseline: "Baseline", additional: "Additional" };
const SHIFTS = ["Morning", "Afternoon", "Night"];

interface WeightLog { id: string; residentId: string; type: EntryType; weekOf?: string; date: string; weightKg?: number; unit?: string; shift?: string; unable?: boolean; note?: string; by?: string; at: string; }
const parseLogs = (raw: string | null | undefined): WeightLog[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((l) => l && typeof l.id === "string") : []; } catch { return []; } };

type Status = "completed" | "due" | "overdue" | "unable";

const ACCENT_VAR: Record<"green" | "teal" | "coral" | "amber", string> = { green: "var(--clinical-green)", teal: "var(--clinical-panel)", coral: "var(--clinical-coral)", amber: "var(--clinical-amber)" };

// Theme-safe status chip: ink label + a coloured dot (no per-theme contrast traps).
function StatusChip({ label, accent }: { label: string; accent: "green" | "teal" | "coral" | "amber" }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold text-[var(--clinical-ink)]" style={{ borderColor: "var(--clinical-line-strong)" }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ACCENT_VAR[accent] }} />{label}
    </span>
  );
}

export default function WeightMonitoringBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName } = useClinician(clinicianRole);
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const { data: settingRows, loading, error, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const logs = useMemo(() => parseLogs(settingRows.find((r) => (r.key || r.id) === WEIGHT_KEY)?.value), [settingRows]);

  const todayIso = todayManila();
  const [view, setView] = useState<"schedule" | "history" | "concerns">("schedule");
  const [historyResId, setHistoryResId] = useState("");
  const [rec, setRec] = useState<{ resident: Row | null; type: EntryType } | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "action" | "completed">("all");

  // Latest weekly weigh-in for a resident (newest date first).
  const latestWeekly = (residentId: string) => logs.filter((l) => l.type === "weekly" && l.residentId === residentId && l.date).sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0] || null;
  // Rolling cadence: the next check is due 7 days after the last logged date. Never
  // logged → due now. `unable` still counts as an event (resets the 7-day clock).
  const evalResident = (residentId: string): { status: Status; log: WeightLog | null; nextDue: string } => {
    const l = latestWeekly(residentId);
    if (!l) return { status: "due", log: null, nextDue: todayIso };
    const nextDue = addDays(l.date, WEIGHT_INTERVAL_DAYS);
    if (!nextDue) return { status: "due", log: l, nextDue: todayIso }; // unparseable date → treat as due
    if (nextDue > todayIso) return { status: l.unable ? "unable" : "completed", log: l, nextDue };
    return { status: nextDue < todayIso ? "overdue" : "due", log: l, nextDue };
  };

  const rows = useMemo(() => residents.map((r: Row) => ({ r, ...evalResident(s(r.id)) })), [residents, logs]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => rows.reduce((a, x) => { a[x.status]++; return a; }, { completed: 0, due: 0, overdue: 0, unable: 0 } as Record<Status, number>), [rows]);
  const coverage = rows.length ? Math.round((counts.completed / rows.length) * 100) : 0;
  const attentionCount = counts.due + counts.overdue + counts.unable;
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter(({ r, status }) => {
      const matchesSearch = !query || s(r.name).toLowerCase().includes(query) || s(r.room).toLowerCase().includes(query);
      const matchesStatus = statusFilter === "all" || (statusFilter === "completed" ? status === "completed" : status !== "completed");
      return matchesSearch && matchesStatus;
    });
  }, [rows, search, statusFilter]);

  const persist = async (next: WeightLog[]) => { await upsertRecord("app-settings", WEIGHT_KEY, { key: WEIGHT_KEY, value: JSON.stringify(next) }); await refetch(); };

  const saveRecord = async (data: { residentId: string; type: EntryType; date: string; shift?: string; weightKg?: number; unit?: string; unable?: boolean; note?: string }) => {
    const now = new Date().toISOString();
    // Weekly entries are unique per (resident, date) — re-logging the same day
    // replaces; the 7-day cadence is derived from this date. Baseline/additional append.
    const rest = data.type === "weekly" ? logs.filter((l) => !(l.type === "weekly" && l.residentId === data.residentId && l.date === data.date)) : logs;
    const record: WeightLog = { id: newId(), residentId: data.residentId, type: data.type, weekOf: data.date, date: data.date, shift: data.shift, weightKg: data.weightKg, unit: data.unit, unable: data.unable, note: data.note, by: clinicianName, at: now };
    await persist([record, ...rest]);
    if (data.weightKg != null) fetch("/api/vitals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ residentId: data.residentId, type: "WEIGHT", value: String(data.weightKg), unit: "kg" }) }).catch(() => null);
    setRec(null);
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Weight recorded", showConfirmButton: false, timer: 1500 });
  };

  const [historyType, setHistoryType] = useState<EntryType>("weekly");
  const openRecord = (resident: Row | null, type: EntryType) => setRec({ resident, type });
  const contextType: EntryType = view === "history" ? historyType : "weekly";

  return (
    <ClinicalPage className="@container">
      <ClinicalHeader
        title="Weight Tracking"
        subtitle="Manage rolling weekly checks, review resident trends, and identify weight changes that need follow-up."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold text-[var(--clinical-ink-soft)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}><Calendar className="h-4 w-4 text-[var(--clinical-panel)]" /> Today · {fmtDay(todayIso)}</span>
            <ClinicalButton onClick={() => openRecord(null, contextType)}><Plus className="h-4 w-4" /> Record Weight</ClinicalButton>
          </div>
        }
      />
      <div className="hidden">
        <div className="min-w-0">
          <p className="text-sm text-slate-500">Rolling weekly checks — each resident is due 7 days after their last weigh-in (Manila time)</p>
        </div>
        <button onClick={() => openRecord(null, contextType)} className="inline-flex items-center gap-2 rounded-lg bg-[#4F46E5] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#4338CA] active:scale-95"><Plus className="h-4 w-4" /> Record Weight</button>
      </div>

      {view === "schedule" && (
        <section className="clinical-summary-band mt-6 overflow-hidden rounded-2xl bg-[var(--clinical-panel)] text-white">
          <div className="grid gap-px bg-white/15 sm:grid-cols-[1.35fr_repeat(3,1fr)]">
            <div className="bg-[var(--clinical-panel)] p-5 sm:p-6">
              <div className="flex items-center justify-between gap-4">
                <div><p className="text-sm font-semibold text-blue-100">Weekly weight coverage</p><p className="mt-1 text-3xl font-bold tracking-[-0.03em]">{coverage}%</p></div>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15"><Scale className="h-6 w-6" /></div>
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-black/20" aria-label={`${counts.completed} of ${rows.length} residents completed`}><div className="h-full rounded-full bg-white transition-[width] duration-500" style={{ width: `${coverage}%` }} /></div>
              <p className="mt-2 text-xs text-blue-100">{counts.completed} of {rows.length} residents are current this week</p>
            </div>
            <div className="bg-[var(--clinical-panel)] p-5"><p className="text-xs font-semibold text-blue-100">Completed</p><p className="mt-2 text-2xl font-bold tabular-nums">{counts.completed}</p></div>
            <div className="bg-[var(--clinical-panel)] p-5"><p className="text-xs font-semibold text-blue-100">Due now</p><p className="mt-2 text-2xl font-bold tabular-nums">{counts.due}</p></div>
            <div className="bg-[var(--clinical-panel)] p-5"><p className="text-xs font-semibold text-blue-100">Needs attention</p><p className="mt-2 text-2xl font-bold tabular-nums">{attentionCount}</p><p className="mt-1 text-xs text-blue-100">{counts.overdue} overdue · {counts.unable} unable</p></div>
          </div>
        </section>
      )}

      <div className="my-5 grid gap-3 rounded-2xl border p-3 lg:grid-cols-2 xl:grid-cols-[minmax(280px,1fr)_auto_auto] xl:items-center" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
        {view === "schedule" ? <SearchInput value={search} onChange={setSearch} placeholder="Search resident or room..." className="min-w-0 lg:col-span-2 xl:col-span-1" /> : <div className="min-w-0 text-sm text-[var(--clinical-muted)] lg:col-span-2 xl:col-span-1">{view === "history" ? "Review a resident's recorded weight history and trend." : "Review residents whose weight changes may require follow-up."}</div>}
        <div role="tablist" aria-label="Weight tracking view" className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--clinical-surface-2)] p-1">
          {([["schedule", "Weekly Schedule", Calendar], ["history", "Resident History", History], ["concerns", "Weight Concerns", AlertTriangle]] as const).map(([v, label, Icon]) => (
            <button key={v} role="tab" onClick={() => setView(v)} aria-selected={view === v} className={`inline-flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition ${view === v ? "bg-[var(--clinical-surface-raised,var(--clinical-surface))] text-[var(--clinical-ink)] shadow-sm" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}><Icon className="h-4 w-4" /> <span className="hidden sm:inline">{label}</span><span className="sm:hidden">{v === "schedule" ? "Schedule" : v === "history" ? "History" : "Concerns"}</span></button>
          ))}
        </div>
        {view === "schedule" && (
          <div role="tablist" aria-label="Weight schedule status" className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--clinical-surface-2)] p-1">
            {([["all", "All", rows.length], ["action", "Needs action", attentionCount], ["completed", "Completed", counts.completed]] as const).map(([value, label, count]) => (
              <button key={value} role="tab" aria-selected={statusFilter === value} onClick={() => setStatusFilter(value)} className={`min-h-10 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition ${statusFilter === value ? "bg-[var(--clinical-surface-raised,var(--clinical-surface))] text-[var(--clinical-ink)] shadow-sm" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}>{label} <span className="ml-1 tabular-nums opacity-70">{count}</span></button>
            ))}
          </div>
        )}
        {false && view === "schedule" && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600"><Calendar className="h-4 w-4 text-slate-400" /> Today · {fmtDay(todayIso)}</span>
        )}
      </div>

      {view === "schedule" && (
        <>
          <div className="hidden">
            {([["all", "All residents", rows.length], ["action", "Needs action", attentionCount], ["completed", "Completed", counts.completed]] as const).map(([value, label, count]) => (
              <button key={value} role="tab" aria-selected={statusFilter === value} onClick={() => setStatusFilter(value)} className={`min-h-10 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition ${statusFilter === value ? "bg-[var(--clinical-surface-raised,var(--clinical-surface))] text-[var(--clinical-ink)] shadow-sm" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}>{label} <span className="ml-1 tabular-nums opacity-70">{count}</span></button>
            ))}
          </div>
          <DataState
            loading={loading && logs.length === 0 && residents.length === 0}
            error={error}
            empty={filteredRows.length === 0}
            emptyTitle={rows.length === 0 ? "No active residents" : "No residents match"}
            emptyHint={rows.length === 0 ? "Residents appear here once they are admitted." : "Try a different search or status filter."}
            onRetry={() => void refetch()}
            skeletonRows={4}
          >
            <div className="space-y-2.5">
              {filteredRows.map(({ r, status, log, nextDue }) => (
                <div key={s(r.id)} className="grid items-center gap-4 rounded-2xl border p-4 transition hover:border-[var(--clinical-line-strong)] sm:grid-cols-[minmax(190px,1.15fr)_minmax(180px,1fr)_auto] sm:p-5" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-[var(--clinical-surface-2)] leading-none"><span className="text-[9px] font-semibold uppercase tracking-wide text-[var(--clinical-muted)]">Room</span><span className="mt-1 text-base font-bold text-[var(--clinical-ink)]">{s(r.room)}</span></span>
                    <div className="min-w-0"><p className="truncate font-bold text-[var(--clinical-ink)]">{s(r.name)}</p><p className={`mt-1 inline-flex items-center gap-1.5 text-xs font-semibold ${status === "completed" ? "text-[var(--clinical-green)]" : status === "overdue" ? "text-[var(--clinical-coral)]" : "text-[var(--clinical-amber)]"}`}>{status === "completed" ? <Check className="h-3.5 w-3.5" /> : status === "overdue" ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}{status === "completed" ? "Weight current" : status === "overdue" ? "Weigh-in overdue" : status === "unable" ? "Unable to weigh" : "Weigh-in due"}</p></div>
                  </div>
                  <div className="min-w-0 sm:text-right">
                    <div>
                      {status === "completed" && <WtChip label={`${kg(log!.weightKg!)} kg`} color="#16A34A" />}
                      {status === "unable" && <WtChip label="Unable" color="#D97706" />}
                      {status === "overdue" && <WtChip label={`Overdue ${daysBetween(nextDue, todayIso)}d`} color="#DC2626" />}
                      {status === "due" && <WtChip label={log ? "Due today" : "Never weighed"} color="#4F46E5" />}
                      <p className="mt-1 text-xs text-[var(--clinical-muted)]">{status === "completed" || status === "unable" ? `Next check ${fmtDay(nextDue)}` : log ? `Last recorded ${fmtDay(log.date)}` : "No weigh-in on record"}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end">
                    <ClinicalButton className="w-full sm:w-auto" variant={status === "completed" ? "secondary" : "primary"} size="sm" onClick={() => openRecord(r, "weekly")}>{status === "completed" ? "Edit weight" : <><Plus className="h-4 w-4" /> Record</>}</ClinicalButton>
                  </div>
                </div>
              ))}
            </div>
          </DataState>
        </>
      )}

      {view === "history" && <HistoryView residents={residents} logs={logs} resId={historyResId} setResId={setHistoryResId} entryType={historyType} setEntryType={setHistoryType} onRecord={(t) => openRecord(residents.find((x: Row) => s(x.id) === historyResId) || null, t)} />}
      {view === "concerns" && <ConcernsView residents={residents} logs={logs} onViewHistory={(id) => { setHistoryResId(id); setView("history"); }} />}

      {rec && <RecordModal residents={residents} resident={rec.resident} type={rec.type} defaultDate={todayIso} onClose={() => setRec(null)} onSave={saveRecord} />}
    </ClinicalPage>
  );
}

// ── Resident History (Image 20) ──────────────────────────────────────────────
function HistoryView({ residents, logs, resId, setResId, entryType, setEntryType, onRecord }: {
  residents: Row[]; logs: WeightLog[]; resId: string; setResId: (v: string) => void; entryType: EntryType; setEntryType: (t: EntryType) => void; onRecord: (t: EntryType) => void;
}) {
  const all = useMemo(() => logs.filter((l) => l.residentId === resId).sort((a, b) => b.date.localeCompare(a.date)), [logs, resId]);
  const withWeight = all.filter((l) => l.weightKg != null);
  const baseline = withWeight.find((l) => l.type === "baseline");
  const latest = withWeight[0];
  const weeklyAsc = [...withWeight].filter((l) => l.type === "weekly").sort((a, b) => a.date.localeCompare(b.date));
  const trend = weeklyAsc.length >= 2 ? weeklyAsc[weeklyAsc.length - 1].weightKg! - weeklyAsc[weeklyAsc.length - 2].weightKg! : null;
  const table = all.filter((l) => l.type === entryType);

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel htmlFor="wt-hist-res">Select Resident</FieldLabel>
        <select id="wt-hist-res" value={resId} onChange={(e) => setResId(e.target.value)} className={`${controlClass} max-w-sm`}>
          <option value="">Select a resident…</option>
          {residents.map((r) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Room {s(r.room)}</option>)}
        </select>
      </div>

      {!resId ? <div className="rounded-xl border p-8 text-center text-sm text-[var(--clinical-muted)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>Choose a resident to see their weight history.</div> : (<>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--clinical-muted)]">Baseline Weight</p><p className="mt-1 text-2xl font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>{baseline?.weightKg != null ? `${kg(baseline.weightKg)} kg` : "—"}</p></div>
          <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--clinical-muted)]">Latest Weight</p><p className="mt-1 text-2xl font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>{latest?.weightKg != null ? `${kg(latest.weightKg)} kg` : "—"}</p>{latest && <p className="mt-1 text-xs text-[var(--clinical-muted)]">{fmtDate(latest.date)}</p>}</div>
          <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--clinical-muted)]">Trend</p>{trend == null ? <p className="mt-1 text-2xl font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>—</p> : <p className="mt-1 inline-flex items-center gap-1 text-2xl font-bold" style={{ fontFamily: SERIF, color: trend > 0 ? "var(--clinical-coral)" : trend < 0 ? "var(--clinical-panel)" : "var(--clinical-muted)" }}>{trend > 0 ? <TrendingUp className="h-5 w-5" /> : trend < 0 ? <TrendingDown className="h-5 w-5" /> : <Minus className="h-5 w-5" />}{trend > 0 ? "+" : ""}{trend.toFixed(1)} kg</p>}</div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex gap-1.5">
            {(["weekly", "baseline", "additional"] as EntryType[]).map((t) => (
              <ClinicalButton key={t} variant={entryType === t ? "primary" : "secondary"} size="sm" onClick={() => setEntryType(t)}>{TYPE_LABEL[t]}</ClinicalButton>
            ))}
          </div>
          <ClinicalButton variant="secondary" size="sm" onClick={() => onRecord(entryType)}><Plus className="h-4 w-4" /> Record {TYPE_LABEL[entryType]}</ClinicalButton>
        </div>

        <div className="overflow-x-auto rounded-xl border" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line)" }}>
              <th className="px-4 py-2.5 font-semibold">Date</th><th className="px-4 py-2.5 font-semibold">Weight</th><th className="px-4 py-2.5 font-semibold">Type</th><th className="px-4 py-2.5 font-semibold">Logged By</th><th className="px-4 py-2.5 font-semibold">Notes</th>
            </tr></thead>
            <tbody>
              {table.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--clinical-muted)]">No {TYPE_LABEL[entryType].toLowerCase()} entries.</td></tr>
                : table.map((l) => (
                  <tr key={l.id} className="border-b last:border-0" style={{ borderColor: "var(--clinical-line)" }}>
                    <td className="px-4 py-2.5 text-[var(--clinical-ink-soft)]">{fmtDate(l.date)}</td>
                    <td className="px-4 py-2.5 font-semibold text-[var(--clinical-ink)]">{l.unable ? "Unable" : l.weightKg != null ? `${kg(l.weightKg)} kg` : "—"}</td>
                    <td className="px-4 py-2.5"><span className="rounded-full border px-2 py-0.5 text-xs font-medium text-[var(--clinical-ink-soft)]" style={{ borderColor: "var(--clinical-line-strong)" }}>{TYPE_BADGE[l.type]}</span></td>
                    <td className="px-4 py-2.5 text-[var(--clinical-ink-soft)]">{s(l.by) || "—"}</td>
                    <td className="px-4 py-2.5 text-[var(--clinical-muted)]">{s(l.note) || "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {weeklyAsc.length >= 2 && <Sparkline points={weeklyAsc.slice(-12)} />}
      </>)}
    </div>
  );
}

function Sparkline({ points }: { points: WeightLog[] }) {
  const vals = points.map((p) => p.weightKg!);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const W = 600, H = 70, pad = 6;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - pad - ((v - min) / span) * (H - 2 * pad);
  const d = vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-[var(--clinical-ink)]">Weight Trend (last entries)</p>
      <div className="overflow-x-auto rounded-xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 400 }} preserveAspectRatio="none">
          <path d={d} fill="none" stroke="#3b82f6" strokeWidth={2} />
          {vals.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill="#3b82f6" />)}
        </svg>
        <div className="mt-1 flex justify-between">{points.map((p, i) => <span key={i} className="text-[10px] text-[var(--clinical-muted)]">{new Date(p.date).toLocaleDateString(undefined, { month: "2-digit", day: "2-digit" })}</span>)}</div>
      </div>
    </div>
  );
}

// ── Weight Concerns (Image 22) — pilot loss-alert rules ──────────────────────
function ConcernsView({ residents, logs, onViewHistory }: { residents: Row[]; logs: WeightLog[]; onViewHistory: (id: string) => void }) {
  const concerns = useMemo(() => {
    const byRes = new Map<string, WeightLog[]>();
    logs.filter((l) => l.weightKg != null).forEach((l) => { const a = byRes.get(l.residentId); if (a) a.push(l); else byRes.set(l.residentId, [l]); });
    const out: { id: string; warns: string[] }[] = [];
    byRes.forEach((list, id) => {
      const asc = list.sort((a, b) => a.date.localeCompare(b.date));
      const latest = asc[asc.length - 1];
      const warns: string[] = [];
      // Rule 1 — weight loss within the configured window (rule data).
      const windowDays = CLINICAL_ALERT_RULES.weight.lossWindowDays;
      const cutoff = new Date(new Date(latest.date).getTime() - windowDays * 86_400_000);
      const baseline = [...asc].reverse().find((e) => new Date(e.date) <= cutoff) || asc[0];
      if (baseline && baseline !== latest && baseline.weightKg! > latest.weightKg!) {
        const loss = baseline.weightKg! - latest.weightKg!;
        warns.push(`Weight loss of ${loss.toFixed(1)} kg in the last ${windowDays} days (from ${Math.round(baseline.weightKg!)} kg to ${Math.round(latest.weightKg!)} kg).`);
      }
      // Rule 2 — N consecutive weight drops (N from rule data).
      const n = CLINICAL_ALERT_RULES.weight.consecutiveDrops;
      if (asc.length >= n) {
        const tail = asc.slice(-n);
        let dropping = true;
        for (let i = 1; i < tail.length; i++) if (!(tail[i - 1].weightKg! > tail[i].weightKg!)) dropping = false;
        if (dropping) warns.push(`${n} consecutive weight drops: ${tail.map((t) => `${Math.round(t.weightKg!)} kg`).join(" → ")}.`);
      }
      if (warns.length) out.push({ id, warns });
    });
    return out;
  }, [logs]);

  const nameOf = (id: string) => residents.find((x) => s(x.id) === id);

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--clinical-muted)]">Residents with weight-loss concerns based on pilot alert rules.</p>
      {concerns.length === 0 ? <div className="rounded-xl border p-8 text-center text-sm text-[var(--clinical-muted)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>No weight concerns right now.</div>
        : concerns.map((c) => { const r = nameOf(c.id); return (
          <div key={c.id} className="rounded-xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)", borderTopWidth: 3, borderTopColor: "var(--clinical-coral)" }}>
            <div className="flex items-start justify-between gap-3">
              <div><p className="font-semibold text-[var(--clinical-ink)]">{s(r?.name) || "Resident"}</p><p className="text-xs text-[var(--clinical-muted)]">Room {s(r?.room)}</p></div>
              <ClinicalButton variant="secondary" size="sm" onClick={() => onViewHistory(c.id)}>View History <ChevronRight className="h-4 w-4" /></ClinicalButton>
            </div>
            <div className="mt-3 space-y-1.5">
              {c.warns.map((w, i) => <div key={i} className="flex items-start gap-2"><StatusChip label="Warning" accent="amber" /><span className="text-sm text-[var(--clinical-ink-soft)]">{w}</span></div>)}
            </div>
          </div>
        ); })}
    </div>
  );
}

// ── Record modal (Image 21) — shared across all entry types ──────────────────
function RecordModal({ residents, resident, type, defaultDate, onClose, onSave }: {
  residents: Row[]; resident: Row | null; type: EntryType; defaultDate: string;
  onClose: () => void; onSave: (d: { residentId: string; type: EntryType; date: string; shift?: string; weightKg?: number; unit?: string; unable?: boolean; note?: string }) => Promise<void>;
}) {
  const [resId, setResId] = useState(resident ? s(resident.id) : "");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("06:00");
  const [shift, setShift] = useState("Morning");
  const [unable, setUnable] = useState(false);
  const [weight, setWeight] = useState("");
  const [unit, setUnit] = useState<"kg" | "lb">("kg");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!resId) { Swal.fire({ title: "Select a resident", icon: "warning" }); return; }
    if (!unable && !weight.trim()) { Swal.fire({ title: "Enter a weight", text: "Enter the weight, or mark the resident as unable to weigh.", icon: "warning" }); return; }
    setSaving(true);
    try {
      const weightKg = unable ? undefined : (unit === "lb" ? Number(weight) * 0.453592 : Number(weight));
      await onSave({ residentId: resId, type, date: `${date}T${time || "06:00"}:00`, shift, weightKg: weightKg != null ? Math.round(weightKg * 10) / 10 : undefined, unit, unable, note: note || undefined });
    } finally { setSaving(false); }
  };

  return (
    <ClinicalModal
      open
      onClose={onClose}
      title={`Record ${MODAL_TITLE[type]}`}
      description="Log a resident weight entry"
      footer={<>
        <ClinicalButton variant="ghost" size="sm" onClick={onClose}>Cancel</ClinicalButton>
        <ClinicalButton variant="accent" onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save Weight Entry"}</ClinicalButton>
      </>}
    >
      <div className="space-y-4">
        <div>
          <FieldLabel required htmlFor="wt-res">Resident</FieldLabel>
          <select id="wt-res" value={resId} onChange={(e) => setResId(e.target.value)} disabled={!!resident} className={`${controlClass} disabled:opacity-60`}>
            <option value="">Select…</option>{residents.map((r) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Room {s(r.room)}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><FieldLabel required htmlFor="wt-date">Date</FieldLabel><input id="wt-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={controlClass} /></div>
          <div><FieldLabel htmlFor="wt-time">Time</FieldLabel><input id="wt-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className={controlClass} /></div>
        </div>
        <div><FieldLabel htmlFor="wt-shift">Shift</FieldLabel><select id="wt-shift" value={shift} onChange={(e) => setShift(e.target.value)} className={`${controlClass} max-w-[160px]`}>{SHIFTS.map((sh) => <option key={sh} value={sh}>{sh}</option>)}</select></div>

        <button type="button" onClick={() => setUnable((u) => !u)} aria-pressed={unable} className="flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition" style={{ borderColor: unable ? "var(--clinical-amber)" : "var(--clinical-line-strong)", backgroundColor: unable ? "var(--clinical-surface-2)" : "transparent" }}>
          <span className="flex h-5 w-5 items-center justify-center rounded border text-white" style={{ borderColor: unable ? "var(--clinical-amber)" : "var(--clinical-line-strong)", backgroundColor: unable ? "var(--clinical-amber)" : "transparent" }}>{unable && "✓"}</span>
          <span><span className="block text-sm font-semibold text-[var(--clinical-ink)]">Unable to weigh</span><span className="block text-xs text-[var(--clinical-muted)]">Resident cannot be weighed at this time</span></span>
        </button>

        {!unable && (
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <div><FieldLabel required htmlFor="wt-weight">Weight</FieldLabel><input id="wt-weight" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="e.g., 58.5" className={controlClass} /></div>
            <div><FieldLabel htmlFor="wt-unit">Unit</FieldLabel><select id="wt-unit" value={unit} onChange={(e) => setUnit(e.target.value as "kg" | "lb")} className={controlClass}><option value="kg">kg</option><option value="lb">lb</option></select></div>
          </div>
        )}

        <div><FieldLabel htmlFor="wt-note">Notes</FieldLabel><textarea id="wt-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional observations…" className={controlClass} /></div>
      </div>
    </ClinicalModal>
  );
}
