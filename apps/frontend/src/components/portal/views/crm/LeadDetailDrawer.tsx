"use client";

import { useEffect, useMemo, useState } from "react";
import {
  X, Phone, Mail, Trash2, ArrowRight, UserPlus, CalendarClock, StickyNote, PhoneCall,
  Send, CheckCircle2, Circle, Plus, MapPin, Check,
} from "lucide-react";
import Swal from "@/lib/swal";
import { composeName, nameParts } from "@/lib/names";
import {
  LEAD_STAGES, OPEN_STAGES, STAGE_META, LEAD_SOURCES, LOST_REASONS, TASK_TYPES,
  followUpDaysLeft, type Lead, type LeadStage, type LeadTask, type TaskType, type ActivityType,
} from "@/lib/crmLeads";
import type { CrmApi, Admission } from "@/lib/useCrmLeads";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white";
// No `w-full` — for use inside flex rows where an explicit width/flex controls sizing.
const inputSm = "rounded-lg border border-slate-300 px-2.5 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white";
const label = "text-xs font-medium text-slate-600";

const ACT_ICON: Record<ActivityType, typeof StickyNote> = {
  note: StickyNote, call: PhoneCall, email: Send, stage: ArrowRight, tour: MapPin, task: CheckCircle2, system: Circle,
};
const TASK_ICON: Record<TaskType, typeof PhoneCall> = { call: PhoneCall, email: Send, visit: MapPin, todo: Check };
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function LeadDetailDrawer({ leadId, api, onClose }: { leadId: string; api: CrmApi; onClose: () => void }) {
  const lead = useMemo(() => api.leads.find((l) => l.id === leadId), [api.leads, leadId]);
  const admission: Admission | undefined = lead?.convertedAdmissionId ? api.admissionById.get(lead.convertedAdmissionId) : undefined;

  // Local, debounce-free profile edit state; saved explicitly.
  const [form, setForm] = useState<Lead | null>(null);
  useEffect(() => {
    if (!lead) return;
    const p = nameParts({ firstName: lead.residentFirstName, middleName: lead.residentMiddleName, lastName: lead.residentLastName, name: lead.prospectiveResident });
    setForm({ ...lead, residentFirstName: p.firstName, residentMiddleName: p.middleName, residentLastName: p.lastName });
  }, [lead]);

  const [note, setNote] = useState("");
  const [noteType, setNoteType] = useState<ActivityType>("note");
  const [taskDraft, setTaskDraft] = useState<{ title: string; type: TaskType; dueDate: string }>({ title: "", type: "call", dueDate: todayIso() });
  const [savingProfile, setSavingProfile] = useState(false);

  // ESC closes.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  if (!lead || !form) return null;
  const stageIdx = LEAD_STAGES.indexOf(lead.stage);
  const openTasksList = (lead.tasks ?? []).filter((t) => !t.done);
  const doneTasksList = (lead.tasks ?? []).filter((t) => t.done);
  const activity = [...(lead.activity ?? [])].reverse();

  const setResidentPart = (patch: Partial<Pick<Lead, "residentFirstName" | "residentMiddleName" | "residentLastName">>) =>
    setForm((f) => f && ({ ...f, ...patch, prospectiveResident: composeName({ ...f, ...patch }.residentFirstName, { ...f, ...patch }.residentMiddleName, { ...f, ...patch }.residentLastName) }));

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await api.updateLead(lead.id, {
        name: form.name, contact: form.contact, email: form.email, source: form.source, assignedTo: form.assignedTo, notes: form.notes,
        residentFirstName: form.residentFirstName, residentMiddleName: form.residentMiddleName, residentLastName: form.residentLastName,
        prospectiveResident: form.prospectiveResident,
      });
    } finally { setSavingProfile(false); }
  };

  const addNote = async () => { if (!note.trim()) return; await api.logActivity(lead.id, note.trim(), noteType); setNote(""); setNoteType("note"); };
  const addTask = async () => { if (!taskDraft.title.trim()) return; await api.addTask(lead.id, taskDraft); setTaskDraft({ title: "", type: "call", dueDate: todayIso() }); };

  const doConvert = async () => {
    const r = await Swal.fire({ title: "Convert to admission?", text: `Start the move-in for ${lead.prospectiveResident || lead.name}.`, icon: "question", showCancelButton: true, confirmButtonText: "Convert", confirmButtonColor: "#16a34a" });
    if (!r.isConfirmed) return;
    try { await api.convert(lead); Swal.fire({ title: "Converted", text: "A move-in was created — continue it in Admissions.", icon: "success", timer: 2200, showConfirmButton: false }); }
    catch (e) { Swal.fire({ title: "Failed", text: e instanceof Error ? e.message : "Try again", icon: "error" }); }
  };

  const markLost = async () => {
    const { value } = await Swal.fire({ title: "Mark as lost", input: "select", inputOptions: Object.fromEntries(LOST_REASONS.map((r) => [r, r])), inputPlaceholder: "Reason", showCancelButton: true, confirmButtonText: "Mark lost", confirmButtonColor: "#dc2626" });
    if (!value) return;
    await api.moveStage(lead, "LOST", String(value));
  };

  const scheduleTour = async () => {
    const { value } = await Swal.fire({ title: "Schedule tour", html: `<input id="tourdt" type="datetime-local" class="swal2-input" value="${lead.tourDate ? new Date(lead.tourDate).toISOString().slice(0, 16) : ""}">`, showCancelButton: true, confirmButtonText: "Save", preConfirm: () => (document.getElementById("tourdt") as HTMLInputElement)?.value });
    if (value === undefined) return;
    await api.setTour(lead.id, value ? new Date(String(value)).toISOString() : "");
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-2xl bg-slate-50 shadow-2xl h-full overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-900 truncate">{lead.name}</h2>
              {lead.prospectiveResident && <p className="text-xs text-slate-500 truncate">Resident: {lead.prospectiveResident}</p>}
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="w-5 h-5" /></button>
          </div>
          {/* Stage stepper */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {LEAD_STAGES.filter((s) => s !== "LOST").map((s, i) => {
              const active = s === lead.stage;
              const past = i < stageIdx;
              return (
                <button key={s} onClick={() => api.moveStage(lead, s)}
                  className={`shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full border transition ${active ? STAGE_META[s].badge : past ? "bg-slate-100 text-slate-500 border-slate-200" : "bg-white text-slate-400 border-slate-200 hover:border-blue-300 hover:text-blue-600"}`}>
                  {STAGE_META[s].label}
                </button>
              );
            })}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {OPEN_STAGES.includes(lead.stage) && !lead.convertedAdmissionId && (
              <button onClick={doConvert} className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"><ArrowRight className="w-3.5 h-3.5" /> Convert</button>
            )}
            {OPEN_STAGES.includes(lead.stage) && (
              <button onClick={markLost} className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 border border-rose-200">Mark lost</button>
            )}
            <button onClick={() => api.deleteLead(lead.id).then(onClose)} className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 ml-auto"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
          </div>
          {admission && (
            <p className="mt-2 text-[11px] font-semibold px-2 py-1 rounded bg-amber-50 text-amber-700 inline-flex items-center gap-1"><UserPlus className="w-3 h-3" /> Admission · {String(admission.status ?? "IN_PROGRESS") === "COMPLETED" ? "Completed" : String(admission.status) === "CANCELLED" ? "Cancelled" : `In progress (step ${admission.currentStep ?? 1}/4)`}</p>
          )}
        </div>

        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {/* Tour */}
          <Section title="Tour" icon={MapPin}>
            {lead.tourDate ? (
              <div className="space-y-2">
                <p className="text-sm text-slate-700 font-medium">{new Date(lead.tourDate).toLocaleString()}</p>
                {lead.tourOutcome ? (
                  <span className="text-xs font-semibold px-2 py-1 rounded bg-slate-100 text-slate-600 capitalize">{lead.tourOutcome.replace("_", " ")}</span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {(["completed", "no_show", "rescheduled"] as const).map((o) => (
                      <button key={o} onClick={() => api.setTourOutcome(lead.id, o)} className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 capitalize">{o.replace("_", " ")}</button>
                    ))}
                    <button onClick={scheduleTour} className="text-xs px-2 py-1 rounded text-blue-600 hover:bg-blue-50">Reschedule</button>
                  </div>
                )}
              </div>
            ) : (
              <button onClick={scheduleTour} className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"><CalendarClock className="w-4 h-4" /> Schedule a tour</button>
            )}
          </Section>

          {/* Tasks / follow-ups */}
          <Section title={`Follow-ups${openTasksList.length ? ` · ${openTasksList.length}` : ""}`} icon={CheckCircle2}>
            <div className="space-y-1.5">
              {openTasksList.map((t) => <TaskRow key={t.id} t={t} onToggle={() => api.toggleTask(lead.id, t.id)} />)}
              {openTasksList.length === 0 && <p className="text-xs text-slate-400">No open follow-ups.</p>}
            </div>
            <div className="mt-2.5 space-y-1.5">
              <input className={input} placeholder="e.g. Call to confirm tour" value={taskDraft.title} onChange={(e) => setTaskDraft({ ...taskDraft, title: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addTask()} />
              <div className="flex items-center gap-1.5">
                <select className={inputSm} value={taskDraft.type} onChange={(e) => setTaskDraft({ ...taskDraft, type: e.target.value as TaskType })}>{TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                <input type="date" className={inputSm + " flex-1 min-w-0"} value={taskDraft.dueDate} onChange={(e) => setTaskDraft({ ...taskDraft, dueDate: e.target.value })} />
                <button onClick={addTask} className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 shrink-0"><Plus className="w-4 h-4" /></button>
              </div>
            </div>
            {doneTasksList.length > 0 && (
              <details className="mt-2"><summary className="text-xs text-slate-400 cursor-pointer">Completed ({doneTasksList.length})</summary>
                <div className="mt-1.5 space-y-1.5">{doneTasksList.map((t) => <TaskRow key={t.id} t={t} onToggle={() => api.toggleTask(lead.id, t.id)} />)}</div>
              </details>
            )}
          </Section>

          {/* Activity timeline + quick log */}
          <Section title="Activity" icon={StickyNote}>
            <div className="flex items-center gap-1.5 mb-2">
              <select className={inputSm} value={noteType} onChange={(e) => setNoteType(e.target.value as ActivityType)}>
                <option value="note">Note</option><option value="call">Call</option><option value="email">Email</option>
              </select>
              <input className={inputSm + " flex-1 min-w-0"} placeholder="Log a note, call, or email…" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNote()} />
              <button onClick={addNote} className="p-2 rounded-lg bg-slate-800 text-white hover:bg-slate-900 shrink-0"><Send className="w-4 h-4" /></button>
            </div>
            <ol className="space-y-2.5 border-l border-slate-200 pl-3">
              {activity.map((a, i) => {
                const Icon = ACT_ICON[a.type ?? "note"];
                return (
                  <li key={i} className="relative">
                    <span className="absolute -left-[1.31rem] top-0.5 w-4 h-4 rounded-full bg-white border border-slate-300 flex items-center justify-center"><Icon className="w-2.5 h-2.5 text-slate-500" /></span>
                    <p className="text-sm text-slate-700">{a.note}</p>
                    <p className="text-[11px] text-slate-400">{a.by} · {new Date(a.at).toLocaleString()}</p>
                  </li>
                );
              })}
              {activity.length === 0 && <li className="text-xs text-slate-400">No activity yet.</li>}
            </ol>
          </Section>

          {/* Profile */}
          <Section title="Details" icon={UserPlus}>
            <div className="grid grid-cols-2 gap-2.5">
              <label className={label + " col-span-2"}>Contact name<input className={input + " mt-1"} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label className={label}>Resident first<input className={input + " mt-1"} value={form.residentFirstName || ""} onChange={(e) => setResidentPart({ residentFirstName: e.target.value })} /></label>
              <label className={label}>Resident last<input className={input + " mt-1"} value={form.residentLastName || ""} onChange={(e) => setResidentPart({ residentLastName: e.target.value })} /></label>
              <label className={label}><span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />Phone</span><input className={input + " mt-1"} value={form.contact || ""} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></label>
              <label className={label}><span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" />Email</span><input className={input + " mt-1"} value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              <label className={label}>Source<select className={input + " mt-1"} value={form.source || ""} onChange={(e) => setForm({ ...form, source: e.target.value })}>{LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              <label className={label}>Assigned to<input className={input + " mt-1"} value={form.assignedTo || ""} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} placeholder="Rep" /></label>
              <label className={label + " col-span-2"}>Notes<textarea className={input + " mt-1 min-h-[56px]"} value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
            </div>
            <button onClick={saveProfile} disabled={savingProfile} className="mt-2.5 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"><Check className="w-4 h-4" /> {savingProfile ? "Saving…" : "Save details"}</button>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof StickyNote; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3.5">
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5 mb-2.5"><Icon className="w-3.5 h-3.5" /> {title}</h3>
      {children}
    </section>
  );
}

function TaskRow({ t, onToggle }: { t: LeadTask; onToggle: () => void }) {
  const Icon = TASK_ICON[t.type];
  const d = followUpDaysLeft(t.dueDate);
  const overdue = !t.done && d != null && d < 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <button onClick={onToggle} className={t.done ? "text-emerald-600" : "text-slate-300 hover:text-emerald-600"}>{t.done ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}</button>
      <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      <span className={`flex-1 truncate ${t.done ? "line-through text-slate-400" : "text-slate-700"}`}>{t.title}</span>
      {t.dueDate && <span className={`text-[11px] font-medium shrink-0 ${overdue ? "text-rose-600" : "text-slate-400"}`}>{new Date(t.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
    </div>
  );
}
