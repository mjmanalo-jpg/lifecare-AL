"use client";

/**
 * Shift Endorsements — structured shift handover. Three views: the endorsement
 * list (Today/Week/Month + New Endorsement), Structured Details (per-resident
 * clinical sections), and Carry-Over & Sign-Off (carry-over items + a sign-off
 * checklist whose stats derive from live incidents/tasks/ADL logs/carry-overs).
 * Migration-free: endorsements are a JSON array in the app-setting `shift_endorsements`.
 */

import { useMemo, useState } from "react";
import {
  FileText, Plus, X, AlertTriangle, Sparkles, ArrowLeft, ArrowLeftRight, ChevronDown, ChevronUp,
  User, Clock, Heart, Droplets, Accessibility, Shield, Brain, Pill, Calendar, Siren, ShieldCheck, CheckCircle2, Check, Trash2,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord, createRecord } from "@/lib/api";
import { adaptResident } from "@/lib/adapters";
import { useClinician, type ClinicianRole } from "./useClinician";
import SignatureModal from "@/components/portal/SignatureModal";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const KEY = "shift_endorsements";
const ADL_KEY = "adl_logs";
const s = (v: unknown) => (v == null ? "" : String(v));
const newId = () => globalThis.crypto?.randomUUID?.() ?? `end-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const isoDate = (d: Date) => d.toISOString().split("T")[0];
const nowTime = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const fmtDay = (isoStr: string) => new Date(isoStr + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

const SHIFT_TYPES = [
  { label: "Morning", range: "06:00–14:00" }, { label: "Afternoon", range: "14:00–22:00" }, { label: "Night", range: "22:00–06:00" },
  { label: "Morning 12h", range: "06:00–18:00" }, { label: "Night 12h", range: "18:00–06:00" },
];
const SECTIONS = [
  { key: "generalCondition", label: "General Condition", icon: Heart, color: "text-rose-500" },
  { key: "intakeElimination", label: "Intake & Elimination", icon: Droplets, color: "text-blue-500" },
  { key: "adlMobility", label: "ADL & Mobility", icon: Accessibility, color: "text-purple-500" },
  { key: "skinWound", label: "Skin & Wound", icon: Shield, color: "text-amber-500" },
  { key: "behaviorCognitive", label: "Behavior & Cognitive", icon: Brain, color: "text-pink-500" },
  { key: "medicationIssues", label: "Medication Issues", icon: Pill, color: "text-green-500" },
  { key: "appointmentsOrders", label: "Appointments & Orders", icon: Calendar, color: "text-indigo-500" },
  { key: "incidentsEscalations", label: "Incidents & Escalations", icon: Siren, color: "text-red-500" },
] as const;
const CHECKLIST = [
  { key: "alerts", label: "I have reviewed all unresolved alerts", desc: "Alerts have been acknowledged, escalated, or documented for carry-over" },
  { key: "tasks", label: "I have reviewed all pending tasks", desc: "Tasks are completed, delegated, or carried over with instructions" },
  { key: "adl", label: "I have reviewed ADL declines for this shift", desc: "Residents with declining ADL status have been noted and escalated if needed" },
  { key: "carryover", label: "Carry-over notes are complete for all unresolved concerns", desc: "All items requiring next-shift action have been documented above" },
];
const PRIORITIES = ["Routine", "Important", "Urgent"];
const ROLES = ["Nurse", "Caregiver", "Care Manager", "Physician"];
const CONCERN_SECTIONS = ["skinWound", "behaviorCognitive", "medicationIssues", "incidentsEscalations"];

interface CarryOver { id: string; residentId: string; concern: string; priority: string; role: string; dueTime?: string; action?: string; autoTask?: boolean; autoAlert?: boolean; }
interface EndResident { residentId: string; sections: Record<string, string>; }
interface Endorsement {
  id: string; number: string; date: string; shiftLabel: string; shiftRange: string;
  generalNotes?: string; medicationNotes?: string; aiSummary?: string;
  outgoingBy?: string; incomingBy?: string; signedAt?: string; status: "PENDING" | "SIGNED_OFF" | "ACKNOWLEDGED";
  residents: EndResident[]; carryOvers: CarryOver[]; checklist: Record<string, boolean>; createdAt: string;
}
const parse = (raw: string | null | undefined): Endorsement[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((e) => e && typeof e.id === "string") : []; } catch { return []; } };

export default function ShiftEndorsementBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName } = useClinician(clinicianRole);
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const incQ = useLiveQuery<Row>("incidents", { query: "take=400", tables: ["Incident"] });
  const taskQ = useLiveQuery<Row>("tasks", { query: "take=600", tables: ["Task"] });
  const { data: settingRows, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const items = useMemo(() => parse(settingRows.find((r) => (r.key || r.id) === KEY)?.value), [settingRows]);
  const adlLogs = useMemo(() => { try { const v = JSON.parse(settingRows.find((r) => (r.key || r.id) === ADL_KEY)?.value || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } }, [settingRows]);
  const resName = (id: string) => { const r = residents.find((x: Row) => s(x.id) === id); return r ? { name: s(r.name), room: s(r.room) } : { name: "Resident", room: "" }; };

  const [view, setView] = useState<"list" | "details" | "carryover">("list");
  const [activeId, setActiveId] = useState("");
  const [range, setRange] = useState<"today" | "week" | "month">("today");
  const [newOpen, setNewOpen] = useState(false);
  const active = items.find((e) => e.id === activeId) || null;

  const persist = async (next: Endorsement[]) => { await upsertRecord("app-settings", KEY, { key: KEY, value: JSON.stringify(next) }); await refetch(); };
  const update = async (id: string, patch: Partial<Endorsement> | ((e: Endorsement) => Endorsement)) => {
    await persist(items.map((e) => (e.id === id ? (typeof patch === "function" ? patch(e) : { ...e, ...patch }) : e)));
  };

  // Derived sign-off stats.
  const stats = useMemo(() => ({
    alerts: (incQ.data || []).filter((i) => !i.resolvedAt).length,
    tasks: (taskQ.data || []).filter((t) => s(t.status) === "PENDING").length,
    adl: adlLogs.filter((l: Row) => l.change === "Declined" || l.change === "Significant Decline").length,
    carry: active?.carryOvers.length ?? 0,
  }), [incQ.data, taskQ.data, adlLogs, active]);

  const pendingCount = items.filter((e) => e.status !== "ACKNOWLEDGED").length;

  const filteredByRange = useMemo(() => {
    const today = new Date();
    return items.filter((e) => {
      const d = new Date(e.date + "T00:00:00");
      if (range === "today") return e.date === isoDate(today);
      const diff = (today.getTime() - d.getTime()) / 86_400_000;
      return range === "week" ? diff <= 7 && diff >= -1 : diff <= 31 && diff >= -1;
    });
  }, [items, range]);

  const grouped = useMemo(() => { const m = new Map<string, Endorsement[]>(); filteredByRange.forEach((e) => { const a = m.get(e.date); if (a) a.push(e); else m.set(e.date, [e]); }); return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])); }, [filteredByRange]);

  const createEndorsement = async (data: { shiftLabel: string; shiftRange: string; generalNotes?: string; medicationNotes?: string; aiSummary?: string }) => {
    const rec: Endorsement = { ...data, id: newId(), number: `#${2940000 + items.length + 1}`, date: isoDate(new Date()), outgoingBy: clinicianName, incomingBy: "(pending)", signedAt: nowTime(), status: "PENDING", residents: [], carryOvers: [], checklist: {}, createdAt: new Date().toISOString() };
    await persist([rec, ...items]);
    setNewOpen(false);
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Endorsement created", showConfirmButton: false, timer: 1600 });
  };

  // ── Structured Details view ────────────────────────────────────────────────
  if (view === "details" && active) return <DetailsView e={active} residents={residents} resName={resName} onBack={() => setView("list")} update={update} />;
  // ── Carry-Over & Sign-Off view ─────────────────────────────────────────────
  if (view === "carryover" && active) return <CarryOverView e={active} residents={residents} resName={resName} stats={stats} by={clinicianName} onBack={() => setView("details")} update={update} />;

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div><h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Shift Endorsements</h1><p className="text-sm text-slate-500 mt-1">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p></div>
        <button onClick={() => setNewOpen(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"><Plus className="w-4 h-4" /> New Endorsement</button>
      </div>

      {pendingCount > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 mb-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5" />
          <div><p className="font-bold text-amber-800">{pendingCount} Pending Endorsement{pendingCount === 1 ? "" : "s"}</p><p className="text-sm text-amber-700">Awaiting incoming nurse acknowledgment</p></div>
        </div>
      )}

      <div className="flex items-center gap-5 border-b border-slate-200 mb-5">
        {([["today", "Today"], ["week", "This Week"], ["month", "This Month"]] as const).map(([v, label]) => (
          <button key={v} onClick={() => setRange(v)} className={`pb-2.5 text-sm font-semibold border-b-2 -mb-px ${range === v ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500"}`}>{label}</button>
        ))}
      </div>

      {grouped.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400">No endorsements for this period.</div>
        : <div className="space-y-6">
            {grouped.map(([date, list]) => (
              <div key={date}>
                <p className="text-sm font-semibold text-slate-500 mb-2">{fmtDay(date)}</p>
                <div className="space-y-3">
                  {list.map((e) => (
                    <div key={e.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${e.status === "ACKNOWLEDGED" ? "bg-green-100 text-green-700" : e.status === "SIGNED_OFF" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>{e.status === "ACKNOWLEDGED" ? "Acknowledged" : e.status === "SIGNED_OFF" ? "Signed Off" : "Pending"}</span>
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full border border-slate-200 text-slate-600">{e.shiftLabel} · {e.shiftRange}</span>
                      </div>
                      <p className="text-sm font-semibold text-slate-800 mt-2 flex items-center gap-1.5"><User className="w-4 h-4 text-slate-400" />{e.outgoingBy} → {e.incomingBy} <span className="font-normal text-slate-400 inline-flex items-center gap-1 ml-1"><Clock className="w-3.5 h-3.5" /> Signed {e.signedAt}</span></p>
                      {e.generalNotes && <div className="mt-2"><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">General Notes</p><p className="text-sm text-slate-600">{e.generalNotes}</p></div>}
                      <div className="flex items-center gap-2 mt-3">
                        <button onClick={() => { setActiveId(e.id); setView("details"); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"><FileText className="w-4 h-4" /> Structured Details</button>
                        <button onClick={() => { setActiveId(e.id); setView("carryover"); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"><ArrowLeftRight className="w-4 h-4" /> Carry-Over & Sign-Off</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>}

      {newOpen && <NewEndorsementModal onClose={() => setNewOpen(false)} onCreate={createEndorsement} />}
    </div>
  );
}

// ── New Endorsement modal ────────────────────────────────────────────────────
function NewEndorsementModal({ onClose, onCreate }: { onClose: () => void; onCreate: (d: { shiftLabel: string; shiftRange: string; generalNotes?: string; medicationNotes?: string; aiSummary?: string }) => Promise<void> }) {
  const [shiftIdx, setShiftIdx] = useState(0);
  const [general, setGeneral] = useState("");
  const [med, setMed] = useState("");
  const [ai, setAi] = useState("");
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [recapLoading, setRecapLoading] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const sh = SHIFT_TYPES[shiftIdx];

  // Auto-fill the whole endorsement from what actually happened this shift — the
  // meds given, incidents filed, escalations raised, tasks completed, plus open
  // carry-over — then let Gemini draft the narrative. Reviewed before saving.
  const autofill = async () => {
    setRecapLoading(true);
    try {
      const res = await fetch("/api/ai-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "shift-recap", shiftType: sh.label.toUpperCase().split(" ")[0], date: new Date().toISOString() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { Swal.fire({ title: "Couldn't pull your shift", text: data?.error || "Fill the endorsement manually or try again.", icon: "info" }); return; }
      const f = (data.fields ?? {}) as Record<string, unknown>;
      const gen = [f.residentUpdates, f.incidentsOccurred ? `Incidents: ${f.incidentDetails || "see incident log"}` : "", f.taskCompleted ? `Tasks: ${f.taskCompleted}` : "", f.handoverNotes ? `Carry-over: ${f.handoverNotes}` : ""].filter(Boolean).join("\n");
      if (gen) setGeneral(gen);
      if (f.medicationsAdministered) setMed(String(f.medicationsAdministered));
      if (data.summary) setAi(String(data.summary));
      Swal.fire({ toast: true, position: "top-end", icon: data.empty ? "info" : "success", showConfirmButton: false, timer: 3600, timerProgressBar: true, title: data.empty ? "No logged activity found for this shift — fill in anything manual." : "Pulled your shift activity — review and edit before saving." });
    } catch { Swal.fire({ title: "Couldn't pull your shift", text: "Network error — fill the endorsement manually.", icon: "info" }); }
    finally { setRecapLoading(false); }
  };
  const compose = () => `${sh.label} shift (${sh.range}) endorsement. ${general ? `Overall: ${general} ` : ""}${med ? `Medications: ${med} ` : ""}Handover completed; incoming shift to acknowledge outstanding items.`.trim();
  // Auto-fill the narrative with Gemini via the same /api/ai-assistant endpoint
  // the shift reports use; falls back to an editable local draft when AI is off.
  const generate = async () => {
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "endorsement", shift: `${sh.label} (${sh.range})`, residentUpdates: general.trim(), medications: med.trim() }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.summary) setAi(String(data.summary).trim());
      else { setAi(compose()); Swal.fire({ toast: true, position: "top-end", icon: "info", showConfirmButton: false, timer: 3200, title: res.status === 403 ? "AI isn't enabled on your plan — used a draft you can edit." : "AI unavailable right now — used a draft you can edit." }); }
    } catch { setAi(compose()); }
    finally { setAiLoading(false); }
  };
  const submit = async () => { setSaving(true); try { await onCreate({ shiftLabel: sh.label, shiftRange: sh.range, generalNotes: general || undefined, medicationNotes: med || undefined, aiSummary: ai || undefined }); } finally { setSaving(false); } };
  const ta = "w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-400/40";
  const lbl = "text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 block";
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[95vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100"><h2 className="font-bold text-slate-900 text-lg flex items-center gap-2"><FileText className="w-5 h-5" /> New Shift Endorsement</h2><button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button></div>
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          <div>
            <button onClick={autofill} disabled={recapLoading} className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-semibold hover:opacity-95 disabled:opacity-60"><Sparkles className="w-4 h-4" /> {recapLoading ? "Pulling your shift…" : "Auto-fill from my shift activity"}</button>
            <p className="text-xs text-slate-400 text-center mt-1.5">Pulls the meds you gave, incidents you filed, escalations you raised, tasks you completed &amp; open carry-over for this shift — then drafts the summary. Review before saving.</p>
          </div>
          <div><span className={lbl}>Shift Type</span>
            <div className="grid grid-cols-3 gap-2">
              {SHIFT_TYPES.map((t, i) => <button key={t.label} onClick={() => setShiftIdx(i)} className={`px-2 py-2.5 rounded-xl text-center border ${shiftIdx === i ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"}`}><span className="block text-sm font-semibold">{t.label}</span><span className={`block text-[11px] ${shiftIdx === i ? "text-white/80" : "text-slate-400"}`}>{t.range}</span></button>)}
            </div>
          </div>
          <div><span className={lbl}>General Notes</span><textarea rows={2} value={general} onChange={(e) => setGeneral(e.target.value)} placeholder="Overall shift observations, incidents, concerns…" className={ta} /></div>
          <div><span className={lbl}>Medication Notes</span><textarea rows={2} value={med} onChange={(e) => setMed(e.target.value)} placeholder="PRN medications given, missed doses, reactions…" className={ta} /></div>
          <div>
            <div className="flex items-center justify-between mb-2"><span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">AI Narrative Summary</span><button onClick={generate} disabled={aiLoading} className="inline-flex items-center gap-1 text-xs font-semibold text-purple-600 border border-purple-200 rounded-lg px-2.5 py-1 hover:bg-purple-50 disabled:opacity-60"><Sparkles className="w-3.5 h-3.5" /> {aiLoading ? "Generating…" : "Generate with AI"}</button></div>
            <textarea rows={3} value={ai} onChange={(e) => setAi(e.target.value)} placeholder="AI-generated narrative will appear here, or type manually…" className={ta} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100"><button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button><button onClick={() => setSignOpen(true)} disabled={saving} className="px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{saving ? "Creating…" : "Create Endorsement"}</button></div>
      </div>
      <SignatureModal open={signOpen} onClose={() => setSignOpen(false)} onSigned={submit} title="Sign shift endorsement" description="Enter your 4-digit signing PIN to sign off and create this endorsement." />
    </div>
  );
}

// ── Structured Details view ──────────────────────────────────────────────────
function DetailsView({ e, residents, resName, onBack, update }: { e: Endorsement; residents: Row[]; resName: (id: string) => { name: string; room: string }; onBack: () => void; update: (id: string, patch: (e: Endorsement) => Endorsement) => Promise<void> }) {
  const [openKey, setOpenKey] = useState<string>("");
  const addResident = async () => {
    const existing = new Set(e.residents.map((r) => r.residentId));
    const opts = residents.filter((r: Row) => !existing.has(s(r.id)));
    if (!opts.length) { Swal.fire({ title: "All residents added", icon: "info" }); return; }
    const { value } = await Swal.fire({ title: "Add resident", input: "select", inputOptions: Object.fromEntries(opts.map((r: Row) => [s(r.id), `${s(r.name)} — Rm ${s(r.room)}`])), inputPlaceholder: "Select resident", showCancelButton: true });
    if (value) await update(e.id, (en) => ({ ...en, residents: [...en.residents, { residentId: value, sections: {} }] }));
  };
  const setSection = async (rid: string, key: string, text: string) => update(e.id, (en) => ({ ...en, residents: en.residents.map((r) => (r.residentId === rid ? { ...r, sections: { ...r.sections, [key]: text } } : r)) }));

  return (
    <div className="min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="flex items-start gap-3">
          <button onClick={onBack} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900 mt-1"><ArrowLeft className="w-4 h-4" /> Back</button>
          <div><h1 className="text-2xl font-bold text-slate-900">Structured Endorsement Details</h1><p className="text-sm text-slate-500">Endorsement {e.number} — Per-resident clinical sections</p></div>
        </div>
        <button onClick={addResident} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"><Plus className="w-4 h-4" /> Add Resident</button>
      </div>

      {e.residents.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400">No residents added yet. Click <b>Add Resident</b> to document per-resident sections.</div>
        : <div className="space-y-4">
            {e.residents.map((r) => {
              const rn = resName(r.residentId);
              const hasConcerns = CONCERN_SECTIONS.some((k) => (r.sections[k] || "").trim());
              return (
                <div key={r.residentId} className={`rounded-2xl border overflow-hidden ${hasConcerns ? "border-amber-200" : "border-slate-200"}`}>
                  <div className={`flex items-center justify-between gap-2 px-4 py-3 ${hasConcerns ? "bg-amber-50/60" : "bg-slate-50/60"}`}>
                    <div className="flex items-center gap-2.5"><span className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center"><User className="w-4 h-4 text-blue-500" /></span><div><p className="font-bold text-slate-900 flex items-center gap-2">{rn.name}{hasConcerns && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Has Concerns</span>}</p><p className="text-xs text-slate-400">Room {rn.room}</p></div></div>
                    <button onClick={() => update(e.id, (en) => ({ ...en, residents: en.residents.filter((x) => x.residentId !== r.residentId) }))} className="p-1.5 rounded-lg hover:bg-white/60 text-slate-400"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {SECTIONS.map((sec) => { const Icon = sec.icon; const id = `${r.residentId}:${sec.key}`; const open = openKey === id; const val = r.sections[sec.key] || ""; return (
                      <div key={sec.key}>
                        <button onClick={() => setOpenKey(open ? "" : id)} className="w-full flex items-center gap-2 px-4 py-3 hover:bg-slate-50/60">
                          <Icon className={`w-4 h-4 ${sec.color}`} /><span className="text-sm font-semibold text-slate-800 flex-1 text-left">{sec.label}</span>
                          {val.trim() && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600">1</span>}
                          {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                        </button>
                        {open && <div className="px-4 pb-3"><textarea rows={2} defaultValue={val} onBlur={(ev) => { if (ev.target.value !== val) setSection(r.residentId, sec.key, ev.target.value); }} placeholder={`${sec.label} notes for this shift…`} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-400/40" /></div>}
                      </div>
                    ); })}
                  </div>
                </div>
              );
            })}
          </div>}
    </div>
  );
}

// ── Carry-Over & Sign-Off view ───────────────────────────────────────────────
function CarryOverView({ e, residents, resName, stats, by, onBack, update }: {
  e: Endorsement; residents: Row[]; resName: (id: string) => { name: string; room: string }; stats: { alerts: number; tasks: number; adl: number; carry: number }; by: string; onBack: () => void; update: (id: string, patch: (e: Endorsement) => Endorsement) => Promise<void>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const allChecked = CHECKLIST.every((c) => e.checklist[c.key]);
  const addItem = async (c: Omit<CarryOver, "id">) => {
    await update(e.id, (en) => ({ ...en, carryOvers: [...en.carryOvers, { ...c, id: newId() }] }));
    if (c.autoTask) createRecord("tasks", { residentId: c.residentId, title: `Carry-over: ${c.concern.slice(0, 60)}`, description: c.action || c.concern, status: "PENDING", priority: c.priority === "Urgent" ? "HIGH" : "MEDIUM", category: "Observation" }).catch(() => null);
    setAddOpen(false);
  };
  const signOff = async () => { if (!allChecked) { Swal.fire({ title: "Complete the checklist", text: "Review all four items before signing off.", icon: "warning" }); return; } await update(e.id, (en) => ({ ...en, status: "SIGNED_OFF", signedAt: nowTime(), outgoingBy: by })); Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Signed off", showConfirmButton: false, timer: 1500 }); };
  const acknowledge = async () => { await update(e.id, (en) => ({ ...en, status: "ACKNOWLEDGED", incomingBy: by })); Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Acknowledged", showConfirmButton: false, timer: 1500 }); };
  const toggle = (k: string) => update(e.id, (en) => ({ ...en, checklist: { ...en.checklist, [k]: !en.checklist[k] } }));

  return (
    <div className="min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6">
      <div className="flex items-start gap-3 mb-5">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900 mt-1"><ArrowLeft className="w-4 h-4" /> Back to Details</button>
        <div><h1 className="text-2xl font-bold text-slate-900">Carry-Over &amp; Sign-Off</h1><p className="text-sm text-slate-500">Endorsement {e.number}</p></div>
      </div>

      <div className="flex items-center justify-between mb-3"><p className="font-bold text-slate-900 flex items-center gap-2"><ArrowLeftRight className="w-5 h-5 text-blue-500" /> Carry-Over to Next Shift</p><button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"><Plus className="w-4 h-4" /> Add Item</button></div>
      {e.carryOvers.length === 0 ? <div className="rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center text-slate-400 mb-6">No carry-over items. Add concerns that need to continue into the next shift.</div>
        : <div className="space-y-2 mb-6">{e.carryOvers.map((c) => { const rn = resName(c.residentId); return (
            <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2"><span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${c.priority === "Urgent" ? "bg-red-100 text-red-700" : c.priority === "Important" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{c.priority}</span><span className="font-bold text-slate-900">{rn.name}</span><span className="text-xs text-slate-400">Rm {rn.room} · {c.role}{c.dueTime ? ` · due ${c.dueTime}` : ""}</span><button onClick={() => update(e.id, (en) => ({ ...en, carryOvers: en.carryOvers.filter((x) => x.id !== c.id) }))} className="ml-auto p-1 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-4 h-4" /></button></div>
              <p className="text-sm text-slate-700 mt-1.5">{c.concern}</p>{c.action && <p className="text-xs text-slate-500 mt-0.5">Action: {c.action}</p>}
            </div>
          ); })}</div>}

      <div className="border-t border-slate-200 pt-5">
        <p className="font-bold text-slate-900 flex items-center gap-2 mb-1"><ShieldCheck className="w-5 h-5 text-green-500" /> Shift Sign-Off Checklist</p>
        <p className="text-sm text-slate-500 mb-4">Before signing off, the outgoing shift must review all pending items. The incoming shift must acknowledge receipt.</p>
        <div className="grid grid-cols-2 gap-3 mb-5">
          <EndStat n={stats.alerts} label="Unresolved Alerts" cls="bg-red-50 border-red-100" />
          <EndStat n={stats.tasks} label="Pending Tasks" cls="bg-yellow-50 border-yellow-100" />
          <EndStat n={stats.adl} label="ADL Declines" cls="bg-green-50 border-green-100" />
          <EndStat n={stats.carry} label="Unresolved Carry-Overs" cls="bg-orange-50 border-orange-100" />
        </div>
        <div className="space-y-2 mb-5">
          {CHECKLIST.map((c) => { const on = !!e.checklist[c.key]; return (
            <button key={c.key} onClick={() => toggle(c.key)} className="w-full flex items-start gap-3 text-left rounded-xl p-2 hover:bg-slate-50">
              <span className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 mt-0.5 ${on ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300"}`}>{on && <Check className="w-3.5 h-3.5" />}</span>
              <span><span className="block text-sm font-semibold text-slate-800">{c.label}</span><span className="block text-xs text-slate-500">{c.desc}</span></span>
            </button>
          ); })}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={signOff} disabled={!allChecked} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40"><CheckCircle2 className="w-4 h-4" /> Sign Off (Outgoing)</button>
          <button onClick={acknowledge} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50"><Check className="w-4 h-4" /> Acknowledge (Incoming)</button>
        </div>
      </div>

      {addOpen && <AddCarryOverModal residents={residents} onClose={() => setAddOpen(false)} onAdd={addItem} />}
    </div>
  );
}

function EndStat({ n, label, cls }: { n: number; label: string; cls: string }) {
  return <div className={`rounded-2xl border p-5 text-center ${cls}`}><p className="text-2xl font-bold text-slate-800">{n}</p><p className="text-sm text-slate-500 mt-1">{label}</p></div>;
}

function AddCarryOverModal({ residents, onClose, onAdd }: { residents: Row[]; onClose: () => void; onAdd: (c: Omit<CarryOver, "id">) => Promise<void> }) {
  const [residentId, setResidentId] = useState("");
  const [concern, setConcern] = useState("");
  const [priority, setPriority] = useState("Routine");
  const [role, setRole] = useState("Nurse");
  const [dueTime, setDueTime] = useState("");
  const [action, setAction] = useState("");
  const [autoTask, setAutoTask] = useState(false);
  const [autoAlert, setAutoAlert] = useState(false);
  const [saving, setSaving] = useState(false);
  const submit = async () => { if (!residentId || !concern.trim()) { Swal.fire({ title: "Resident and concern are required", icon: "warning" }); return; } setSaving(true); try { await onAdd({ residentId, concern: concern.trim(), priority, role, dueTime: dueTime || undefined, action: action || undefined, autoTask, autoAlert }); } finally { setSaving(false); } };
  const inp = "w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40";
  const lbl = "text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 block";
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[95vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100"><h2 className="font-bold text-slate-900 text-lg">Add Carry-Over Item</h2><button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button></div>
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          <div><span className={lbl}>Resident</span><select value={residentId} onChange={(e) => setResidentId(e.target.value)} className={inp}><option value="">Select resident…</option>{residents.map((r) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Rm {s(r.room)}</option>)}</select></div>
          <div><span className={lbl}>Concern / Task to Carry Over</span><textarea rows={2} value={concern} onChange={(e) => setConcern(e.target.value)} placeholder="Describe what needs to continue into the next shift…" className={inp} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><span className={lbl}>Priority</span><select value={priority} onChange={(e) => setPriority(e.target.value)} className={inp}>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
            <div><span className={lbl}>Responsible Role</span><select value={role} onChange={(e) => setRole(e.target.value)} className={inp}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
          </div>
          <div><span className={lbl}>Due Time (Optional)</span><input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className={inp} /></div>
          <div><span className={lbl}>Required Action</span><textarea rows={2} value={action} onChange={(e) => setAction(e.target.value)} placeholder="What specifically needs to be done…" className={inp} /></div>
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-2">
            <button onClick={() => setAutoTask((v) => !v)} className="flex items-center gap-2.5 text-sm text-slate-700"><span className={`w-5 h-5 rounded border flex items-center justify-center ${autoTask ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300"}`}>{autoTask && <Check className="w-3.5 h-3.5" />}</span>Auto-create clinical task</button>
            <button onClick={() => setAutoAlert((v) => !v)} className="flex items-center gap-2.5 text-sm text-slate-700"><span className={`w-5 h-5 rounded border flex items-center justify-center ${autoAlert ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300"}`}>{autoAlert && <Check className="w-3.5 h-3.5" />}</span>Auto-create alert</button>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100"><button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button><button onClick={submit} disabled={saving} className="px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{saving ? "Adding…" : "Add Carry-Over"}</button></div>
      </div>
    </div>
  );
}
