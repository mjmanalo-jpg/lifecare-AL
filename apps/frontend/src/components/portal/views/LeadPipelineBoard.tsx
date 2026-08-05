"use client";

import { useMemo, useState, useEffect } from "react";
import { Plus, X, ChevronRight, Trash2, CalendarClock, UserPlus, TrendingUp, Users, Phone, Mail, Loader2, ArrowRight } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord, createRecord } from "@/lib/api";
import {
  CRM_LEADS_KEY, LEAD_STAGES, OPEN_STAGES, STAGE_META, LEAD_SOURCES,
  parseLeads, newId, followUpDaysLeft, type Lead, type LeadStage,
} from "@/lib/crmLeads";

type SettingRow = { id: string; key?: string; value: string };
const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white";
const EMPTY: Omit<Lead, "id" | "createdAt" | "activity"> = { name: "", contact: "", email: "", source: "Website", prospectiveResident: "", stage: "NEW", assignedTo: "", notes: "", followUpDate: "" };

/** Lead & Pipeline Management — the pre-admission CRM funnel (New → Toured →
 *  Application → Move-in), follow-ups, pipeline analytics, and convert-to-admission. */
export default function LeadPipelineBoard() {
  const { data: settingRows, refetch } = useLiveQuery<SettingRow>("app-settings", { tables: ["AppSetting"] });
  const leads = useMemo(() => parseLeads(settingRows.find((r) => (r.key || r.id) === CRM_LEADS_KEY)?.value), [settingRows]);

  const [me, setMe] = useState("");
  useEffect(() => { fetch("/api/auth/session").then((r) => r.json()).then((d) => setMe(d?.session?.name || d?.workspaces?.user?.name || "Staff")).catch(() => {}); }, []);

  const [editing, setEditing] = useState<Lead | null>(null);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const persist = async (next: Lead[]) => {
    await upsertRecord("app-settings", CRM_LEADS_KEY, { key: CRM_LEADS_KEY, value: JSON.stringify(next) });
    await refetch();
  };

  const stats = useMemo(() => {
    const open = leads.filter((l) => OPEN_STAGES.includes(l.stage));
    const won = leads.filter((l) => l.stage === "MOVE_IN").length;
    const lost = leads.filter((l) => l.stage === "LOST").length;
    const closed = won + lost;
    const dueFollowUps = leads.filter((l) => OPEN_STAGES.includes(l.stage) && (followUpDaysLeft(l.followUpDate) ?? 99) <= 0).length;
    return { total: leads.length, open: open.length, won, conversion: closed ? Math.round((won / closed) * 100) : 0, dueFollowUps };
  }, [leads]);

  const openAdd = () => { setEditing(null); setForm(EMPTY); setShowForm(true); };
  const openEdit = (l: Lead) => { setEditing(l); setForm({ ...EMPTY, ...l }); setShowForm(true); };

  const saveForm = async () => {
    if (!form.name.trim()) { Swal.fire({ title: "Name required", icon: "warning" }); return; }
    setSaving(true);
    try {
      if (editing) {
        await persist(leads.map((l) => (l.id === editing.id ? { ...l, ...form } : l)));
      } else {
        const lead: Lead = { ...form, id: newId(), createdAt: new Date().toISOString(), activity: [{ at: new Date().toISOString(), by: me, note: "Lead created" }] };
        await persist([lead, ...leads]);
      }
      setShowForm(false);
    } finally { setSaving(false); }
  };

  const moveStage = async (lead: Lead, stage: LeadStage) => {
    const activity = [...(lead.activity ?? []), { at: new Date().toISOString(), by: me, note: `Moved to ${STAGE_META[stage].label}` }];
    await persist(leads.map((l) => (l.id === lead.id ? { ...l, stage, activity } : l)));
  };

  const removeLead = async (lead: Lead) => {
    const r = await Swal.fire({ title: "Delete lead?", text: lead.name, icon: "warning", showCancelButton: true, confirmButtonColor: "#dc2626" });
    if (r.isConfirmed) await persist(leads.filter((l) => l.id !== lead.id));
  };

  const convert = async (lead: Lead) => {
    const r = await Swal.fire({ title: "Convert to admission?", text: `Start the move-in process for ${lead.prospectiveResident || lead.name}.`, icon: "question", showCancelButton: true, confirmButtonText: "Convert", confirmButtonColor: "#16a34a" });
    if (!r.isConfirmed) return;
    try {
      const [first, ...rest] = String(lead.prospectiveResident || lead.name).trim().split(/\s+/);
      const res = await createRecord("admissions", { firstName: first || lead.name, lastName: rest.join(" ") || "—", phone: lead.contact || null, email: lead.email || null, status: "IN_PROGRESS", currentStep: 1, completedSteps: "[]", sponsorName: lead.name, sponsorEmail: lead.email || null });
      const admissionId = (res.data as { id?: string })?.id;
      await persist(leads.map((l) => (l.id === lead.id ? { ...l, stage: "MOVE_IN", convertedAdmissionId: admissionId, activity: [...(l.activity ?? []), { at: new Date().toISOString(), by: me, note: "Converted to admission" }] } : l)));
      Swal.fire({ title: "Converted", text: "A move-in (admission) was created. Continue it in Admissions.", icon: "success" });
    } catch (e) { Swal.fire({ title: "Failed", text: e instanceof Error ? e.message : "Try again", icon: "error" }); }
  };

  const setFollowUp = async (lead: Lead) => {
    const { value } = await Swal.fire({ title: "Set follow-up date", input: "date", inputValue: lead.followUpDate?.slice(0, 10) || "", showCancelButton: true, confirmButtonText: "Save" });
    if (value === undefined) return;
    await persist(leads.map((l) => (l.id === lead.id ? { ...l, followUpDate: value ? new Date(String(value)).toISOString() : "" } : l)));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2"><Users className="w-7 h-7 text-blue-600" /> CRM — Lead &amp; Pipeline</h1>
          <p className="text-gray-500 text-sm">Track leads from first inquiry to move-in, manage follow-ups, and grow occupancy.</p>
        </div>
        <button onClick={openAdd} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 self-start"><Plus className="w-4 h-4" /> New Lead</button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Open Pipeline" value={stats.open} icon={TrendingUp} tone="blue" />
        <Kpi label="Moved In (Won)" value={stats.won} icon={UserPlus} tone="green" />
        <Kpi label="Conversion" value={`${stats.conversion}%`} icon={TrendingUp} tone="teal" />
        <Kpi label="Follow-ups Due" value={stats.dueFollowUps} icon={CalendarClock} tone={stats.dueFollowUps ? "amber" : "gray"} />
      </div>

      {/* Pipeline kanban */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {LEAD_STAGES.map((stage) => {
          const col = leads.filter((l) => l.stage === stage);
          return (
            <div key={stage} className="min-w-[240px] w-[240px] flex-shrink-0">
              <div className="flex items-center justify-between mb-2 px-1">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STAGE_META[stage].badge}`}>{STAGE_META[stage].label}</span>
                <span className="text-xs font-semibold text-gray-400">{col.length}</span>
              </div>
              <div className="space-y-2 rounded-xl border border-gray-100 bg-gray-50/70 p-2 min-h-[140px]">
                {col.map((lead) => {
                  const idx = LEAD_STAGES.indexOf(lead.stage);
                  const next = LEAD_STAGES[idx + 1];
                  const fd = followUpDaysLeft(lead.followUpDate);
                  return (
                    <div key={lead.id} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <button onClick={() => openEdit(lead)} className="text-left min-w-0">
                          <p className="font-semibold text-sm text-gray-900 truncate">{lead.name}</p>
                          {lead.prospectiveResident && <p className="text-[11px] text-gray-500 truncate">for {lead.prospectiveResident}</p>}
                        </button>
                        <button onClick={() => removeLead(lead)} className="p-1 text-gray-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="mt-1.5 space-y-0.5 text-[11px] text-gray-500">
                        {lead.contact && <p className="flex items-center gap-1 truncate"><Phone className="w-3 h-3" /> {lead.contact}</p>}
                        {lead.email && <p className="flex items-center gap-1 truncate"><Mail className="w-3 h-3" /> {lead.email}</p>}
                        {lead.source && <p className="text-gray-400">Source: {lead.source}</p>}
                      </div>
                      {lead.followUpDate && (
                        <p className={`mt-1.5 text-[11px] font-semibold ${fd != null && fd < 0 ? "text-rose-600" : fd != null && fd <= 2 ? "text-amber-600" : "text-gray-500"}`}>
                          <CalendarClock className="w-3 h-3 inline mr-1" />Follow-up {new Date(lead.followUpDate).toLocaleDateString()}{fd != null ? ` (${fd < 0 ? `${Math.abs(fd)}d ago` : `${fd}d`})` : ""}
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-1 flex-wrap">
                        <button onClick={() => setFollowUp(lead)} className="text-[11px] px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50">Follow-up</button>
                        {next && next !== "LOST" && <button onClick={() => moveStage(lead, next)} className="text-[11px] px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 inline-flex items-center gap-0.5">{STAGE_META[next].label} <ChevronRight className="w-3 h-3" /></button>}
                        {OPEN_STAGES.includes(lead.stage) && <button onClick={() => moveStage(lead, "LOST")} className="text-[11px] px-2 py-1 rounded text-rose-600 hover:bg-rose-50">Lost</button>}
                        {(lead.stage === "APPLICATION" || lead.stage === "TOURED") && !lead.convertedAdmissionId && <button onClick={() => convert(lead)} className="text-[11px] px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700 inline-flex items-center gap-0.5"><ArrowRight className="w-3 h-3" /> Convert</button>}
                      </div>
                    </div>
                  );
                })}
                {col.length === 0 && <p className="text-center text-[11px] text-gray-300 py-8">No leads</p>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add / edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-blue-600 px-5 py-4 text-white rounded-t-xl">
              <h3 className="font-bold">{editing ? "Edit Lead" : "New Lead"}</h3>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-white/15 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs font-medium text-gray-600 sm:col-span-2">Contact name *<input className={input + " mt-1"} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label className="text-xs font-medium text-gray-600">Prospective resident<input className={input + " mt-1"} value={form.prospectiveResident} onChange={(e) => setForm({ ...form, prospectiveResident: e.target.value })} placeholder="Who's moving in" /></label>
              <label className="text-xs font-medium text-gray-600">Source<select className={input + " mt-1"} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>{LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              <label className="text-xs font-medium text-gray-600">Phone<input className={input + " mt-1"} value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></label>
              <label className="text-xs font-medium text-gray-600">Email<input className={input + " mt-1"} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              <label className="text-xs font-medium text-gray-600">Assigned to<input className={input + " mt-1"} value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} placeholder="Sales rep" /></label>
              <label className="text-xs font-medium text-gray-600">Stage<select className={input + " mt-1"} value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value as LeadStage })}>{LEAD_STAGES.map((s) => <option key={s} value={s}>{STAGE_META[s].label}</option>)}</select></label>
              <label className="text-xs font-medium text-gray-600 sm:col-span-2">Notes<textarea className={input + " mt-1 min-h-[60px]"} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
              <button onClick={() => void saveForm()} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {editing ? "Save" : "Add lead"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, icon: Icon, tone }: { label: string; value: string | number; icon: typeof Users; tone: "blue" | "green" | "teal" | "amber" | "gray" }) {
  const c = { blue: "text-blue-600", green: "text-green-600", teal: "text-teal-600", amber: "text-amber-600", gray: "text-gray-500" }[tone];
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between"><p className="text-xs font-semibold text-gray-500">{label}</p><Icon className={`w-4 h-4 ${c}`} /></div>
      <p className={`text-2xl font-bold mt-1 ${c}`}>{value}</p>
    </div>
  );
}
