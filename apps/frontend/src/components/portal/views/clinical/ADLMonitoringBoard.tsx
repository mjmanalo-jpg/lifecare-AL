"use client";

/**
 * ADL Monitoring — track Activities of Daily Living per resident, shift, and
 * domain (matches the LifeCare screens). Ten domains, each logged per shift with
 * a Level of Assistance + Change-from-Baseline, safety flags, and staff notes.
 * Baselines are derived from the resident's latest pre-admission assessment
 * (Section D + mobility/continence/cognition). Migration-free: entries are a JSON
 * array in the app-setting `adl_logs`; an optional follow-up Task is created when
 * "Create Task" is checked.
 */

import { useMemo, useState } from "react";
import { X, TrendingUp, TrendingDown, Minus, AlertTriangle, Activity, CheckCircle2 } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord, createRecord } from "@/lib/api";
import { adaptResident } from "@/lib/adapters";
import { useClinician, type ClinicianRole } from "./useClinician";
import { PREADMISSION_KEY, parseAssessments, continenceScore, newId, type AdlItem } from "@/lib/preadmissionAssessment";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ADL_KEY = "adl_logs";
const s = (v: unknown) => (v == null ? "" : String(v));
const today = () => new Date().toISOString().split("T")[0];
const shiftNow = () => { const h = new Date().getHours(); return h >= 6 && h < 14 ? "AM" : h >= 14 && h < 22 ? "PM" : "NOC"; };

const DOMAINS = [
  { key: "bathing", label: "Bathing", emoji: "🛁", adl: "bathing" as AdlItem | null },
  { key: "dressing", label: "Dressing", emoji: "👕", adl: "dressing" as AdlItem | null },
  { key: "grooming", label: "Grooming", emoji: "✂️", adl: "grooming" as AdlItem | null },
  { key: "toileting", label: "Toileting", emoji: "🚽", adl: "toileting" as AdlItem | null },
  { key: "transfers", label: "Transfers", emoji: "🔄", adl: "transfers" as AdlItem | null },
  { key: "feeding", label: "Feeding", emoji: "🍽️", adl: "feeding" as AdlItem | null },
  { key: "mobility", label: "Mobility", emoji: "🚶", adl: null },
  { key: "continence", label: "Continence", emoji: "💧", adl: null },
  { key: "cognition", label: "Cognition/Behavior", emoji: "🧠", adl: null },
  { key: "sleep", label: "Sleep/Rest", emoji: "😴", adl: null },
] as const;
type DomainKey = (typeof DOMAINS)[number]["key"];

const SHIFTS = [{ v: "AM", label: "AM Shift (6am–2pm)" }, { v: "PM", label: "PM Shift (2pm–10pm)" }, { v: "NOC", label: "Noc Shift (10pm–6am)" }];
const ASSIST = ["Independent", "Supervision/Cueing", "One-Person Assist", "Two-Person Assist", "Full Assist", "Refused"];
const CHANGES = [
  { v: "Improved", icon: TrendingUp, cls: "text-green-600", on: "bg-green-50 border-green-400 text-green-700" },
  { v: "Same as Baseline", icon: Minus, cls: "text-indigo-500", on: "bg-indigo-50 border-indigo-400 text-indigo-700" },
  { v: "Declined", icon: TrendingDown, cls: "text-amber-600", on: "bg-amber-50 border-amber-400 text-amber-700" },
  { v: "Significant Decline", icon: AlertTriangle, cls: "text-red-600", on: "bg-red-50 border-red-400 text-red-700" },
];
const FLAGS = [{ k: "safety", label: "Safety Concern" }, { k: "followUp", label: "Follow-up Needed" }, { k: "createTask", label: "Create Task" }, { k: "escalate", label: "Escalate" }] as const;
type FlagKey = (typeof FLAGS)[number]["k"];

interface AdlEntry {
  id: string; residentId: string; date: string; shift: string; domain: DomainKey;
  assistance: string; change: string; flags: Partial<Record<FlagKey, boolean>>; notes?: string;
  baseline?: string; by?: string; at: string;
}
const parseLogs = (raw: string | null | undefined): AdlEntry[] => {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((l) => l && typeof l.id === "string") : []; } catch { return []; }
};

