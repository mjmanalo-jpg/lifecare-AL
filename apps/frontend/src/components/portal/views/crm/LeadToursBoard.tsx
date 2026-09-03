"use client";

import { useMemo } from "react";
import { MapPin, ChevronRight, AlertCircle } from "lucide-react";
import { STAGE_META, type Lead } from "@/lib/crmLeads";
import type { CrmApi } from "@/lib/useCrmLeads";
import MonthCalendar, { type CalItem } from "@/components/portal/views/crm/MonthCalendar";

const OUTCOMES = [
  { key: "completed", label: "Completed", cls: "bg-emerald-600 hover:bg-emerald-700 text-white" },
  { key: "no_show", label: "No-show", cls: "bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200" },
  { key: "rescheduled", label: "Reschedule", cls: "bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200" },
] as const;

const pillCls = (l: Lead) =>
  l.tourOutcome === "completed" ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
  : l.tourOutcome === "no_show" ? "bg-rose-100 text-rose-700 hover:bg-rose-200"
  : l.tourOutcome === "rescheduled" ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
  : "bg-sky-100 text-sky-800 hover:bg-sky-200";

/** Tour management — a month calendar of scheduled tours + a strip for tours
 *  that have happened and still need an outcome recorded. */
export default function LeadToursBoard({ api, onOpenLead }: { api: CrmApi; onOpenLead: (id: string) => void }) {
  const tours = useMemo(() => api.leads.filter((l) => l.tourDate), [api.leads]);
  const awaiting = useMemo(
    () => tours.filter((l) => !l.tourOutcome && new Date(l.tourDate!).getTime() < Date.now())
      .sort((a, b) => (a.tourDate! < b.tourDate! ? 1 : -1)),
    [tours],
  );
  const items = useMemo<CalItem[]>(() => tours.map((l) => ({
    id: l.id,
    date: l.tourDate!,
    label: `${new Date(l.tourDate!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ${l.prospectiveResident || l.name}`,
    className: pillCls(l),
    title: `${l.prospectiveResident || l.name} · ${STAGE_META[l.stage].label}`,
    onClick: () => onOpenLead(l.id),
  })), [tours, onOpenLead]);

  return (
    <div className="space-y-4">
      {awaiting.length > 0 && (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-amber-600 mb-2 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Awaiting outcome · {awaiting.length}</h3>
          <div className="rounded-xl border border-amber-200 bg-white divide-y divide-slate-100">
            {awaiting.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800 truncate">{l.prospectiveResident || l.name}</p>
                  <p className="text-xs text-slate-500 truncate">{new Date(l.tourDate!).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{l.contact ? ` · ${l.contact}` : ""}</p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {OUTCOMES.map((o) => <button key={o.key} onClick={() => api.setTourOutcome(l.id, o.key)} className={`text-xs font-semibold px-2 py-1 rounded ${o.cls}`}>{o.label}</button>)}
                </div>
                <button onClick={() => onOpenLead(l.id)} className="p-1 text-slate-400 hover:text-blue-600 shrink-0"><ChevronRight className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </section>
      )}

      <MonthCalendar items={items} icon={<MapPin className="w-4 h-4 text-blue-600" />} />

      {tours.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white py-10 text-center">
          <MapPin className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-500">No tours scheduled</p>
          <p className="text-xs text-slate-400">Schedule a tour from any lead to see it on the calendar.</p>
        </div>
      )}
    </div>
  );
}
