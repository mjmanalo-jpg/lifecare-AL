"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Users, CheckCircle2, ClipboardList, AlertTriangle, BellRing,
  Clock, Heart, Sun, Sunset, Moon, ChevronRight, Activity, Inbox, StickyNote, X,
  type LucideIcon,
} from "lucide-react";
import { TASK_NOTES_FIELD, taskNotesOf, withAppendedNote, withoutNote } from "@/lib/taskNotes";
import Swal from "@/lib/swal";
import StatCard from "@/components/portal/widgets/StatCard";
import { useLiveQuery, useStats } from "@/lib/useLiveQuery";
import { adaptTask, adaptResident, adaptIncident, residentName } from "@/lib/adapters";
import { updateRecord } from "@/lib/api";

/* ── Types ───────────────────────────────────────────────────────────── */

type Task = ReturnType<typeof adaptTask>;
type Incident = ReturnType<typeof adaptIncident>;

interface ResidentVM {
  id: string;
  name: string;
  room: string;
  careLevel: string;
  alertsCount: number;
}
interface CallBellVM {
  id: string;
  status: string;
  reason: string;
  room: string;
  resident: string;
  createdAt: string | null;
}

/* ── Static metadata ─────────────────────────────────────────────────── */

const PRIORITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-300",
  high: "bg-orange-100 text-orange-800 border-orange-300",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
  low: "bg-green-100 text-green-800 border-green-300",
};

function shiftFor(hour: number): { key: string; label: string; icon: LucideIcon; greeting: string } {
  if (hour >= 6 && hour < 14) return { key: "MORNING", label: "Morning Shift", icon: Sun, greeting: "Good morning" };
  if (hour >= 14 && hour < 22) return { key: "AFTERNOON", label: "Afternoon Shift", icon: Sunset, greeting: "Good afternoon" };
  return { key: "NIGHT", label: "Night Shift", icon: Moon, greeting: "Good evening" };
}

function relTime(iso: string | null, nowTs: number): string {
  if (!iso) return "—";
  const diff = nowTs - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m ago` : `${h}h ago`;
  return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h ago` : `${Math.floor(h / 24)}d ago`;
}

/* ── Component ───────────────────────────────────────────────────────── */

