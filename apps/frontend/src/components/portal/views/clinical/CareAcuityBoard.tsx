"use client";

/**
 * Care Acuity & Level of Care — a 10-domain acuity assessment (0–5 each → 0/50)
 * that assigns a Level of Care (1–5) through a Nurse-review → Admin-approval
 * workflow, plus Service Packages, Care Activities, and Level History. Migration-
 * free: assessments are a JSON array in the app-setting `acuity_assessments`;
 * approval best-effort maps the level onto the resident's careLevel.
 */

import { useMemo, useState } from "react";
import { Users, Clock, AlertTriangle, TrendingUp, ClipboardCheck, X, CheckCircle2 } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord, updateRecord } from "@/lib/api";
import { adaptResident } from "@/lib/adapters";
import { useClinician, type ClinicianRole } from "./useClinician";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ACUITY_KEY = "acuity_assessments";
const s = (v: unknown) => (v == null ? "" : String(v));
const newId = () => globalThis.crypto?.randomUUID?.() ?? `ac-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const fmtDate = (isoStr: string) => (isoStr ? new Date(isoStr).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

interface Domain { key: string; label: string; scale: string[] }
const DOMAINS: Domain[] = [
  { key: "adl", label: "Activities of Daily Living", scale: ["Fully independent", "Minimal setup or cueing", "Some help with 1–2 ADLs", "Help with most ADLs", "Extensive assistance (one-person)", "Total dependence (two-person)"] },
  { key: "mobility", label: "Mobility & Fall Risk", scale: ["Independent, no fall risk", "Steady with device, low risk", "Supervision, occasionally unsteady", "Assist to transfer, moderate risk", "High fall risk, extensive assist", "Non-ambulatory / bedbound"] },
  { key: "cognition", label: "Cognition & Memory", scale: ["Fully oriented", "Mild forgetfulness", "Occasional confusion", "Moderate impairment, needs cueing", "Severe impairment, disoriented", "Profound impairment"] },
  { key: "behavior", label: "Behavior & Emotional Regulation", scale: ["No concerns", "Occasional mild agitation", "Intermittent agitation/anxiety", "Frequent behaviors, redirectable", "Frequent, hard to redirect", "Severe behaviors, safety risk"] },
  { key: "nutrition", label: "Nutrition & Hydration", scale: ["Independent, good appetite", "Mild appetite changes", "Needs encouragement/monitoring", "Needs feeding assist / modified diet", "Poor intake, high risk", "Tube feeding / NPO / complex"] },
  { key: "elimination", label: "Elimination & Continence", scale: ["Fully continent", "Occasional incontinence", "Needs toileting schedule", "Frequently incontinent, needs assist", "Fully incontinent / catheter", "Ostomy / complex needs"] },
  { key: "medication", label: "Medication Complexity", scale: ["No meds or self-admin", "Simple regimen, supervised", "Several meds, nurse-administered", "Complex regimen / PRNs", "High-alert meds / titration", "IV / injectable / intensive"] },
  { key: "medical", label: "Medical Acuity & Stability", scale: ["Stable, no issues", "Stable chronic conditions", "Needs routine monitoring", "Unstable, frequent monitoring", "Acute needs / skilled care", "Complex / critical"] },
  { key: "psychosocial", label: "Psychosocial & Family Needs", scale: ["Well-adjusted", "Minor adjustment needs", "Needs regular engagement", "Isolation / mood concerns", "Significant psychosocial needs", "Complex needs / crisis support"] },
  { key: "night", label: "Night Care Requirements", scale: ["Sleeps through night", "Occasional night check", "Scheduled night checks", "Frequent night assistance", "Extensive night care", "Continuous night supervision"] },
];

interface Level { n: number; name: string; min: number; max: number; badge: string; tone: string; careLevel: string; package: string; services: string[] }
const LEVELS: Level[] = [
  { n: 1, name: "Independent Living Plus", min: 0, max: 10, badge: "bg-green-100 text-green-700", tone: "#16a34a", careLevel: "INDEPENDENT", package: "Wellness & light-touch support", services: ["Weekly wellness check", "Medication reminders", "Community activities", "Housekeeping & laundry"] },
  { n: 2, name: "Assisted Living", min: 11, max: 20, badge: "bg-blue-100 text-blue-700", tone: "#2563eb", careLevel: "ASSISTED", package: "Daily assistance", services: ["Daily ADL assistance", "Nurse-administered medications", "Escort to meals/activities", "Scheduled vitals"] },
  { n: 3, name: "Enhanced Assisted Care", min: 21, max: 30, badge: "bg-amber-100 text-amber-700", tone: "#d97706", careLevel: "ASSISTED", package: "Extensive daily care", services: ["Extensive ADL assistance", "Fall-prevention program", "Continence care", "Frequent nursing review"] },
  { n: 4, name: "Memory / Comprehensive Care", min: 31, max: 40, badge: "bg-orange-100 text-orange-700", tone: "#ea580c", careLevel: "MEMORY", package: "Comprehensive & memory support", services: ["Secured/memory support", "Behavioral care plan", "Two-person transfers", "24-hour supervision"] },
  { n: 5, name: "Skilled / Complex Care", min: 41, max: 50, badge: "bg-red-100 text-red-700", tone: "#dc2626", careLevel: "SKILLED", package: "Skilled & complex medical", services: ["Skilled nursing interventions", "Complex medication management", "Wound / IV / tube care", "Dedicated caregiver"] },
];
const levelFor = (total: number) => LEVELS.find((l) => total >= l.min && total <= l.max) ?? LEVELS[LEVELS.length - 1];

// Care-activity catalog by level (Category · Activity · Frequency · Shift · Duration).
const CARE_ACTIVITIES: { category: string; activity: string; frequency: string; shift: string; duration: string; levels: number[] }[] = [
  { category: "Wellness", activity: "Weekly wellness check", frequency: "Weekly", shift: "Morning", duration: "15 min", levels: [1] },
  { category: "Vitals & Monitoring", activity: "Routine vital signs", frequency: "Daily", shift: "Morning", duration: "10 min", levels: [1, 2, 3, 4, 5] },
  { category: "Psychosocial", activity: "Social engagement & activities", frequency: "Daily", shift: "Afternoon", duration: "30 min", levels: [1, 2, 3, 4] },
  { category: "Medication", activity: "Medication administration", frequency: "Per schedule", shift: "All shifts", duration: "10 min", levels: [2, 3, 4, 5] },
  { category: "Personal Care", activity: "Assist with bathing", frequency: "Daily", shift: "Morning", duration: "20 min", levels: [2, 3, 4, 5] },
  { category: "Personal Care", activity: "Assist with dressing & grooming", frequency: "Daily", shift: "Morning", duration: "15 min", levels: [2, 3, 4, 5] },
  { category: "Mobility", activity: "Ambulation & transfer assistance", frequency: "Every shift", shift: "All shifts", duration: "15 min", levels: [2, 3, 4, 5] },
  { category: "Nutrition", activity: "Meal setup & encouragement", frequency: "Each meal", shift: "All shifts", duration: "10 min", levels: [2, 3] },
  { category: "Fall Prevention", activity: "Hourly safety rounding", frequency: "Hourly", shift: "All shifts", duration: "5 min", levels: [3, 4, 5] },
  { category: "Continence", activity: "Scheduled toileting", frequency: "Every 2–3 hrs", shift: "All shifts", duration: "10 min", levels: [3, 4, 5] },
  { category: "Cognitive", activity: "Reorientation & cueing", frequency: "Every shift", shift: "All shifts", duration: "10 min", levels: [3, 4, 5] },
  { category: "Night Care", activity: "Scheduled night checks", frequency: "Every 2 hrs", shift: "Night", duration: "5 min", levels: [3, 4, 5] },
  { category: "Mobility", activity: "Repositioning", frequency: "Every 2 hrs", shift: "All shifts", duration: "10 min", levels: [4, 5] },
  { category: "Nutrition", activity: "Feeding assistance", frequency: "Each meal", shift: "All shifts", duration: "25 min", levels: [4, 5] },
  { category: "Behavioral", activity: "Behavioral care-plan check-in", frequency: "Every shift", shift: "All shifts", duration: "15 min", levels: [4, 5] },
  { category: "Medication", activity: "Complex medication management", frequency: "Per schedule", shift: "All shifts", duration: "20 min", levels: [4, 5] },
  { category: "Skilled Nursing", activity: "Wound care", frequency: "Daily", shift: "Morning", duration: "20 min", levels: [5] },
  { category: "Skilled Nursing", activity: "IV / injectable therapy", frequency: "Per order", shift: "All shifts", duration: "15 min", levels: [5] },
  { category: "Night Care", activity: "Continuous night supervision", frequency: "Continuous", shift: "Night", duration: "—", levels: [5] },
];

const TRIGGERS = ["Scheduled / Quarterly", "Condition Change", "Post-Fall", "Post-Hospitalization", "Family Request", "Admission"];

type AStatus = "PENDING_NURSE" | "PENDING_ADMIN" | "APPROVED" | "REJECTED";
interface Acuity { id: string; residentId: string; scores: Record<string, number>; total: number; level: number; levelName: string; trigger?: string; notes?: string; status: AStatus; createdBy?: string; createdAt: string; decidedBy?: string; decidedAt?: string; }
const parseAcuity = (raw: string | null | undefined): Acuity[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((a) => a && typeof a.id === "string") : []; } catch { return []; } };

export default function CareAcuityBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName } = useClinician(clinicianRole);
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const { data: settingRows, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const items = useMemo(() => parseAcuity(settingRows.find((r) => (r.key || r.id) === ACUITY_KEY)?.value), [settingRows]);
  const resName = (id: string) => { const r = residents.find((x: Row) => s(x.id) === id); return r ? { name: s(r.name), room: s(r.room) } : { name: id, room: "" }; };

  const [tab, setTab] = useState<"queue" | "packages" | "activities" | "history">("queue");
  const [newOpen, setNewOpen] = useState(false);

  const pendingNurse = items.filter((a) => a.status === "PENDING_NURSE");
  const pendingAdmin = items.filter((a) => a.status === "PENDING_ADMIN");
  const approved = items.filter((a) => a.status === "APPROVED").sort((a, b) => (b.decidedAt || "").localeCompare(a.decidedAt || ""));
  const queue = [...pendingNurse, ...pendingAdmin].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  // Latest approved level per resident → distribution.
  const dist = useMemo(() => {
    const latest = new Map<string, Acuity>();
    approved.forEach((a) => { if (!latest.has(a.residentId)) latest.set(a.residentId, a); });
    const d: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    latest.forEach((a) => { d[a.level] = (d[a.level] || 0) + 1; });
    return d;
  }, [approved]);

  const persist = async (next: Acuity[]) => { await upsertRecord("app-settings", ACUITY_KEY, { key: ACUITY_KEY, value: JSON.stringify(next) }); await refetch(); };

  const submitNew = async (a: Omit<Acuity, "id" | "status" | "createdBy" | "createdAt">) => {
    const rec: Acuity = { ...a, id: newId(), status: "PENDING_NURSE", createdBy: clinicianName, createdAt: new Date().toISOString() };
    await persist([rec, ...items]);
    setNewOpen(false);
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Submitted for nurse review", showConfirmButton: false, timer: 1600 });
  };

  const advance = async (a: Acuity, to: AStatus) => {
    const next = items.map((x) => (x.id === a.id ? { ...x, status: to, decidedBy: clinicianName, decidedAt: new Date().toISOString() } : x));
    await persist(next);
    if (to === "APPROVED") { const lvl = LEVELS.find((l) => l.n === a.level); if (lvl) updateRecord("residents", a.residentId, { careLevel: lvl.careLevel }).catch(() => null); }
  };
  const reject = async (a: Acuity) => { await persist(items.map((x) => (x.id === a.id ? { ...x, status: "REJECTED", decidedBy: clinicianName, decidedAt: new Date().toISOString() } : x))); };

  return (
    <div className="min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Care Acuity &amp; Level of Care</h1>
          <p className="text-sm text-slate-500 mt-1">Assessment scoring, level assignment, and care planning</p>
        </div>
        <button onClick={() => setNewOpen(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"><ClipboardCheck className="w-4 h-4" /> New Assessment</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat icon={Users} tint="#2563eb" label="Total Residents" value={String(residents.length)} />
        <Stat icon={Clock} tint="#d97706" label="Pending Nurse Review" value={String(pendingNurse.length)} />
        <Stat icon={AlertTriangle} tint="#ea580c" label="Pending Admin Approval" value={String(pendingAdmin.length)} />
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-1"><TrendingUp className="w-5 h-5 text-green-600" /><span className="text-sm text-slate-500">Level Distribution</span></div>
          <div className="flex items-center gap-2 mt-1">{LEVELS.map((l) => <span key={l.n} className="text-xs font-bold" style={{ color: l.tone }}>L{l.n}:{dist[l.n] || 0}</span>)}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="inline-flex gap-1 bg-slate-100 rounded-xl p-1 mb-5 flex-wrap">
        {([["queue", "Assessments Queue"], ["packages", "Service Packages"], ["activities", "Care Activities"], ["history", "Level History"]] as const).map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)} className={`px-3.5 py-1.5 rounded-lg text-sm font-medium ${tab === v ? "bg-white shadow-sm text-slate-800" : "text-slate-500"}`}>{label}{v === "queue" && queue.length ? ` (${queue.length})` : ""}</button>
        ))}
      </div>

      {tab === "queue" && (
        queue.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center"><CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" /><p className="text-slate-500">No pending assessments. All reviews are up to date.</p></div>
        ) : (
          <div className="space-y-3">
            {queue.map((a) => { const rn = resName(a.residentId); const lvl = LEVELS.find((l) => l.n === a.level); return (
              <div key={a.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap"><p className="font-bold text-slate-900">{rn.name}</p><span className="text-xs text-slate-400">Room {rn.room}</span><span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${lvl?.badge}`}>Level {a.level} — {a.levelName}</span></div>
                    <p className="text-xs text-slate-500 mt-1">Score {a.total}/50 · {a.trigger || "No trigger"} · by {a.createdBy || "—"} · {fmtDate(a.createdAt)}</p>
                    {a.notes && <p className="text-sm text-slate-600 mt-1.5">{a.notes}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold px-2 py-1 rounded-lg ${a.status === "PENDING_NURSE" ? "bg-amber-100 text-amber-700" : "bg-orange-100 text-orange-700"}`}>{a.status === "PENDING_NURSE" ? "Nurse Review" : "Admin Approval"}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  {a.status === "PENDING_NURSE" && <button onClick={() => advance(a, "PENDING_ADMIN")} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">Approve → Admin</button>}
                  {a.status === "PENDING_ADMIN" && <button onClick={() => advance(a, "APPROVED")} className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700">Approve &amp; Assign Level</button>}
                  <button onClick={() => reject(a)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Reject</button>
                </div>
              </div>
            ); })}
          </div>
        )
      )}

      {tab === "packages" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {LEVELS.map((l) => (
            <div key={l.n} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-1"><span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${l.badge}`}>Level {l.n}</span><span className="text-xs text-slate-400">score {l.min}–{l.max}</span></div>
              <p className="font-bold text-slate-900">{l.name}</p>
              <p className="text-sm text-slate-500 mb-2">{l.package}</p>
              <ul className="space-y-1">{l.services.map((sv) => <li key={sv} className="flex items-start gap-2 text-sm text-slate-600"><CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: l.tone }} />{sv}</li>)}</ul>
            </div>
          ))}
        </div>
      )}

      {tab === "activities" && <CareActivitiesView />}

      {tab === "history" && <LevelHistoryView residents={residents} approved={approved} />}

      {newOpen && <NewAssessmentModal residents={residents} onClose={() => setNewOpen(false)} onSubmit={submitNew} />}
    </div>
  );
}

