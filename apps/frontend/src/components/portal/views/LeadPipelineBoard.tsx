"use client";

import { useMemo, useState } from "react";
import {
  Plus, X, Trash2, CalendarClock, UserPlus, TrendingUp, Users, Phone, Mail, Loader2,
  ChevronRight, Search, LayoutGrid, ListChecks, MapPin, BarChart3, Percent, GripVertical,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useCrmLeads } from "@/lib/useCrmLeads";
import {
  LEAD_STAGES, OPEN_STAGES, STAGE_META, LEAD_SOURCES,
  followUpDaysLeft, nextFollowUpDate, dueBucket, type Lead, type LeadStage,
} from "@/lib/crmLeads";
import { composeName } from "@/lib/names";
import LeadDetailDrawer from "@/components/portal/views/crm/LeadDetailDrawer";
import LeadFollowUpsBoard from "@/components/portal/views/crm/LeadFollowUpsBoard";
import LeadToursBoard from "@/components/portal/views/crm/LeadToursBoard";
import LeadAnalyticsBoard from "@/components/portal/views/crm/LeadAnalyticsBoard";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white";
// No `w-full` — for selects/inputs whose width is set by flex/explicit classes.
const selectCls = "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white";
type View = "pipeline" | "followups" | "tours" | "analytics";
const TABS: { key: View; label: string; icon: typeof LayoutGrid }[] = [
  { key: "pipeline", label: "Pipeline", icon: LayoutGrid },
  { key: "followups", label: "Follow-ups", icon: ListChecks },
  { key: "tours", label: "Tours", icon: MapPin },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
];
const NEW_EMPTY = { name: "", residentFirstName: "", residentLastName: "", source: "Website", contact: "", email: "", assignedTo: "" };

/** CRM workspace — a tabbed shell over the pipeline, follow-ups, tours and
 *  analytics. Shared by the CRM role, Facility Admin and Super Admin. */