export default function CaregiverDashboard() {
  const router = useRouter();
  const { data: taskRows, refetch: refetchTasks } = useLiveQuery<Record<string, unknown>>(
    "tasks", { query: "include=resident&take=300", tables: ["Task", "Resident"] }
  );
  const { data: residentRows } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "include=incidents&take=300", tables: ["Resident", "Incident"] }
  );
  const { data: incidentRows } = useLiveQuery<Record<string, unknown>>(
    "incidents", { query: "include=resident&take=100", tables: ["Incident"] }
  );
  const { data: bellRows, refetch: refetchBells } = useLiveQuery<Record<string, unknown>>(
    "call-bells", { query: "include=resident&take=100", tables: ["CallBell"] }
  );
  const { stats, refetch: refetchStats } = useStats();

  // Resolve the signed-in caregiver so the dashboard shows THEIR assigned work.
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => { if (d?.authenticated) setSessionUserId(d.session?.userId ?? null); })
      .catch(() => { /* falls back to showing no assigned tasks */ });
  }, []);
  const { data: staffRows } = useLiveQuery<{ id: string; userId?: string }>(
    "staff", { query: "include=user&take=300", tables: ["Staff"] }
  );
  const myStaffId = useMemo(() => staffRows.find((s) => s.userId === sessionUserId)?.id ?? null, [staffRows, sessionUserId]);

  const tasks = useMemo<Task[]>(() => taskRows.map(adaptTask), [taskRows]);
  // Tasks assigned to THIS caregiver — self-created or delegated by a supervisor.
  const myTasks = useMemo(
    () => (myStaffId ? tasks.filter((t) => (t.raw as { assignedToId?: string } | null | undefined)?.assignedToId === myStaffId) : []),
    [tasks, myStaffId]
  );
  const residents = useMemo<ResidentVM[]>(
    () => residentRows.map((row) => {
      const r = adaptResident(row);
      return { id: r.id, name: r.name, room: r.room, careLevel: r.careLevel, alertsCount: r.alertsCount };
    }),
    [residentRows]
  );
  const incidents = useMemo<Incident[]>(() => incidentRows.map(adaptIncident), [incidentRows]);
  const bells = useMemo<CallBellVM[]>(
    () => bellRows.map((row) => {
      const res = row.resident as { firstName?: string; lastName?: string; roomNumber?: string } | undefined;
      return {
        id: String(row.id),
        status: String(row.status ?? "PENDING"),
        reason: row.reason ? String(row.reason) : "Assistance requested",
        room: res?.roomNumber ?? "—",
        resident: residentName(res),
        createdAt: row.createdAt ? String(row.createdAt) : null,
      };
    }),
    [bellRows]
  );

  // Clock held in state — reading it during render is impure.
  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  const shift = shiftFor(nowTs ? new Date(nowTs).getHours() : 9);
  const ShiftIcon = shift.icon;

  const taskSummary = useMemo(() => {
    const completed = myTasks.filter((t) => t.completed).length;
    const total = myTasks.length;
    return { total, completed, pending: total - completed, pct: total ? Math.round((completed / total) * 100) : 0 };
  }, [myTasks]);

  // The caregiver's own outstanding tasks, highest priority first — this is where
  // a supervisor-assigned task must appear (any priority, not just critical/high).
  // Newest-to-oldest by request date — the most recently assigned/created task is
  // on top (falls back to the due date when a createdAt is missing).
  const reqTime = (t: Task) => {
    const created = (t.raw as { createdAt?: string } | null | undefined)?.createdAt;
    const d = new Date(String(created ?? t.dueDate ?? 0)).getTime();
    return isNaN(d) ? 0 : d;
  };
  const priorityTasks = useMemo(
    () => myTasks
      .filter((t) => !t.completed)
      .sort((a, b) => reqTime(b) - reqTime(a))
      .slice(0, 8),
    [myTasks]
  );
  const attentionResidents = useMemo(
    () => residents.filter((r) => r.alertsCount > 0).sort((a, b) => b.alertsCount - a.alertsCount).slice(0, 6),
    [residents]
  );
  // Newest-first so a freshly recorded risk (pre-fall/fall/etc.) always surfaces
  // in the top-5 instead of being buried below stale, still-unresolved incidents.
  const openIncidents = useMemo(
    () => incidents
      .filter((i) => !i.resolved)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 5),
    [incidents],
  );
  // Active call bells = still needing action, matching the Call Bells "Queue":
  // includes RESPONDED ("Responding"), not just PENDING — so a bell already being
  // responded to still shows here instead of silently dropping off the dashboard.
  const activeBells = useMemo(() => bells.filter((b) => b.status === "PENDING" || b.status === "RESPONDED"), [bells]);

  // Unassigned, still-open tasks — this is where resident-submitted requests
  // (room service, diet substitution) land: they arrive with no assignee and
  // otherwise never surface on a dashboard (only in the Task Assignment board).
  const openRequests = useMemo(
    () => tasks
      .filter((t) => !t.completed && !(t.raw as { assignedToId?: string } | null | undefined)?.assignedToId)
      .sort((a, b) => new Date(String((b.raw as { createdAt?: string } | null)?.createdAt ?? 0)).getTime() - new Date(String((a.raw as { createdAt?: string } | null)?.createdAt ?? 0)).getTime())
      .slice(0, 5),
    [tasks],
  );

  const refreshAll = () => {
    void refetchTasks();
    void refetchBells();
    void refetchStats();
  };


  // Current user's name — stamped on task notes so the nurse / other caregivers
  // know who flagged the blocker.
  const [authorName, setAuthorName] = useState("");
  useEffect(() => {
    fetch("/api/auth/session").then((r) => r.json()).then((d) => setAuthorName(d?.session?.name || d?.workspaces?.user?.name || "")).catch(() => {});
  }, []);

  // Add / remove a caregiver note on a task. Stored on the task, so it reflects
  // live to the nurse, other caregivers, and the resident's QR profile.
  const addTaskNote = async (t: Task) => {
    const { value } = await Swal.fire({
      title: "Add a note to this task",
      input: "textarea",
      inputPlaceholder: "e.g. Can't give the medication yet — resident hasn't eaten (no solid food).",
      inputAttributes: { "aria-label": "Task note", maxlength: "500" },
      showCancelButton: true,
      confirmButtonText: "Add note",
      confirmButtonColor: "#2E4A48",
      inputValidator: (v) => (!v || String(v).trim().length < 2 ? "Please enter a note." : undefined),
    });
    if (!value) return;
    try {
      await updateRecord("tasks", t.id, { [TASK_NOTES_FIELD]: withAppendedNote((t.raw as Record<string, unknown>)?.[TASK_NOTES_FIELD], String(value), authorName) });
      await refetchTasks();
      Swal.fire({ title: "Note added", text: "Visible to the nurse, other caregivers, and on the resident's profile.", icon: "success", timer: 1800, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Couldn't add note", text: err instanceof Error ? err.message : "Try again.", icon: "error" });
    }
  };
  const removeTaskNote = async (t: Task, noteId: string) => {
    try {
      await updateRecord("tasks", t.id, { [TASK_NOTES_FIELD]: withoutNote((t.raw as Record<string, unknown>)?.[TASK_NOTES_FIELD], noteId) });
      await refetchTasks();
    } catch { /* non-fatal */ }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <ShiftIcon className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-500 flex-shrink-0" />
            {shift.greeting} — {shift.label}
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-xs sm:text-sm mt-1">
            <span className="inline-flex items-center gap-1 text-green-600">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live
            </span>
            {nowTs ? new Date(nowTs).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : "—"}
          </p>
        </div>
        <RefreshButton onRefresh={refreshAll} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium self-start" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2 sm:gap-3 lg:gap-4">
        <StatCard title="Assigned Residents" value={String(stats?.residents ?? residents.length)} icon={Users}
          backgroundColor="bg-blue-50" textColor="text-blue-900" iconColor="text-blue-500" />
        <StatCard title="Open Tasks" value={String(stats?.openTasks ?? taskSummary.pending)} icon={ClipboardList}
          backgroundColor="bg-yellow-50" textColor="text-yellow-900" iconColor="text-yellow-500" />
        <StatCard title="Completed" value={String(taskSummary.completed)} icon={CheckCircle2}
          backgroundColor="bg-green-50" textColor="text-green-900" iconColor="text-green-500" />
        <StatCard title="Active Incidents" value={String(stats?.activeIncidents ?? openIncidents.length)} icon={AlertTriangle}
          backgroundColor="bg-red-50" textColor="text-red-900" iconColor="text-red-500" />
        <StatCard title="Call Bells" value={String(stats?.pendingCallBells ?? activeBells.length)} icon={BellRing}
          backgroundColor="bg-purple-50" textColor="text-purple-900" iconColor="text-purple-500" />
      </div>

      {/* Task completion progress */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Activity className="w-4 h-4 text-yellow-500" /> Today&apos;s Task Progress
          </h3>
          <span className="text-sm font-bold text-gray-700">
            {taskSummary.completed}/{taskSummary.total} · {taskSummary.pct}%
          </span>
        </div>
        <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-green-400 to-green-500 transition-all duration-500" style={{ width: `${taskSummary.pct}%` }} />
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 sm:gap-4">
        {/* Priority tasks */}
        <Panel title="Priority Tasks" icon={ClipboardList} className="xl:col-span-2" count={priorityTasks.length}>
          {priorityTasks.length > 0 ? (
            <div className="space-y-2">
              {priorityTasks.map((t) => (
                <div
                  key={t.id}
                  onClick={() => router.push("/caregiver/taskassignment")}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push("/caregiver/taskassignment"); } }}
                  title="Open in Task Board"
                  className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:border-yellow-300 hover:shadow-sm transition cursor-pointer"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-semibold text-gray-900 truncate">{t.title}</h4>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); void addTaskNote(t); }} title="Add note" className="p-1 rounded text-[#C39A3E] hover:bg-amber-100 transition"><StickyNote className="w-4 h-4" /></button>
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${PRIORITY_BADGE[t.priority]}`}>
                          {t.priority.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 truncate">{t.resident} • Room {t.room}</p>
                    {t.dueDate && <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><Clock className="w-3 h-3 flex-shrink-0" /> Due {new Date(t.dueDate).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>}
                    {(() => {
                      const notes = taskNotesOf(t.raw as Record<string, unknown>);
                      if (!notes.length) return null;
                      return (
                        <div className="mt-1.5 space-y-1">
                          {notes.map((n) => (
                            <div key={n.id} className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1">
                              <StickyNote className="w-3.5 h-3.5 text-amber-600 mt-0.5 flex-shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-[11px] leading-snug text-gray-700">{n.text}</p>
                                <p className="text-[10px] text-gray-400">{n.author}{n.at ? ` · ${new Date(n.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}</p>
                              </div>
                              <button onClick={(e) => { e.stopPropagation(); void removeTaskNote(t, n.id); }} title="Remove note" className="text-gray-300 hover:text-red-500 flex-shrink-0"><X className="w-3 h-3" /></button>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="No tasks assigned to you right now. 🎉" />
          )}
        </Panel>

        {/* Right column */}
        <div className="space-y-4">
          <Panel title="Incoming Requests" icon={Inbox} count={openRequests.length}>
            {openRequests.length > 0 ? (
              <div className="space-y-2">
                {openRequests.map((t) => (
                  <div key={t.id} className="p-2.5 rounded-lg bg-amber-50 border border-amber-100">
                    <p className="font-medium text-gray-900 text-sm truncate">{t.title}</p>
                    <p className="text-xs text-gray-600 truncate">{t.resident} • Room {t.room} • Unassigned</p>
                  </div>
                ))}
              </div>
            ) : (
              <Empty text="No new requests." />
            )}
          </Panel>

          <Panel title="Needs Attention" icon={Heart} count={attentionResidents.length}>
            {attentionResidents.length > 0 ? (
              <div className="space-y-2">
                {attentionResidents.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-red-50 border border-red-100">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{r.name}</p>
                      <p className="text-xs text-gray-600">Room {r.room} • {r.careLevel}</p>
                    </div>
                    <span className="px-2 py-1 bg-red-500 text-white rounded-full text-xs font-bold flex-shrink-0">🚨 {r.alertsCount}</span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty text="All residents stable." />
            )}
          </Panel>

          <Panel
            title="Active Call Bells"
            icon={BellRing}
            count={activeBells.length}
            onTitleClick={() => router.push("/caregiver/callbells")}
          >
            {activeBells.length > 0 ? (
              <div className="space-y-2">
                {activeBells.map((b) => (
                  <button
                    type="button"
                    key={b.id}
                    onClick={() => router.push("/caregiver/callbells")}
                    className="w-full text-left flex items-center justify-between gap-2 p-2.5 rounded-lg bg-purple-50 border border-purple-100 hover:bg-purple-100 hover:border-purple-200 transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{b.resident}</p>
                      <p className="text-xs text-gray-600 truncate">Room {b.room} • {b.reason}</p>
                    </div>
                    <span className="text-xs text-purple-700 font-medium flex-shrink-0 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {relTime(b.createdAt, nowTs)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <Empty text="No active call bells." />
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────── */

function Panel({ title, icon: Icon, count, className, onTitleClick, children }: {
  title: string; icon: LucideIcon; count?: number; className?: string;
  onTitleClick?: () => void; children: React.ReactNode;
}) {
  return (
    <div className={`bg-white rounded-lg border border-gray-200 p-3 sm:p-4 ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-3">
        {onTitleClick ? (
          <button
            type="button"
            onClick={onTitleClick}
            className="font-semibold text-gray-900 flex items-center gap-2 group hover:text-purple-700 transition-colors"
            title={`Go to ${title}`}
          >
            <Icon className="w-4 h-4 text-yellow-500" /> {title}
            <ChevronRight className="w-4 h-4 opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
          </button>
        ) : (
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Icon className="w-4 h-4 text-yellow-500" /> {title}
          </h3>
        )}
        {typeof count === "number" && (
          <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full text-xs font-bold">{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-gray-500 py-6 text-center flex items-center justify-center gap-1"><ChevronRight className="w-4 h-4 opacity-0" />{text}</p>;
}