function Stat({ icon: Icon, tint, label, value }: { icon: typeof Users; tint: string; label: string; value: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2 mb-1"><Icon className="w-5 h-5" style={{ color: tint }} /><span className="text-sm text-slate-500">{label}</span></div><p className="text-2xl font-bold text-slate-900">{value}</p></div>;
}

// ── Care Activities — level-filtered activity table ──────────────────────────
function CareActivitiesView() {
  const [lvl, setLvl] = useState<number | "">("");
  const rows = CARE_ACTIVITIES.filter((a) => lvl === "" || a.levels.includes(Number(lvl)));
  return (
    <div className="space-y-4">
      <select value={lvl} onChange={(e) => setLvl(e.target.value === "" ? "" : Number(e.target.value))} className="w-full max-w-xs px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40">
        <option value="">All Levels</option>
        {LEVELS.map((l) => <option key={l.n} value={l.n}>Level {l.n}</option>)}
      </select>
      <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead><tr className="text-left text-slate-400 border-b border-slate-100">
            <th className="font-semibold px-4 py-2.5">Level</th><th className="font-semibold px-4 py-2.5">Category</th><th className="font-semibold px-4 py-2.5">Activity</th><th className="font-semibold px-4 py-2.5">Frequency</th><th className="font-semibold px-4 py-2.5">Shift</th><th className="font-semibold px-4 py-2.5">Duration</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No care activities for this level.</td></tr>
              : rows.map((a, i) => { const mn = Math.min(...a.levels), mx = Math.max(...a.levels); return (
                <tr key={i} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2.5"><span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{mn === mx ? `L${mn}` : `L${mn}–L${mx}`}</span></td>
                  <td className="px-4 py-2.5"><span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{a.category}</span></td>
                  <td className="px-4 py-2.5 font-medium text-slate-800">{a.activity}</td>
                  <td className="px-4 py-2.5 text-slate-600">{a.frequency}</td>
                  <td className="px-4 py-2.5 text-slate-600">{a.shift}</td>
                  <td className="px-4 py-2.5 text-slate-600">{a.duration}</td>
                </tr>
              ); })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Level History — per-resident level-change timeline ───────────────────────
function LevelHistoryView({ residents, approved }: { residents: Row[]; approved: Acuity[] }) {
  const [sel, setSel] = useState("");
  const resId = sel || (residents[0] ? s(residents[0].id) : "");
  const history = approved.filter((a) => a.residentId === resId).sort((a, b) => (b.decidedAt || b.createdAt || "").localeCompare(a.decidedAt || a.createdAt || ""));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="font-bold text-slate-900 text-lg">Care Level History</h2>
      <p className="text-sm text-slate-500 mb-3">Select a resident to view their level change history</p>
      <select value={resId} onChange={(e) => setSel(e.target.value)} className="w-full max-w-sm px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40">
        {residents.length === 0 && <option value="">No residents</option>}
        {residents.map((r) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — {s(r.room)}</option>)}
      </select>
      <div className="mt-4">
        {history.length === 0 ? <p className="text-slate-400">No level changes recorded.</p>
          : <div className="space-y-2">
              {history.map((a, i) => { const prev = history[i + 1]; const lvl = LEVELS.find((l) => l.n === a.level); return (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${lvl?.badge}`}>L{a.level} — {a.levelName}</span>
                    {prev && prev.level !== a.level && <span className="text-xs text-slate-400">changed from L{prev.level}</span>}
                  </div>
                  <span className="text-xs text-slate-500">{a.total}/50 · {fmtDate(a.decidedAt || a.createdAt)} · {a.decidedBy || a.createdBy || "—"}</span>
                </div>
              ); })}
            </div>}
      </div>
    </div>
  );
}

function NewAssessmentModal({ residents, onClose, onSubmit }: { residents: Row[]; onClose: () => void; onSubmit: (a: Omit<Acuity, "id" | "status" | "createdBy" | "createdAt">) => Promise<void> }) {
  const [resId, setResId] = useState("");
  const [scores, setScores] = useState<Record<string, number>>(Object.fromEntries(DOMAINS.map((d) => [d.key, 0])));
  const [trigger, setTrigger] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const total = DOMAINS.reduce((sum, d) => sum + (scores[d.key] || 0), 0);
  const lvl = levelFor(total);
  const setScore = (k: string, v: number) => setScores((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!resId) { Swal.fire({ title: "Select a resident", icon: "warning" }); return; }
    setSaving(true);
    try { await onSubmit({ residentId: resId, scores, total, level: lvl.n, levelName: lvl.name, trigger: trigger || undefined, notes: notes || undefined }); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[95vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">New Acuity Assessment</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          <div><p className="text-sm font-semibold text-slate-700 mb-1.5">Resident</p>
            <select value={resId} onChange={(e) => setResId(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40"><option value="">Select resident</option>{residents.map((r) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Room {s(r.room)}</option>)}</select>
          </div>

          <div className="rounded-2xl border border-slate-200 p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-slate-700">Domain Scoring <span className="font-normal text-slate-400">(0–5 each)</span></p>
              <p className="text-2xl font-bold text-slate-900">{total}<span className="text-sm text-slate-400">/50</span></p>
            </div>
            <p className="text-sm font-semibold mb-3" style={{ color: lvl.tone }}>Level {lvl.n} — {lvl.name}</p>
            <div className="divide-y divide-slate-100">
              {DOMAINS.map((d) => { const v = scores[d.key] || 0; return (
                <div key={d.key} className="py-2.5">
                  <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold text-slate-800">{d.label}</p><span className="text-sm font-bold text-slate-700">{v}</span></div>
                  <div className="flex gap-1 mt-1.5">{[0, 1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => setScore(d.key, n)} className={`w-7 h-7 rounded-lg text-xs font-bold border ${v === n ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-500 border-slate-200 hover:border-blue-300"}`}>{n}</button>)}</div>
                  <p className="text-[11px] text-slate-400 mt-1">{v} — {d.scale[v]}</p>
                </div>
              ); })}
            </div>
          </div>

          <div><p className="text-sm font-semibold text-slate-700 mb-1.5">Trigger / Reason for Assessment</p>
            <select value={trigger} onChange={(e) => setTrigger(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40"><option value="">Select trigger (optional)</option>{TRIGGERS.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          </div>
          <div><p className="text-sm font-semibold text-slate-700 mb-1.5">Assessment Notes</p><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Clinical observations, rationale…" className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-400/40" /></div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{saving ? "Submitting…" : "Submit for Nurse Review"}</button>
        </div>
      </div>
    </div>
  );
}
