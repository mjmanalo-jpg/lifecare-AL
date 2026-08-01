"use client";

import { useMemo, useState } from "react";
import { Siren, ClipboardList, CalendarClock, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";

/**
 * Shift Continuity & Carry-Over — the unresolved-items checklist for handover.
 * Live-aggregates the open work that must carry to the next shift: SBAR
 * escalations still open, tasks pending/overdue, and follow-ups due/overdue —
 * each with priority and due time. Read-only (items are actioned in their own
 * boards); this is the endorsement checklist so nothing falls through.
 */

type Row = Record<string, unknown>;
const rname = (r: Row | undefined) => {
  const res = (r?.resident ?? {}) as Row;
  const n = `${(res.firstName as string) ?? ""} ${(res.lastName as string) ?? ""}`.trim();
  return n || "—";
};
const rroom = (r: Row | undefined) => ((r?.resident as Row)?.roomNumber as string) ?? "—";

const PRIORITY_RANK: Record<string, number> = { EMERGENCY: 0, URGENT: 1, CRITICAL: 0, HIGH: 1, ROUTINE: 3, MEDIUM: 3, NORMAL: 3, LOW: 4 };
const priorityBadge = (p: string) => {
  const up = p.toUpperCase();
  if (["EMERGENCY", "CRITICAL"].includes(up)) return "bg-red-100 text-red-700 border-red-200";
  if (["URGENT", "HIGH"].includes(up)) return "bg-orange-100 text-orange-700 border-orange-200";
  if (["ROUTINE", "MEDIUM", "NORMAL"].includes(up)) return "bg-blue-100 text-blue-700 border-blue-200";
  return "bg-gray-100 text-gray-600 border-gray-200";
};
const fmt = (v: unknown) => (v ? new Date(String(v)).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const isOverdue = (v: unknown) => Boolean(v) && new Date(String(v)).getTime() < Date.now();

export default function ShiftContinuityPanel() {
  const { data: escRows } = useLiveQuery<Row>("escalations", { query: "include=resident&take=200", tables: ["Escalation", "Resident"] });
  const { data: taskRows } = useLiveQuery<Row>("tasks", { query: "include=resident&take=400", tables: ["Task", "Resident"] });
  const { data: followRows } = useLiveQuery<Row>("follow-ups", { query: "include=resident&take=200", tables: ["FollowUp", "Resident"] });

  const escalations = useMemo(
    () => escRows.filter((e) => !["RESOLVED", "CANCELLED"].includes(String(e.status)))
      .sort((a, b) => (PRIORITY_RANK[String(a.priority)] ?? 3) - (PRIORITY_RANK[String(b.priority)] ?? 3)),
    [escRows],
  );
  const tasks = useMemo(
    () => taskRows.filter((t) => ["PENDING", "IN_PROGRESS"].includes(String(t.status)))
      .sort((a, b) => Number(isOverdue(b.dueDate)) - Number(isOverdue(a.dueDate)) || (PRIORITY_RANK[String(a.priority)] ?? 3) - (PRIORITY_RANK[String(b.priority)] ?? 3)),
    [taskRows],
  );
  const followups = useMemo(
    () => followRows.filter((f) => ["PENDING", "SCHEDULED", "OVERDUE"].includes(String(f.status)))
      .sort((a, b) => Number(isOverdue(b.dueDate)) - Number(isOverdue(a.dueDate))),
    [followRows],
  );

  const total = escalations.length + tasks.length + followups.length;
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 text-left">
        <div className="flex items-center gap-2.5">
          {open ? <ChevronDown className="w-4 h-4 text-amber-600" /> : <ChevronRight className="w-4 h-4 text-amber-600" />}
          <AlertTriangle className="w-5 h-5 text-amber-600" />
          <div>
            <h3 className="text-sm sm:text-base font-bold text-amber-900">Shift Continuity — Carry-Over &amp; Unresolved</h3>
            <p className="text-[11px] sm:text-xs text-amber-700">Review before sign-off — these carry to the next shift.</p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${total > 0 ? "bg-amber-500 text-white" : "bg-green-500 text-white"}`}>
          {total > 0 ? `${total} open` : "All clear"}
        </span>
      </button>

      {open && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 px-4 sm:px-5 pb-4">
          <Section title="Open Escalations" icon={Siren} tint="text-red-500" count={escalations.length}>
            {escalations.map((e) => (
              <Item key={String(e.id)} priority={String(e.priority)} who={`${rname(e)} · Rm ${rroom(e)}`} main={String(e.situation ?? "Escalation")} meta={`${String(e.status)} · ${fmt(e.createdAt)}`} />
            ))}
          </Section>
          <Section title="Pending Tasks" icon={ClipboardList} tint="text-blue-500" count={tasks.length}>
            {tasks.map((t) => (
              <Item key={String(t.id)} priority={String(t.priority)} who={`${rname(t)} · Rm ${rroom(t)}`} main={String(t.title ?? "Task")} meta={`${isOverdue(t.dueDate) ? "OVERDUE · " : "Due "}${fmt(t.dueDate)}`} overdue={isOverdue(t.dueDate)} />
            ))}
          </Section>
          <Section title="Follow-ups Due" icon={CalendarClock} tint="text-purple-500" count={followups.length}>
            {followups.map((f) => (
              <Item key={String(f.id)} priority={String(f.priority)} who={`${rname(f)} · Rm ${rroom(f)}`} main={String(f.type ?? "Follow-up")} meta={`${isOverdue(f.dueDate) || f.status === "OVERDUE" ? "OVERDUE · " : "Due "}${fmt(f.dueDate)}`} overdue={isOverdue(f.dueDate) || f.status === "OVERDUE"} />
            ))}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, icon: Icon, tint, count, children }: { title: string; icon: typeof Siren; tint: string; count: number; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-800"><Icon className={`w-4 h-4 ${tint}`} /> {title}</span>
        <span className="text-xs font-bold text-gray-500">{count}</span>
      </div>
      <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
        {count === 0 ? <p className="px-3 py-4 text-center text-xs text-gray-400">Nothing outstanding.</p> : children}
      </div>
    </div>
  );
}

function Item({ priority, who, main, meta, overdue }: { priority: string; who: string; main: string; meta: string; overdue?: boolean }) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-900 line-clamp-2">{main}</p>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${priorityBadge(priority)}`}>{priority.toUpperCase()}</span>
      </div>
      <p className="text-xs text-gray-500 mt-0.5">{who}</p>
      <p className={`text-[11px] mt-0.5 ${overdue ? "font-semibold text-red-600" : "text-gray-400"}`}>{meta}</p>
    </div>
  );
}
