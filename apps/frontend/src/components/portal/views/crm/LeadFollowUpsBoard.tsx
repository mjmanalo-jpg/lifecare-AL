"use client";

import { useMemo } from "react";
import { Circle, PhoneCall, Send, MapPin, Check, CalendarClock, ChevronRight, ListChecks } from "lucide-react";
import Swal from "@/lib/swal";
import { followUpQueue, type DueBucket, type TaskType } from "@/lib/crmLeads";
import type { CrmApi } from "@/lib/useCrmLeads";
import MonthCalendar, { type CalItem } from "@/components/portal/views/crm/MonthCalendar";

const TASK_ICON: Record<TaskType, typeof PhoneCall> = { call: PhoneCall, email: Send, visit: MapPin, todo: Check };
const BUCKET_KPI: { key: DueBucket; label: string; tone: string }[] = [
  { key: "overdue", label: "Overdue", tone: "text-rose-600" },
  { key: "today", label: "Today", tone: "text-amber-600" },
  { key: "upcoming", label: "Upcoming", tone: "text-slate-600" },
];
const bucketPill = (b: DueBucket) =>
  b === "overdue" ? "bg-rose-100 text-rose-700 hover:bg-rose-200"
  : b === "today" ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
  : "bg-sky-100 text-sky-800 hover:bg-sky-200";

/** Cross-lead follow-up work — KPI counts, an overdue action strip, and a month
 *  calendar plotting every open follow-up on its due date. */
export default function LeadFollowUpsBoard({ api, onOpenLead }: { api: CrmApi; onOpenLead: (id: string) => void }) {
  const queue = useMemo(() => followUpQueue(api.leads), [api.leads]);
  const overdue = queue.filter((q) => q.bucket === "overdue");
  const count = (b: DueBucket) => queue.filter((q) => q.bucket === b || (b === "upcoming" && q.bucket === "none")).length;

  const items = useMemo<CalItem[]>(() => queue.map(({ lead, task, bucket }) => ({
    id: task.id,
    date: task.dueDate,
    label: task.title,
    className: bucketPill(bucket),
    title: `${lead.name} · ${task.title}`,
    onClick: () => onOpenLead(lead.id),
  })), [queue, onOpenLead]);

  const reschedule = async (leadId: string, taskId: string, current: string) => {
    const { value } = await Swal.fire({ title: "Reschedule follow-up", input: "date", inputValue: current?.slice(0, 10) || "", showCancelButton: true, confirmButtonText: "Save" });
    if (!value) return;
    await api.rescheduleTask(leadId, taskId, String(value));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {BUCKET_KPI.map((b) => (
          <div key={b.key} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold text-slate-500">{b.label}</p>
            <p className={`text-2xl font-bold mt-1 ${b.tone}`}>{count(b.key)}</p>
          </div>
        ))}
      </div>

      {overdue.length > 0 && (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-rose-600 mb-2">Overdue · {overdue.length}</h3>
          <div className="rounded-xl border border-rose-200 bg-white divide-y divide-slate-100">
            {overdue.map(({ lead, task }) => {
              const Icon = TASK_ICON[task.type];
              return (
                <div key={task.id} className="flex items-center gap-3 px-4 py-2.5">
                  <button onClick={() => api.toggleTask(lead.id, task.id)} className="text-slate-300 hover:text-emerald-600 shrink-0" title="Mark done"><Circle className="w-5 h-5" /></button>
                  <Icon className="w-4 h-4 text-slate-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">{task.title}</p>
                    <p className="text-xs text-slate-500 truncate">{lead.name}{lead.prospectiveResident ? ` · for ${lead.prospectiveResident}` : ""}{lead.contact ? ` · ${lead.contact}` : ""}</p>
                  </div>
                  <span className="text-xs font-medium text-rose-500 shrink-0">{new Date(task.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                  <button onClick={() => reschedule(lead.id, task.id, task.dueDate)} className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 shrink-0">Snooze</button>
                  <button onClick={() => onOpenLead(lead.id)} className="p-1 text-slate-400 hover:text-blue-600 shrink-0" title="Open lead"><ChevronRight className="w-4 h-4" /></button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <MonthCalendar items={items} icon={<ListChecks className="w-4 h-4 text-blue-600" />} />

      {queue.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white py-10 text-center">
          <CalendarClock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-500">No follow-ups scheduled</p>
          <p className="text-xs text-slate-400">Add a follow-up from any lead to build your call list.</p>
        </div>
      )}
    </div>
  );
}