export default function LeadPipelineBoard({ initialView = "pipeline" }: { initialView?: View }) {
  const api = useCrmLeads();
  const [view, setView] = useState<View>(initialView);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  // Pipeline filters.
  const [q, setQ] = useState("");
  const [sourceF, setSourceF] = useState("");
  const [assigneeF, setAssigneeF] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dragId, setDragId] = useState<string | null>(null);

  // New-lead modal.
  const [showNew, setShowNew] = useState(false);
  const [nf, setNf] = useState(NEW_EMPTY);
  const [saving, setSaving] = useState(false);

  const assignees = useMemo(() => [...new Set(api.leads.map((l) => l.assignedTo).filter(Boolean) as string[])].sort(), [api.leads]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return api.leads.filter((l) => {
      if (sourceF && (l.source || "Other") !== sourceF) return false;
      if (assigneeF && l.assignedTo !== assigneeF) return false;
      if (overdueOnly && dueBucket(nextFollowUpDate(l)) !== "overdue") return false;
      if (needle && !`${l.name} ${l.prospectiveResident || ""} ${l.contact || ""} ${l.email || ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [api.leads, q, sourceF, assigneeF, overdueOnly]);

  const stats = useMemo(() => {
    const open = api.leads.filter((l) => OPEN_STAGES.includes(l.stage));
    const won = api.leads.filter((l) => l.stage === "MOVE_IN").length;
    const lost = api.leads.filter((l) => l.stage === "LOST").length;
    const due = api.leads.filter((l) => OPEN_STAGES.includes(l.stage) && dueBucket(nextFollowUpDate(l)) === "overdue").length;
    return { open: open.length, won, conversion: won + lost ? Math.round((won / (won + lost)) * 100) : 0, due };
  }, [api.leads]);

  const saveNew = async () => {
    if (!nf.name.trim()) { Swal.fire({ title: "Contact name required", icon: "warning" }); return; }
    setSaving(true);
    try {
      const created = await api.addLead({
        name: nf.name, contact: nf.contact, email: nf.email, source: nf.source, assignedTo: nf.assignedTo, stage: "NEW",
        residentFirstName: nf.residentFirstName, residentLastName: nf.residentLastName,
        prospectiveResident: composeName(nf.residentFirstName, "", nf.residentLastName), notes: "",
      });
      setShowNew(false); setNf(NEW_EMPTY); setDrawerId(created.id);
    } finally { setSaving(false); }
  };

  const removeLead = async (lead: Lead) => {
    const r = await Swal.fire({ title: "Delete lead?", text: lead.name, icon: "warning", showCancelButton: true, confirmButtonColor: "#dc2626" });
    if (r.isConfirmed) await api.deleteLead(lead.id);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 flex items-center gap-2"><Users className="w-7 h-7 text-blue-600" /> CRM Workspace</h1>
          <p className="text-slate-500 text-sm">Leads from first inquiry to move-in — pipeline, follow-ups, tours and growth analytics.</p>
        </div>
        <button onClick={() => { setNf(NEW_EMPTY); setShowNew(true); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 self-start shadow-sm"><Plus className="w-4 h-4" /> New Lead</button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => {
          const active = view === t.key;
          return (
            <button key={t.key} onClick={() => setView(t.key)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition ${active ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {view === "pipeline" && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Open Pipeline" value={stats.open} icon={TrendingUp} tone="text-blue-600" />
            <Kpi label="Moved In (Won)" value={stats.won} icon={UserPlus} tone="text-emerald-600" />
            <Kpi label="Conversion" value={`${stats.conversion}%`} icon={Percent} tone="text-teal-600" />
            <Kpi label="Overdue Follow-ups" value={stats.due} icon={CalendarClock} tone={stats.due ? "text-amber-600" : "text-slate-500"} />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads…" className={input + " pl-9"} />
            </div>
            <select value={sourceF} onChange={(e) => setSourceF(e.target.value)} className={selectCls}><option value="">All sources</option>{LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            {assignees.length > 0 && <select value={assigneeF} onChange={(e) => setAssigneeF(e.target.value)} className={selectCls}><option value="">All reps</option>{assignees.map((s) => <option key={s} value={s}>{s}</option>)}</select>}
            <button onClick={() => setOverdueOnly((v) => !v)} className={`text-sm font-medium px-3 py-2 rounded-lg border ${overdueOnly ? "bg-amber-50 border-amber-300 text-amber-700" : "border-slate-300 text-slate-500 hover:bg-slate-50"}`}>Overdue only</button>
            {(q || sourceF || assigneeF || overdueOnly) && <button onClick={() => { setQ(""); setSourceF(""); setAssigneeF(""); setOverdueOnly(false); }} className="text-sm text-slate-500 hover:text-slate-800 px-2">Clear</button>}
          </div>

          {/* Kanban */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 items-start">
            {LEAD_STAGES.map((stage) => {
              const col = filtered.filter((l) => l.stage === stage);
              const isCollapsed = !!collapsed[stage];
              return (
                <div key={stage}
                  onDragOver={(e) => { if (dragId) e.preventDefault(); }}
                  onDrop={() => { const lead = api.leads.find((l) => l.id === dragId); if (lead && lead.stage !== stage) api.moveStage(lead, stage); setDragId(null); }}
                  className={`flex flex-col rounded-xl border bg-slate-50/70 overflow-hidden transition ${dragId ? "border-dashed border-blue-300" : "border-slate-200"}`}>
                  <button type="button" onClick={() => setCollapsed((c) => ({ ...c, [stage]: !c[stage] }))} aria-expanded={!isCollapsed}
                    className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-slate-100 bg-white/70 hover:bg-slate-50 text-left">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <ChevronRight className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STAGE_META[stage].badge}`}>{STAGE_META[stage].label}</span>
                    </span>
                    <span className={`min-w-[1.5rem] text-center text-xs font-bold px-1.5 py-0.5 rounded-full ${col.length ? "bg-slate-200 text-slate-700" : "bg-slate-100 text-slate-400"}`}>{col.length}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="flex flex-1 flex-col gap-2 p-2 min-h-[120px]">
                      {col.map((lead) => {
                        const fu = nextFollowUpDate(lead);
                        const fd = followUpDaysLeft(fu);
                        const adm = lead.convertedAdmissionId ? api.admissionById.get(lead.convertedAdmissionId) : undefined;
                        const openCount = (lead.tasks ?? []).filter((t) => !t.done).length;
                        return (
                          <div key={lead.id} draggable onDragStart={() => setDragId(lead.id)} onDragEnd={() => setDragId(null)}
                            onClick={() => setDrawerId(lead.id)}
                            className={`group rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:shadow-md hover:border-blue-300 cursor-pointer transition ${dragId === lead.id ? "opacity-50" : ""}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-semibold text-sm text-slate-900 truncate">{lead.name}</p>
                                {lead.prospectiveResident && <p className="text-[11px] text-slate-500 truncate">for {lead.prospectiveResident}</p>}
                              </div>
                              <div className="flex items-center gap-0.5 shrink-0">
                                <GripVertical className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover:opacity-100" />
                                <button onClick={(e) => { e.stopPropagation(); removeLead(lead); }} className="p-1 text-slate-300 hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
                              </div>
                            </div>
                            <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-500">
                              {lead.contact && <p className="flex items-center gap-1 truncate"><Phone className="w-3 h-3" /> {lead.contact}</p>}
                              {lead.email && <p className="flex items-center gap-1 truncate"><Mail className="w-3 h-3" /> {lead.email}</p>}
                              {lead.source && <p className="text-slate-400">Source: {lead.source}</p>}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {lead.tourDate && !lead.tourOutcome && <Chip icon={MapPin} cls="bg-sky-50 text-sky-700">{new Date(lead.tourDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</Chip>}
                              {openCount > 0 && <Chip icon={ListChecks} cls="bg-slate-100 text-slate-600">{openCount}</Chip>}
                              {fu && <Chip icon={CalendarClock} cls={fd != null && fd < 0 ? "bg-rose-50 text-rose-600" : fd != null && fd <= 2 ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}>{fd != null && fd < 0 ? `${Math.abs(fd)}d overdue` : fd === 0 ? "today" : `${fd}d`}</Chip>}
                              {adm && <Chip icon={UserPlus} cls="bg-amber-50 text-amber-700">{String(adm.status) === "COMPLETED" ? "Admitted" : "In admission"}</Chip>}
                            </div>
                            {/* Quick status change — no need to open the drawer. */}
                            <select value={lead.stage}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => { e.stopPropagation(); const s = e.target.value as LeadStage; if (s !== lead.stage) api.moveStage(lead, s); }}
                              className="mt-2 w-full rounded-md border border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-600 py-1 px-1.5 outline-none focus:border-blue-400 cursor-pointer">
                              {LEAD_STAGES.map((s) => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
                            </select>
                          </div>
                        );
                      })}
                      {col.length === 0 && <div className="m-auto py-6 text-[11px] font-medium text-slate-400">Drop leads here</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {view === "followups" && <LeadFollowUpsBoard api={api} onOpenLead={setDrawerId} />}
      {view === "tours" && <LeadToursBoard api={api} onOpenLead={setDrawerId} />}
      {view === "analytics" && <LeadAnalyticsBoard api={api} />}

      {/* Detail drawer */}
      {drawerId && <LeadDetailDrawer leadId={drawerId} api={api} onClose={() => setDrawerId(null)} />}

      {/* New-lead modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-blue-600 px-5 py-4 text-white rounded-t-xl">
              <h3 className="font-bold">New Lead</h3>
              <button onClick={() => setShowNew(false)} className="p-1 hover:bg-white/15 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-3">
              <label className="text-xs font-medium text-slate-600 col-span-2">Contact name *<input autoFocus className={input + " mt-1"} value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} /></label>
              <label className="text-xs font-medium text-slate-600">Resident first<input className={input + " mt-1"} value={nf.residentFirstName} onChange={(e) => setNf({ ...nf, residentFirstName: e.target.value })} placeholder="Who's moving in" /></label>
              <label className="text-xs font-medium text-slate-600">Resident last<input className={input + " mt-1"} value={nf.residentLastName} onChange={(e) => setNf({ ...nf, residentLastName: e.target.value })} /></label>
              <label className="text-xs font-medium text-slate-600">Phone<input className={input + " mt-1"} value={nf.contact} onChange={(e) => setNf({ ...nf, contact: e.target.value })} /></label>
              <label className="text-xs font-medium text-slate-600">Email<input className={input + " mt-1"} value={nf.email} onChange={(e) => setNf({ ...nf, email: e.target.value })} /></label>
              <label className="text-xs font-medium text-slate-600">Source<select className={input + " mt-1"} value={nf.source} onChange={(e) => setNf({ ...nf, source: e.target.value })}>{LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              <label className="text-xs font-medium text-slate-600">Assigned to<input list="crm-reps" className={input + " mt-1"} value={nf.assignedTo} onChange={(e) => setNf({ ...nf, assignedTo: e.target.value })} placeholder="Select or type a rep" /></label>
              <datalist id="crm-reps">{assignees.map((a) => <option key={a} value={a} />)}</datalist>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
              <button onClick={() => void saveNew()} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Create &amp; open</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, icon: Icon, tone }: { label: string; value: string | number; icon: typeof Users; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between"><p className="text-xs font-semibold text-slate-500">{label}</p><Icon className={`w-4 h-4 ${tone}`} /></div>
      <p className={`text-2xl font-bold mt-1 ${tone}`}>{value}</p>
    </div>
  );
}
function Chip({ icon: Icon, cls, children }: { icon: typeof Users; cls: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`}><Icon className="w-3 h-3" />{children}</span>;
}
