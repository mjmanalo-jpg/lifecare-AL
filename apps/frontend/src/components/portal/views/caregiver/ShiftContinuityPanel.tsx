"use client";

import { useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Siren, ClipboardList, CalendarClock, ChevronDown, ChevronRight, AlertTriangle, BellRing, HeartPulse, ArrowUpRight } from "lucide-react";
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
  if (["URGENT", "HIGH", "WARNING"].includes(up)) return "bg-orange-100 text-orange-700 border-orange-200";
  if (["ROUTINE", "MEDIUM", "NORMAL", "MODERATE", "INFO"].includes(up)) return "bg-blue-100 text-blue-700 border-blue-200";
  return "bg-gray-100 text-gray-600 border-gray-200";
};

// The "active alerts" the outgoing nurse reviews at handover — abnormal vitals,
// missed/refused meds, flagged incidents, call bells. (Escalations, tasks and
// follow-ups have their own columns, so they're excluded here to avoid dupes.)
const ALERT_TYPES = new Set(["VITAL_ALERT", "INCIDENT_REPORT", "MEDICATION_REMINDER", "CALL_BELL"]);
const SEV_RANK: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
const careLabel = (v: unknown) => String(v ?? "").replace(/_/g, " ").toLowerCase();
const fmt = (v: unknown) => (v ? new Date(String(v)).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const isOverdue = (v: unknown) => Boolean(v) && new Date(String(v)).getTime() < Date.now();

export default function ShiftContinuityPanel() {
  const { data: escRows } = useLiveQuery<Row>("escalations", { query: "include=resident&take=200", tables: ["Escalation", "Resident"] });
  const { data: taskRows } = useLiveQuery<Row>("tasks", { query: "include=resident&take=400", tables: ["Task", "Resident"] });
  const { data: followRows } = useLiveQuery<Row>("follow-ups", { query: "include=resident&take=200", tables: ["FollowUp", "Resident"] });
  const { data: notifRows } = useLiveQuery<Row>("notifications", { query: "take=100", tables: ["Notification"] });
  const { data: residentRows } = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });

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
  const alerts = useMemo(() => {
    const active = notifRows.filter((n) =>
      ALERT_TYPES.has(String(n.type)) && !n.isRead &&
      (!n.snoozedUntil || new Date(String(n.snoozedUntil)).getTime() < Date.now()),
    );
    // Dedup by the entity the alert points at (keep the most recent).
    const byKey = new Map<string, Row>();
    for (const n of active) {
      const key = String(n.relatedEntityId ?? n.id);
      const prev = byKey.get(key);
      if (!prev || new Date(String(n.createdAt)).getTime() > new Date(String(prev.createdAt)).getTime()) byKey.set(key, n);
    }
    return [...byKey.values()].sort((a, b) =>
      (SEV_RANK[String(a.severity).toUpperCase()] ?? 2) - (SEV_RANK[String(b.severity).toUpperCase()] ?? 2)
      || new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime(),
    );
  }, [notifRows]);
  const criticalResidents = useMemo(
    () => residentRows
      .filter((r) => ["CRITICAL", "HIGH"].includes(String(r.currentAcuityLevel)) && String(r.status ?? "ACTIVE") !== "DISCHARGED")
      .sort((a, b) => (String(a.currentAcuityLevel) === "CRITICAL" ? 0 : 1) - (String(b.currentAcuityLevel) === "CRITICAL" ? 0 : 1)),
    [residentRows],
  );

  // Actionable carry-over drives the "open" count; critical residents are a
  // watch-list (context to hand over), not items to clear, so they're excluded.
  const total = escalations.length + tasks.length + followups.length + alerts.length;
  const [open, setOpen] = useState(true);

  // Each column deep-links to its module tab. The role prefix (nurse/caregiver/…)
  // is read from the current path so this works in every portal that mounts it.
  const router = useRouter();
  const pathname = usePathname();
  const roleSeg = pathname?.split("/").filter(Boolean)[0] || "nurse";
  const residentTab = roleSeg === "caregiver" ? "residents" : "records";
  const go = (seg: string) => router.push(`/${roleSeg}/${seg}`);
  // Alerts are a mixed feed → route each to the most relevant tab by its type.
  const alertDest = (type: string) => {
    switch (type) {
      case "INCIDENT_REPORT": return "incidents";
      case "MEDICATION_REMINDER": return "mar";
      case "CALL_BELL": return roleSeg === "caregiver" ? "callbells" : residentTab;
      default: return residentTab; // VITAL_ALERT and anything else → the resident record
    }
  };

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 px-4 sm:px-5 pb-4">
          <Section title="Active Alerts" icon={BellRing} tint="text-rose-500" count={alerts.length} onOpen={() => go(residentTab)}>
            {alerts.map((n) => (
              <Item key={String(n.id)} priority={String(n.severity ?? "INFO")} who={String(n.message ?? "")} main={String(n.title ?? "Alert")} meta={fmt(n.createdAt)} overdue={String(n.severity).toUpperCase() === "CRITICAL"} onClick={() => go(alertDest(String(n.type)))} />
            ))}
          </Section>
          <Section title="Open Escalations" icon={Siren} tint="text-red-500" count={escalations.length} onOpen={() => go("escalations")}>
            {escalations.map((e) => (
              <Item key={String(e.id)} priority={String(e.priority)} who={`${rname(e)} · Rm ${rroom(e)}`} main={String(e.situation ?? "Escalation")} meta={`${String(e.status)} · ${fmt(e.createdAt)}`} onClick={() => go("escalations")} />
            ))}
          </Section>
          <Section title="Pending Tasks" icon={ClipboardList} tint="text-blue-500" count={tasks.length} onOpen={() => go("taskboard")}>
            {tasks.map((t) => (
              <Item key={String(t.id)} priority={String(t.priority)} who={`${rname(t)} · Rm ${rroom(t)}`} main={String(t.title ?? "Task")} meta={`${isOverdue(t.dueDate) ? "OVERDUE · " : "Due "}${fmt(t.dueDate)}`} overdue={isOverdue(t.dueDate)} onClick={() => go("taskboard")} />
            ))}
          </Section>
          <Section title="Follow-ups Due" icon={CalendarClock} tint="text-purple-500" count={followups.length} onOpen={() => go("followups")}>
            {followups.map((f) => (
              <Item key={String(f.id)} priority={String(f.priority)} who={`${rname(f)} · Rm ${rroom(f)}`} main={String(f.type ?? "Follow-up")} meta={`${isOverdue(f.dueDate) || f.status === "OVERDUE" ? "OVERDUE · " : "Due "}${fmt(f.dueDate)}`} overdue={isOverdue(f.dueDate) || f.status === "OVERDUE"} onClick={() => go("followups")} />
            ))}
          </Section>
          <Section title="Critical Residents" icon={HeartPulse} tint="text-red-600" count={criticalResidents.length} onOpen={() => go(residentTab)}>
            {criticalResidents.map((r) => (
              <Item
                key={String(r.id)}
                priority={String(r.currentAcuityLevel ?? "HIGH")}
                main={`${String(r.firstName ?? "")} ${String(r.lastName ?? "")}`.trim() || "Resident"}
                who={`Rm ${String(r.roomNumber ?? "—")} · ${careLabel(r.careLevel)} care`}
                meta={r.dnrStatus ? "DNR" : careLabel(r.codeStatus) || "full code"}
                overdue={String(r.currentAcuityLevel).toUpperCase() === "CRITICAL"}
                onClick={() => go(residentTab)}
              />
            ))}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, icon: Icon, tint, count, onOpen, children }: { title: string; icon: typeof Siren; tint: string; count: number; onOpen?: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className="group w-full flex items-center justify-between px-3 py-2 border-b border-gray-100 text-left enabled:hover:bg-gray-50 transition"
        title={onOpen ? `Open ${title}` : undefined}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-800"><Icon className={`w-4 h-4 ${tint}`} /> {title}</span>
        <span className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-gray-500">{count}</span>
          {onOpen && <ArrowUpRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 transition" />}
        </span>
      </button>
      <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
        {count === 0 ? <p className="px-3 py-4 text-center text-xs text-gray-400">Nothing outstanding.</p> : children}
      </div>
    </div>
  );
}

function Item({ priority, who, main, meta, overdue, onClick }: { priority: string; who: string; main: string; meta: string; overdue?: boolean; onClick?: () => void }) {
  const clickable = Boolean(onClick);
  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick!(); } } : undefined}
      className={`px-3 py-2 ${clickable ? "cursor-pointer hover:bg-gray-50 focus:bg-gray-50 focus:outline-none transition" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-900 line-clamp-2">{main}</p>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${priorityBadge(priority)}`}>{priority.toUpperCase()}</span>
      </div>
      <p className="text-xs text-gray-500 mt-0.5">{who}</p>
      <p className={`text-[11px] mt-0.5 ${overdue ? "font-semibold text-red-600" : "text-gray-400"}`}>{meta}</p>
    </div>
  );
}