type BaselineLabel = "Independent" | "Needs Assistance" | "Dependent";
type Baseline = { label: BaselineLabel; score: number } | null;
const BL = (label: BaselineLabel): Baseline => ({ label, score: label === "Independent" ? 2 : label === "Needs Assistance" ? 1 : 0 });

export default function ADLMonitoringBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName } = useClinician(clinicianRole);
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const { data: settingRows, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const logs = useMemo(() => parseLogs(settingRows.find((r) => (r.key || r.id) === ADL_KEY)?.value), [settingRows]);
  const assessments = useMemo(() => parseAssessments(settingRows.find((r) => (r.key || r.id) === PREADMISSION_KEY)?.value), [settingRows]);

  const [resId, setResId] = useState("");
  const [date, setDate] = useState(today());
  const [shift, setShift] = useState(shiftNow());
  const [view, setView] = useState<"log" | "alerts">("log");
  const [logDomain, setLogDomain] = useState<DomainKey | null>(null);

  const resident = residents.find((r: Row) => s(r.id) === resId) || null;

  // Baseline per domain from the resident's latest pre-admission assessment
  // (matched by name — assessments are name-keyed).
  const baselineFor = (domain: DomainKey): Baseline => {
    if (!resident) return null;
    const a = assessments.filter((x) => (x.residentName || "").trim().toLowerCase() === s(resident.name).trim().toLowerCase())
      .sort((p, q) => (q.updatedAt || "").localeCompare(p.updatedAt || ""))[0];
    if (!a) return null;
    const d = DOMAINS.find((x) => x.key === domain)!;
    if (d.adl) { const lv = a.adl?.[d.adl]; return lv === "INDEPENDENT" ? BL("Independent") : lv === "ASSISTANCE" ? BL("Needs Assistance") : lv === "DEPENDENT" ? BL("Dependent") : null; }
    if (domain === "mobility") return a.walking ? (a.walking === "INDEPENDENT" ? BL("Independent") : a.walking === "BEDBOUND" || a.walking === "WHEELCHAIR" ? BL("Dependent") : BL("Needs Assistance")) : null;
    if (domain === "continence") { if (!a.urinary && !a.bowel) return null; const c = continenceScore(a.urinary, a.bowel); return c === 0 ? BL("Independent") : c >= 3 ? BL("Dependent") : BL("Needs Assistance"); }
    if (domain === "cognition") return a.memory ? (a.memory === "NORMAL" ? BL("Independent") : a.memory === "MILD" ? BL("Needs Assistance") : BL("Dependent")) : null;
    return null;
  };

  const shiftLogs = useMemo(() => logs.filter((l) => l.residentId === resId && l.date === date && l.shift === shift), [logs, resId, date, shift]);
  const loggedByDomain = useMemo(() => new Map(shiftLogs.map((l) => [l.domain, l])), [shiftLogs]);
  const declines = useMemo(() => logs.filter((l) => (!resId || l.residentId === resId) && (l.change === "Declined" || l.change === "Significant Decline")).sort((a, b) => (b.at || "").localeCompare(a.at || "")), [logs, resId]);

  const persist = async (next: AdlEntry[]) => { await upsertRecord("app-settings", ADL_KEY, { key: ADL_KEY, value: JSON.stringify(next) }); await refetch(); };

  const saveEntry = async (domain: DomainKey, payload: { assistance: string; change: string; flags: Partial<Record<FlagKey, boolean>>; notes: string }) => {
    const now = new Date().toISOString();
    const baseline = baselineFor(domain);
    const rec: AdlEntry = { id: newId("adl"), residentId: resId, date, shift, domain, assistance: payload.assistance, change: payload.change, flags: payload.flags, notes: payload.notes || undefined, baseline: baseline?.label, by: clinicianName, at: now };
    // Replace any existing entry for this domain+shift (re-log), else prepend.
    const rest = logs.filter((l) => !(l.residentId === resId && l.date === date && l.shift === shift && l.domain === domain));
    await persist([rec, ...rest]);
    if (payload.flags.createTask) {
      const label = DOMAINS.find((d) => d.key === domain)!.label;
      await createRecord("tasks", { residentId: resId, title: `ADL follow-up — ${label}`, description: payload.notes || `${label}: ${payload.assistance} (${payload.change}).`, status: "PENDING", priority: payload.change === "Significant Decline" ? "HIGH" : "MEDIUM", category: "Personal Care" }).catch(() => null);
    }
    setLogDomain(null);
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "ADL entry logged", showConfirmButton: false, timer: 1500 });
  };

  return (
    <div className="min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6">
      <div className="mb-5">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 flex items-center gap-2"><Activity className="w-6 h-6 text-indigo-500" /> ADL Monitoring</h1>
        <p className="text-sm text-slate-500 mt-1">Track Activities of Daily Living per resident, shift, and domain</p>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-4 items-end mb-5">
        <label className="block"><span className="text-xs font-semibold text-slate-500">Resident</span>
          <select value={resId} onChange={(e) => setResId(e.target.value)} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-indigo-400/40">
            <option value="">Select resident</option>
            {residents.map((r: Row) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Rm {s(r.room)}</option>)}
          </select>
        </label>
        <label className="block"><span className="text-xs font-semibold text-slate-500">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-indigo-400/40" />
        </label>
        <label className="block"><span className="text-xs font-semibold text-slate-500">Shift</span>
          <select value={shift} onChange={(e) => setShift(e.target.value)} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-indigo-400/40">
            {SHIFTS.map((sh) => <option key={sh.v} value={sh.v}>{sh.label}</option>)}
          </select>
        </label>
        <div className="text-sm text-slate-500 sm:text-right sm:pb-2.5">{resId ? `${loggedByDomain.size}/10 domains logged this shift` : ""}</div>
      </div>

      {!resId ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400"><Activity className="w-12 h-12 mb-3 opacity-40" /><p>Select a resident to begin ADL monitoring</p></div>
      ) : (
        <>
          {/* Tabs */}
          <div className="inline-flex gap-1 bg-slate-100 rounded-xl p-1 mb-4">
            {([["log", "Shift Log"], ["alerts", "Decline Alerts"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} className={`px-4 py-1.5 rounded-lg text-sm font-medium ${view === v ? "bg-white shadow-sm text-slate-800" : "text-slate-500"}`}>
                {label}{v === "alerts" && declines.length ? ` (${declines.length})` : ""}
              </button>
            ))}
          </div>

          {view === "log" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {DOMAINS.map((d) => {
                const bl = baselineFor(d.key);
                const logged = loggedByDomain.get(d.key);
                const change = logged ? CHANGES.find((c) => c.v === logged.change) : null;
                return (
                  <button key={d.key} onClick={() => setLogDomain(d.key)} className="text-left rounded-2xl border border-slate-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition relative">
                    <div className="flex items-start justify-between">
                      <span className="text-2xl">{d.emoji}</span>
                      <span className="w-6 h-6 rounded-full border border-slate-200 flex items-center justify-center text-slate-400 text-lg leading-none">+</span>
                    </div>
                    <p className="font-bold text-slate-900 mt-3">{d.label}</p>
                    {bl ? <p className="text-[11px] text-slate-400 mt-0.5">Baseline: {bl.label}</p> : <p className="text-[11px] text-slate-300 mt-0.5">No baseline</p>}
                    {logged && (
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{logged.assistance}</span>
                        {change && <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${change.on}`}><change.icon className="w-3 h-3" />{logged.change}</span>}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {declines.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-400">No decline alerts{resId ? " for this resident" : ""}.</div>
              ) : declines.map((l) => {
                const d = DOMAINS.find((x) => x.key === l.domain);
                const rn = residents.find((r: Row) => s(r.id) === l.residentId);
                const sig = l.change === "Significant Decline";
                return (
                  <div key={l.id} className={`rounded-xl border p-3 flex items-start gap-3 ${sig ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
                    <span className="text-xl">{d?.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800">{d?.label} — {sig ? "Significant Decline" : "Declined"} <span className="font-normal text-slate-500">· {l.assistance}</span></p>
                      <p className="text-xs text-slate-500">{s(rn?.name) || "Resident"} · {l.date} · {l.shift} shift{l.baseline ? ` · baseline ${l.baseline}` : ""}</p>
                      {l.notes && <p className="text-xs text-slate-600 mt-1">{l.notes}</p>}
                    </div>
                    {sig ? <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" /> : <TrendingDown className="w-4 h-4 text-amber-500 shrink-0" />}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {logDomain && resident && (
        <LogModal
          domain={DOMAINS.find((d) => d.key === logDomain)!}
          resident={resident}
          baseline={baselineFor(logDomain)}
          existing={loggedByDomain.get(logDomain)}
          onClose={() => setLogDomain(null)}
          onSave={(p) => saveEntry(logDomain, p)}
        />
      )}
    </div>
  );
}

function LogModal({ domain, resident, baseline, existing, onClose, onSave }: {
  domain: (typeof DOMAINS)[number]; resident: Row; baseline: Baseline; existing?: AdlEntry;
  onClose: () => void; onSave: (p: { assistance: string; change: string; flags: Partial<Record<FlagKey, boolean>>; notes: string }) => Promise<void>;
}) {
  const [assistance, setAssistance] = useState(existing?.assistance || "");
  const [change, setChange] = useState(existing?.change || "Same as Baseline");
  const [flags, setFlags] = useState<Partial<Record<FlagKey, boolean>>>(existing?.flags || {});
  const [notes, setNotes] = useState(existing?.notes || "");
  const [saving, setSaving] = useState(false);
  const toggle = (k: FlagKey) => setFlags((p) => ({ ...p, [k]: !p[k] }));

  const submit = async () => {
    if (!assistance) { Swal.fire({ title: "Level of Assistance required", icon: "warning" }); return; }
    setSaving(true);
    try { await onSave({ assistance, change, flags, notes }); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[95vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <span className="text-xl">{domain.emoji}</span>
          <p className="flex-1 font-bold text-slate-900 text-sm">Log {domain.label} <span className="font-normal text-slate-400">— {s(resident.name)}</span></p>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-5">
          <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-3 py-2 text-sm text-indigo-700 font-medium">
            Current Baseline: {baseline ? `${baseline.label} (Score: ${baseline.score}/2)` : "Not set"}
          </div>

          <div>
            <p className="text-sm font-bold text-slate-700 mb-2">Level of Assistance <span className="text-red-500">*</span></p>
            <div className="grid grid-cols-2 gap-2">
              {ASSIST.map((a) => <button key={a} type="button" onClick={() => setAssistance(a)} className={`px-3 py-2.5 rounded-xl border text-sm font-medium ${assistance === a ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"}`}>{a}</button>)}
            </div>
          </div>

          <div>
            <p className="text-sm font-bold text-slate-700 mb-2">Change from Baseline</p>
            <div className="grid grid-cols-2 gap-2">
              {CHANGES.map((c) => { const on = change === c.v; return <button key={c.v} type="button" onClick={() => setChange(c.v)} className={`inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm font-medium ${on ? c.on : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`}><c.icon className={`w-4 h-4 ${on ? "" : c.cls}`} />{c.v}</button>; })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {FLAGS.map((fl) => (
              <button key={fl.k} type="button" onClick={() => toggle(fl.k)} className="flex items-center gap-2 text-sm text-slate-600">
                <span className={`w-9 h-5 rounded-full transition relative ${flags[fl.k] ? "bg-indigo-600" : "bg-slate-200"}`}><span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{ left: flags[fl.k] ? "18px" : "2px" }} /></span>
                {fl.label}
              </button>
            ))}
          </div>

          <div>
            <p className="text-sm font-bold text-slate-700 mb-1.5">Staff Notes</p>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observations, interventions, resident response…" className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-indigo-400/40" />
          </div>
        </div>

        <div className="px-4 py-3 border-t border-slate-100">
          <button onClick={submit} disabled={saving || !assistance} className="w-full inline-flex items-center justify-center gap-1.5 py-3 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 disabled:opacity-50"><CheckCircle2 className="w-4 h-4" /> {saving ? "Saving…" : "Log ADL Entry"}</button>
        </div>
      </div>
    </div>
  );
}
