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
import { Scale, Plus, X, Calendar, History, AlertTriangle, CheckCircle2, Clock, XCircle, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Minus } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { adaptResident } from "@/lib/adapters";
import { useClinician, type ClinicianRole } from "./useClinician";

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

export default function WeightMonitoringBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName } = useClinician(clinicianRole);
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const { data: settingRows, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

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
    <div className="min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 flex items-center gap-2"><Scale className="w-6 h-6 text-blue-500" /> Weekly Weight Monitoring</h1>
          <p className="text-sm text-slate-500 mt-1">Sunday morning weight checks for all residents</p>
        </div>
        <button onClick={() => openRecord(null, contextType)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"><Plus className="w-4 h-4" /> Record Weight</button>
      </div>

      <div className="inline-flex gap-1 bg-slate-100 rounded-xl p-1 mb-5">
        {([["schedule", "Sunday Schedule", Calendar], ["history", "Resident History", History], ["concerns", "Weight Concerns", AlertTriangle]] as const).map(([v, label, Icon]) => (
          <button key={v} onClick={() => setView(v)} className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium ${view === v ? "bg-white shadow-sm text-slate-800" : "text-slate-500"}`}><Icon className="w-4 h-4" /> {label}</button>
        ))}
      </div>

      {view === "schedule" && (
        <>
          <div className="flex items-center gap-2 mb-5">
            <button onClick={() => setWeekOf((w) => addDays(w, -7))} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-600 hover:bg-slate-50"><ChevronLeft className="w-4 h-4" /> Previous</button>
            <span className="px-3 py-2 text-sm font-semibold text-slate-700">Sunday {fmtSunday(weekOf)}</span>
            <button onClick={() => setWeekOf((w) => addDays(w, 7))} disabled={weekOf >= thisSunday} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">Next <ChevronRight className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <StatCard icon={CheckCircle2} label="Completed" value={counts.completed} tone="#16a34a" bg="bg-green-50 border-green-200" />
            <StatCard icon={Clock} label="Due" value={counts.due} tone="#2563eb" bg="bg-blue-50 border-blue-200" />
            <StatCard icon={XCircle} label="Overdue" value={counts.overdue} tone="#dc2626" bg="bg-red-50 border-red-200" />
            <StatCard icon={AlertTriangle} label="Unable" value={counts.unable} tone="#ca8a04" bg="bg-yellow-50 border-yellow-200" />
          </div>
          <div className="space-y-2">
            {rows.map(({ r, status, log }) => {
              const tint = status === "completed" ? "bg-green-50/60 border-green-100" : status === "overdue" ? "bg-red-50/50 border-red-100" : status === "unable" ? "bg-yellow-50/50 border-yellow-100" : "bg-blue-50/40 border-blue-100";
              return (
                <div key={s(r.id)} className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${tint}`}>
                  <div><p className="font-bold text-slate-900">{s(r.name)}</p><p className="text-xs text-slate-500">Room {s(r.room)}</p></div>
                  <div className="flex items-center gap-2">
                    {status === "completed" && <span className="text-sm font-bold text-white bg-green-600 px-2.5 py-1 rounded-lg">{kg(log!.weightKg!)} kg</span>}
                    {status === "unable" && <span className="text-xs font-bold text-white bg-yellow-500 px-2.5 py-1 rounded-lg">Unable</span>}
                    {status === "overdue" && <span className="text-xs font-bold text-white bg-red-600 px-2.5 py-1 rounded-lg">Overdue</span>}
                    {status === "due" && <span className="text-xs font-bold text-white bg-blue-600 px-2.5 py-1 rounded-lg">Due</span>}
                    {status !== "completed" && <button onClick={() => openRecord(r, "weekly")} className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50">Record</button>}
                    {status === "completed" && <button onClick={() => openRecord(r, "weekly")} className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:bg-white">Edit</button>}
                  </div>
                </div>
              );
            })}
            {rows.length === 0 && <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-400">No residents.</div>}
          </div>
        </>
      )}

      {view === "history" && <HistoryView residents={residents} logs={logs} resId={historyResId} setResId={setHistoryResId} entryType={historyType} setEntryType={setHistoryType} onRecord={(t) => openRecord(residents.find((x: Row) => s(x.id) === historyResId) || null, t)} />}
      {view === "concerns" && <ConcernsView residents={residents} logs={logs} onViewHistory={(id) => { setHistoryResId(id); setView("history"); }} />}

      {rec && <RecordModal residents={residents} resident={rec.resident} type={rec.type} defaultDate={rec.type === "weekly" ? weekOf : todayIso} onClose={() => setRec(null)} onSave={saveRecord} />}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone, bg }: { icon: typeof CheckCircle2; label: string; value: number; tone: string; bg: string }) {
  return <div className={`rounded-2xl border p-5 text-center ${bg}`}><Icon className="w-6 h-6 mx-auto mb-2" style={{ color: tone }} /><p className="text-3xl font-bold" style={{ color: tone }}>{value}</p><p className="text-sm mt-1" style={{ color: tone }}>{label}</p></div>;
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
      <div><p className="text-sm font-semibold text-slate-700 mb-1">Select Resident</p>
        <select value={resId} onChange={(e) => setResId(e.target.value)} className="w-full max-w-sm px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40">
          <option value="">Select a resident…</option>
          {residents.map((r) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Room {s(r.room)}</option>)}
        </select>
      </div>

      {!resId ? <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-400">Choose a resident to see their weight history.</div> : (<>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-400">Baseline Weight</p><p className="text-2xl font-bold text-slate-800 mt-1">{baseline?.weightKg != null ? `${kg(baseline.weightKg)} kg` : "—"}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-400">Latest Weight</p><p className="text-2xl font-bold text-slate-800 mt-1">{latest?.weightKg != null ? `${kg(latest.weightKg)} kg` : "—"}</p>{latest && <p className="text-xs text-slate-400 mt-1">{fmtDate(latest.date)}</p>}</div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-400">Trend</p>{trend == null ? <p className="text-2xl font-bold text-slate-800 mt-1">—</p> : <p className={`text-2xl font-bold mt-1 inline-flex items-center gap-1 ${trend > 0 ? "text-red-600" : trend < 0 ? "text-blue-600" : "text-slate-500"}`}>{trend > 0 ? <TrendingUp className="w-5 h-5" /> : trend < 0 ? <TrendingDown className="w-5 h-5" /> : <Minus className="w-5 h-5" />}{trend > 0 ? "+" : ""}{trend.toFixed(1)} kg</p>}</div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex gap-1.5">
            {(["weekly", "baseline", "additional"] as EntryType[]).map((t) => (
              <button key={t} onClick={() => setEntryType(t)} className={`px-3.5 py-2 rounded-lg text-sm font-semibold border ${entryType === t ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>{TYPE_LABEL[t]}</button>
            ))}
          </div>
          <button onClick={() => onRecord(entryType)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"><Plus className="w-4 h-4" /> Record {TYPE_LABEL[entryType]}</button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-400 border-b border-slate-100">
              <th className="font-semibold px-4 py-2.5">Date</th><th className="font-semibold px-4 py-2.5">Weight</th><th className="font-semibold px-4 py-2.5">Type</th><th className="font-semibold px-4 py-2.5">Logged By</th><th className="font-semibold px-4 py-2.5">Notes</th>
            </tr></thead>
            <tbody>
              {table.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No {TYPE_LABEL[entryType].toLowerCase()} entries.</td></tr>
                : table.map((l) => (
                  <tr key={l.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2.5 text-slate-700">{fmtDate(l.date)}</td>
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{l.unable ? "Unable" : l.weightKg != null ? `${kg(l.weightKg)} kg` : "—"}</td>
                    <td className="px-4 py-2.5"><span className="text-xs font-medium px-2 py-0.5 rounded-full border border-slate-200 text-slate-600">{TYPE_BADGE[l.type]}</span></td>
                    <td className="px-4 py-2.5 text-slate-600">{s(l.by) || "—"}</td>
                    <td className="px-4 py-2.5 text-slate-500">{s(l.note) || "—"}</td>
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
      <p className="text-sm font-semibold text-slate-700 mb-2">Weight Trend (last entries)</p>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 400 }} preserveAspectRatio="none">
          <path d={d} fill="none" stroke="#3b82f6" strokeWidth={2} />
          {vals.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill="#3b82f6" />)}
        </svg>
        <div className="flex justify-between mt-1">{points.map((p, i) => <span key={i} className="text-[10px] text-slate-400">{new Date(p.date).toLocaleDateString(undefined, { month: "2-digit", day: "2-digit" })}</span>)}</div>
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
      <p className="text-sm text-slate-500">Residents with weight-loss concerns based on pilot alert rules.</p>
      {concerns.length === 0 ? <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-400">No weight concerns right now.</div>
        : concerns.map((c) => { const r = nameOf(c.id); return (
          <div key={c.id} className="rounded-2xl border border-red-100 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div><p className="font-bold text-slate-900">{s(r?.name) || "Resident"}</p><p className="text-xs text-slate-500">Room {s(r?.room)}</p></div>
              <button onClick={() => onViewHistory(c.id)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">View History <ChevronRight className="w-4 h-4" /></button>
            </div>
            <div className="mt-3 space-y-1.5">
              {c.warns.map((w, i) => <div key={i} className="flex items-start gap-2"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0 mt-0.5">warning</span><span className="text-sm text-slate-700">{w}</span></div>)}
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
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900 text-lg">Record {MODAL_TITLE[type]}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div><p className="text-sm font-bold text-slate-700 mb-1.5">Resident <span className="text-red-500">*</span></p>
            <select value={resId} onChange={(e) => setResId(e.target.value)} disabled={!!resident} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40 disabled:bg-slate-50">
              <option value="">Select…</option>{residents.map((r) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Room {s(r.room)}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-sm font-bold text-slate-700 mb-1.5">Date <span className="text-red-500">*</span></p><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-400/40" /></div>
            <div><p className="text-sm font-bold text-slate-700 mb-1.5">Time</p><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-400/40" /></div>
          </div>
          <div><p className="text-sm font-bold text-slate-700 mb-1.5">Shift</p><select value={shift} onChange={(e) => setShift(e.target.value)} className="w-full max-w-[160px] px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40">{SHIFTS.map((sh) => <option key={sh} value={sh}>{sh}</option>)}</select></div>

          <button type="button" onClick={() => setUnable((u) => !u)} className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border text-left ${unable ? "border-yellow-300 bg-yellow-50" : "border-slate-200"}`}>
            <span className={`w-5 h-5 rounded border flex items-center justify-center ${unable ? "bg-yellow-500 border-yellow-500 text-white" : "border-slate-300"}`}>{unable && "✓"}</span>
            <span><span className="block text-sm font-semibold text-slate-800">Unable to weigh</span><span className="block text-xs text-slate-500">Resident cannot be weighed at this time</span></span>
          </button>

          {!unable && (
            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <div><p className="text-sm font-bold text-slate-700 mb-1.5">Weight <span className="text-red-500">*</span></p><input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="e.g., 58.5" className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-400/40" /></div>
              <div><p className="text-sm font-bold text-slate-700 mb-1.5">Unit</p><select value={unit} onChange={(e) => setUnit(e.target.value as "kg" | "lb")} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40"><option value="kg">kg</option><option value="lb">lb</option></select></div>
            </div>
          )}

          <div><p className="text-sm font-bold text-slate-700 mb-1.5">Notes</p><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional observations…" className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-400/40" /></div>

          <button onClick={submit} disabled={saving} className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60">{saving ? "Saving…" : "Save Weight Entry"}</button>
        </div>
      </div>
    </div>
  );
}
