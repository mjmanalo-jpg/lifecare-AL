"use client";

import { useMemo, useState, useEffect } from "react";
import {
  Users, CheckCircle2, ClipboardList, AlertTriangle, BellRing, RefreshCw,
  Clock, Heart, Sun, Sunset, Moon, ChevronRight, Activity, Inbox,
  type LucideIcon,
} from "lucide-react";
import Swal from "sweetalert2";
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
const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-yellow-100 text-yellow-700",
  low: "bg-blue-100 text-blue-700",
};
const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

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
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/* ── Component ───────────────────────────────────────────────────────── */

export default function CaregiverDashboard() {
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
  const priorityTasks = useMemo(
    () => myTasks
      .filter((t) => !t.completed)
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
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
  const pendingBells = useMemo(() => bells.filter((b) => b.status === "PENDING"), [bells]);

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

  const toggleTask = async (t: Task) => {
    try {
      await updateRecord("tasks", t.id, {
        status: t.completed ? "PENDING" : "COMPLETED",
        completedAt: t.completed ? null : new Date().toISOString(),
      });
      await refetchTasks();
    } catch (err) {
      Swal.fire({ title: "Update Failed", text: err instanceof Error ? err.message : "Could not update task.", icon: "error" });
    }
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
        <button
          onClick={refreshAll}
          className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium self-start"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
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
        <StatCard title="Call Bells" value={String(stats?.pendingCallBells ?? pendingBells.length)} icon={BellRing}
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
                <div key={t.id} className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:border-yellow-300 hover:shadow-sm transition">
                  <input type="checkbox" checked={t.completed} onChange={() => void toggleTask(t)}
                    className="mt-1 w-5 h-5 rounded cursor-pointer flex-shrink-0" title="Mark complete" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-semibold text-gray-900 truncate">{t.title}</h4>
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold border flex-shrink-0 ${PRIORITY_BADGE[t.priority]}`}>
                        {t.priority.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 truncate">{t.resident} • Room {t.room}{t.dueTime ? ` • ${t.dueTime}` : ""}</p>
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

          <Panel title="Active Incidents" icon={AlertTriangle} count={openIncidents.length}>
            {openIncidents.length > 0 ? (
              <div className="space-y-2">
                {openIncidents.map((i) => (
                  <div key={i.id} className="p-2.5 rounded-lg border border-gray-200">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-medium text-gray-900 text-sm truncate">{i.type}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0 ${SEVERITY_BADGE[i.severity]}`}>
                        {i.severity.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 truncate">{i.resident} • Room {i.room} • {relTime(i.timestamp, nowTs)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <Empty text="No open incidents." />
            )}
          </Panel>

          <Panel title="Pending Call Bells" icon={BellRing} count={pendingBells.length}>
            {pendingBells.length > 0 ? (
              <div className="space-y-2">
                {pendingBells.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-purple-50 border border-purple-100">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{b.resident}</p>
                      <p className="text-xs text-gray-600 truncate">Room {b.room} • {b.reason}</p>
                    </div>
                    <span className="text-xs text-purple-700 font-medium flex-shrink-0 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {relTime(b.createdAt, nowTs)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty text="No pending call bells." />
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────── */

function Panel({ title, icon: Icon, count, className, children }: {
  title: string; icon: LucideIcon; count?: number; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={`bg-white rounded-lg border border-gray-200 p-3 sm:p-4 ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Icon className="w-4 h-4 text-yellow-500" /> {title}
        </h3>
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
