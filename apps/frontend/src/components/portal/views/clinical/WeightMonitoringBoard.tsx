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
import { Plus, Calendar, History, AlertTriangle, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Minus } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { adaptResident } from "@/lib/adapters";
import { useClinician, type ClinicianRole } from "./useClinician";
import { ClinicalPage, ClinicalHeader, ClinicalButton, ClinicalModal, StatCard, DataState, FieldLabel, controlClass, SERIF } from "./clinical-ui";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const WEIGHT_KEY = "weight_logs";
const s = (v: unknown) => (v == null ? "" : String(v));
const newId = () => globalThis.crypto?.randomUUID?.() ?? `w-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const iso = (d: Date) => d.toISOString().split("T")[0];
const startOfSunday = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; };
const addDays = (isoStr: string, n: number) => { const d = new Date(isoStr + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); };
const fmtSunday = (isoStr: string) => new Date(isoStr + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
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

  const thisSunday = iso(startOfSunday(new Date()));
  const todayIso = iso(new Date());
  const [weekOf, setWeekOf] = useState(thisSunday);
  const [view, setView] = useState<"schedule" | "history" | "concerns">("schedule");
  const [historyResId, setHistoryResId] = useState("");
  const [rec, setRec] = useState<{ resident: Row | null; type: EntryType } | null>(null);

  const weeklyLog = (residentId: string, week: string) => logs.find((l) => l.type === "weekly" && l.residentId === residentId && l.weekOf === week);
  const statusOf = (residentId: string, week: string): Status => {
    const l = weeklyLog(residentId, week);
    if (l?.unable) return "unable";
    if (l?.weightKg != null) return "completed";
    return week <= todayIso ? "overdue" : "due";
  };

  const rows = useMemo(() => residents.map((r: Row) => ({ r, status: statusOf(s(r.id), weekOf), log: weeklyLog(s(r.id), weekOf) })), [residents, logs, weekOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => rows.reduce((a, x) => { a[x.status]++; return a; }, { completed: 0, due: 0, overdue: 0, unable: 0 } as Record<Status, number>), [rows]);

  const persist = async (next: WeightLog[]) => { await upsertRecord("app-settings", WEIGHT_KEY, { key: WEIGHT_KEY, value: JSON.stringify(next) }); await refetch(); };

  const saveRecord = async (data: { residentId: string; type: EntryType; date: string; shift?: string; weightKg?: number; unit?: string; unable?: boolean; note?: string }) => {
    const now = new Date().toISOString();
    const weekKey = data.type === "weekly" ? iso(startOfSunday(new Date(data.date))) : undefined;
    // Weekly entries are unique per (resident, week); baseline/additional just append.
    const rest = data.type === "weekly" ? logs.filter((l) => !(l.type === "weekly" && l.residentId === data.residentId && l.weekOf === weekKey)) : logs;
    const record: WeightLog = { id: newId(), residentId: data.residentId, type: data.type, weekOf: weekKey, date: data.date, shift: data.shift, weightKg: data.weightKg, unit: data.unit, unable: data.unable, note: data.note, by: clinicianName, at: now };
    await persist([record, ...rest]);
    if (data.weightKg != null) fetch("/api/vitals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ residentId: data.residentId, type: "WEIGHT", value: String(data.weightKg), unit: "kg" }) }).catch(() => null);
    setRec(null);
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Weight recorded", showConfirmButton: false, timer: 1500 });
  };

  const [historyType, setHistoryType] = useState<EntryType>("weekly");
  const openRecord = (resident: Row | null, type: EntryType) => setRec({ resident, type });
  const contextType: EntryType = view === "history" ? historyType : "weekly";

  return (
    <ClinicalPage>
      <ClinicalHeader
        title="Weekly Weight Monitoring"
        subtitle="Sunday morning weight checks for all residents"
        right={<ClinicalButton variant="accent" onClick={() => openRecord(null, contextType)}><Plus className="h-4 w-4" /> Record Weight</ClinicalButton>}
      />

      <div className="mt-5 mb-5 inline-flex gap-1 rounded-xl p-1" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
        {([["schedule", "Sunday Schedule", Calendar], ["history", "Resident History", History], ["concerns", "Weight Concerns", AlertTriangle]] as const).map(([v, label, Icon]) => (
          <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${view === v ? "bg-[var(--clinical-surface)] text-[var(--clinical-ink)] shadow-sm" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}><Icon className="h-4 w-4" /> {label}</button>
        ))}
      </div>

      {view === "schedule" && (
        <>
          <div className="mb-5 flex items-center gap-2">
            <ClinicalButton variant="secondary" size="sm" onClick={() => setWeekOf((w) => addDays(w, -7))}><ChevronLeft className="h-4 w-4" /> Previous</ClinicalButton>
            <span className="px-3 py-2 text-sm font-semibold text-[var(--clinical-ink)]">Sunday {fmtSunday(weekOf)}</span>
            <ClinicalButton variant="secondary" size="sm" onClick={() => setWeekOf((w) => addDays(w, 7))} disabled={weekOf >= thisSunday}>Next <ChevronRight className="h-4 w-4" /></ClinicalButton>
          </div>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard value={counts.completed} label="Completed" accent="green" />
            <StatCard value={counts.due} label="Due" accent="teal" />
            <StatCard value={counts.overdue} label="Overdue" accent="coral" />
            <StatCard value={counts.unable} label="Unable" accent="amber" />
          </div>
          <DataState
            loading={loading && logs.length === 0 && residents.length === 0}
            error={error}
            empty={rows.length === 0}
            emptyTitle="No residents"
            emptyHint="Add residents to start weekly weight checks."
            onRetry={() => void refetch()}
            skeletonRows={4}
          >
            <div className="space-y-2">
              {rows.map(({ r, status, log }) => (
                <div key={s(r.id)} className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                  <div><p className="font-semibold text-[var(--clinical-ink)]">{s(r.name)}</p><p className="text-xs text-[var(--clinical-muted)]">Room {s(r.room)}</p></div>
                  <div className="flex items-center gap-2">
                    {status === "completed" && <StatusChip label={`${kg(log!.weightKg!)} kg`} accent="green" />}
                    {status === "unable" && <StatusChip label="Unable" accent="amber" />}
                    {status === "overdue" && <StatusChip label="Overdue" accent="coral" />}
                    {status === "due" && <StatusChip label="Due" accent="teal" />}
                    {status !== "completed" && <ClinicalButton variant="secondary" size="sm" onClick={() => openRecord(r, "weekly")}>Record</ClinicalButton>}
                    {status === "completed" && <ClinicalButton variant="ghost" size="sm" onClick={() => openRecord(r, "weekly")}>Edit</ClinicalButton>}
                  </div>
                </div>
              ))}
            </div>
          </DataState>
        </>
      )}

      {view === "history" && <HistoryView residents={residents} logs={logs} resId={historyResId} setResId={setHistoryResId} entryType={historyType} setEntryType={setHistoryType} onRecord={(t) => openRecord(residents.find((x: Row) => s(x.id) === historyResId) || null, t)} />}
      {view === "concerns" && <ConcernsView residents={residents} logs={logs} onViewHistory={(id) => { setHistoryResId(id); setView("history"); }} />}

      {rec && <RecordModal residents={residents} resident={rec.resident} type={rec.type} defaultDate={rec.type === "weekly" ? weekOf : todayIso} onClose={() => setRec(null)} onSave={saveRecord} />}
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
      // Rule 1 — weight loss in the last 30 days.
      const cutoff = new Date(new Date(latest.date).getTime() - 30 * 86_400_000);
      const baseline = [...asc].reverse().find((e) => new Date(e.date) <= cutoff) || asc[0];
      if (baseline && baseline !== latest && baseline.weightKg! > latest.weightKg!) {
        const loss = baseline.weightKg! - latest.weightKg!;
        warns.push(`Weight loss of ${loss.toFixed(1)} kg in the last 30 days (from ${Math.round(baseline.weightKg!)} kg to ${Math.round(latest.weightKg!)} kg).`);
      }
      // Rule 2 — three consecutive weight drops.
      if (asc.length >= 3) {
        const [a, b, c] = asc.slice(-3);
        if (a.weightKg! > b.weightKg! && b.weightKg! > c.weightKg!) warns.push(`3 consecutive weight drops: ${Math.round(a.weightKg!)} kg → ${Math.round(b.weightKg!)} kg → ${Math.round(c.weightKg!)} kg.`);
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
