"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Plus, X, CheckCircle2, Play, Undo2, ClipboardList, StickyNote } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident, adaptTask } from "@/lib/adapters";
import { createRecord, updateRecord } from "@/lib/api";
import { TASK_NOTES_FIELD } from "@/lib/taskNotes";
import type { ClinicianRole } from "./useClinician";

/**
 * Task Assignment board (image 80–85). A supervisor (Nurse / Care Manager) assigns
 * care tasks to a single staff member for one or more residents, and tracks them
 * across Pending / In Progress / Completed columns.
 *
 * VISIBILITY RULE — the whole reason this board exists:
 *   • Managers (NURSE / FACILITY_ADMIN / CARE_MANAGER / SUPERADMIN): see ALL tasks,
 *     the assignee/resident/date filters work, and the "Assign Task" button shows.
 *   • Workers (CAREGIVER): the board is pre-filtered to ONLY tasks where
 *     assignedToId === my Staff id AND the task's due-time falls inside the CURRENT
 *     shift's window (Task has no `shift` column, so shift is derived from dueDate).
 *     Workers never see another staff member's tasks or a different shift. The
 *     "All assignees" filter and "Assign Task" button are hidden for them.
 */

type Shift = "DAY" | "EVENING" | "NIGHT";
const shiftNow = (): Shift => {
  const h = new Date().getHours();
  return h >= 7 && h < 15 ? "DAY" : h >= 15 && h < 23 ? "EVENING" : "NIGHT";
};
/** Which shift a due datetime belongs to (Task has no shift column — derive it). */
const shiftOf = (iso: string | Date | null | undefined): Shift | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const h = d.getHours();
  return h >= 7 && h < 15 ? "DAY" : h >= 15 && h < 23 ? "EVENING" : "NIGHT";
};
const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Roles that manage (see all) vs. workers (see only their own current-shift tasks). */
const MANAGER_ROLES = new Set(["NURSE", "FACILITY_ADMIN", "CARE_MANAGER", "SUPERADMIN", "ORGANIZATION_ADMIN", "PHYSICIAN"]);

/** UI Category options (image 84). Stored verbatim on Task.category (free-text String). */
const CATEGORIES = ["Personal Care", "Medication", "Mobility", "Nutrition", "Hygiene", "Observation", "Other"] as const;

/** UI Priority (image 85) → real TaskPriority enum. Routine→LOW, Urgent→HIGH, Critical→URGENT. */
const PRIORITY_OPTIONS = [
  { label: "Routine", value: "LOW" },
  { label: "Urgent", value: "HIGH" },
  { label: "Critical", value: "URGENT" },
] as const;
const PRIORITY_PILL: Record<string, { label: string; cls: string }> = {
  URGENT: { label: "CRITICAL", cls: "bg-red-100 text-red-700" },
  HIGH: { label: "URGENT", cls: "bg-orange-100 text-orange-700" },
  MEDIUM: { label: "MODERATE", cls: "bg-amber-100 text-amber-700" },
  LOW: { label: "ROUTINE", cls: "bg-slate-100 text-slate-600" },
};

type Task = ReturnType<typeof adaptTask>;
type StaffRow = { id: string; userId?: string; user?: { name?: string; role?: string } };
// Tasks are only assignable to front-line clinical staff.
const ASSIGNABLE_ROLES = new Set(["CAREGIVER", "NURSE", "CARE_MANAGER"]);

const pad = (n: number) => String(n).padStart(2, "0");
const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

type SetStatusFn = (id: string, status: "PENDING" | "IN_PROGRESS" | "COMPLETED") => void | Promise<void>;
type AddNoteFn = (task: Task) => void | Promise<void>;

/** A single task card with inline status-transition controls. */
function TaskCard({ task, staffNameById, onSetStatus, onAddNote }: { task: Task; staffNameById: Map<string, string>; onSetStatus: SetStatusFn; onAddNote: AddNoteFn }) {
  const raw = task.raw as { assignedToId?: string; status?: string; priority?: string } | undefined;
  const assignee = raw?.assignedToId ? staffNameById.get(raw.assignedToId) : null;
  const status = task.completed
    ? "COMPLETED"
    : String(raw?.status ?? "").toUpperCase() === "IN_PROGRESS" ? "IN_PROGRESS" : "PENDING";
  const pill = PRIORITY_PILL[String(raw?.priority ?? "").toUpperCase()] ?? PRIORITY_PILL.LOW;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800 leading-tight">{task.resident} · Rm {task.room}</p>
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${pill.cls}`}>{pill.label}</span>
      </div>
      <p className={`text-sm mt-1 ${task.completed ? "line-through text-slate-400" : "text-slate-700"}`}>{task.title}</p>
      <div className="flex items-center flex-wrap gap-2 mt-2">
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-slate-100 text-slate-500">{task.category}</span>
        {assignee && <span className="text-[11px] text-slate-500">{assignee}</span>}
        {task.dueTime && <span className="text-[11px] text-slate-400 ml-auto">Due {task.dueTime}</span>}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1">
        <button onClick={() => onAddNote(task)}
          title="Add note" className="p-1.5 rounded text-slate-500 hover:bg-slate-100 transition">
          <StickyNote className="w-4 h-4" />
        </button>
        {status !== "PENDING" && (
          <button onClick={() => onSetStatus(task.id, status === "COMPLETED" ? "IN_PROGRESS" : "PENDING")}
            title="Move back" className="p-1.5 rounded text-slate-500 hover:bg-slate-100 transition">
            <Undo2 className="w-4 h-4" />
          </button>
        )}
        {status === "PENDING" && (
          <button onClick={() => onSetStatus(task.id, "IN_PROGRESS")}
            title="Start task" className="p-1.5 rounded text-blue-600 hover:bg-blue-50 transition">
            <Play className="w-4 h-4" />
          </button>
        )}
        {status !== "COMPLETED" && (
          <button onClick={() => onSetStatus(task.id, "COMPLETED")}
            title="Mark complete" className="p-1.5 rounded text-green-600 hover:bg-green-50 transition">
            <CheckCircle2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/** A kanban status column: dot + label + count badge + card stack. */
function Column({ label, dot, items, staffNameById, onSetStatus, onAddNote }: {
  label: string; dot: string; items: Task[]; staffNameById: Map<string, string>; onSetStatus: SetStatusFn; onAddNote: AddNoteFn;
}) {
  return (
    <div className="flex flex-col min-w-0">
      <div className="flex items-center gap-2 px-1 pb-2">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <span className="text-sm font-semibold text-slate-800">{label}</span>
        <span className="inline-flex items-center justify-center min-w-6 h-5 px-1.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">{items.length}</span>
      </div>
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 min-h-28">
        {items.length > 0
          ? items.map((t) => <TaskCard key={t.id} task={t} staffNameById={staffNameById} onSetStatus={onSetStatus} onAddNote={onAddNote} />)
          : <p className="text-center text-sm text-slate-400 py-8">No tasks</p>}
      </div>
    </div>
  );
}

export default function TaskAssignmentBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  // ---- Data -----------------------------------------------------------------
  const { data: taskRows, loading, error, refetch } = useLiveQuery(
    "tasks", { query: "include=resident&take=300", tables: ["Task", "Resident"] }
  );
  const tasks = useMemo<Task[]>(() => taskRows.map(adaptTask), [taskRows]);

  const { data: staffRows } = useLiveQuery<StaffRow>(
    "staff", { query: "include=user&take=300", tables: ["Staff"] }
  );
  const staffNameById = useMemo(() => {
    const m = new Map<string, string>();
    staffRows.forEach((s) => m.set(s.id, s.user?.name ?? "Staff"));
    return m;
  }, [staffRows]);
  // Only caregivers / nurses / care managers can be assigned tasks (the full
  // staffNameById above still resolves names for any pre-existing assignee).
  const assignableStaff = useMemo(
    () => staffRows.filter((s) => ASSIGNABLE_ROLES.has(String(s.user?.role ?? "").toUpperCase())),
    [staffRows]
  );

  const { data: residentRows } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "take=300", tables: ["Resident"] }
  );
  const residents = useMemo(() => residentRows.map(adaptResident), [residentRows]);

  // ---- Current user identity (session → my Staff id) ------------------------
  const [sessionRole, setSessionRole] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [sessionStaffId, setSessionStaffId] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => {
        if (!d?.authenticated) return;
        setSessionRole(d.session?.role ?? null);
        setSessionUserId(d.session?.userId ?? null);
        // Enriched session exposes the current user's Staff id directly.
        setSessionStaffId(d.session?.staffId ?? null);
      })
      .catch(() => { /* non-fatal: worker sees an empty (safe) board */ });
  }, []);

  // Fallback: resolve my Staff id from the directory if the session didn't carry it.
  const myStaffId = useMemo(
    () => sessionStaffId ?? staffRows.find((s) => s.userId === sessionUserId)?.id ?? null,
    [sessionStaffId, sessionUserId, staffRows]
  );

  // A worker is a caregiver (or anyone whose role isn't a manager role). Managers
  // see everything; workers are locked to their own current-shift tasks.
  const isManager = sessionRole
    ? MANAGER_ROLES.has(sessionRole)
    : MANAGER_ROLES.has(clinicianRole); // pre-session: trust the portal's declared role
  const isWorker = !isManager;

  // ---- Filters (managers only) ----------------------------------------------
  const [filterDate, setFilterDate] = useState(todayInput());
  const [filterAssignee, setFilterAssignee] = useState("all");
  const [filterResident, setFilterResident] = useState("all");
  const [activeTab, setActiveTab] = useState<"board" | "mine" | "summary">("board");
  const [showAssign, setShowAssign] = useState(false);

  const currentShift = shiftNow();

  /** The base, security-critical filter applied before any tab/column grouping. */
  const visibleTasks = useMemo(() => {
    const now = new Date();
    return tasks.filter((t) => {
      const raw = t.raw as { assignedToId?: string } | undefined;
      const assignedTo = raw?.assignedToId ?? null;

      if (isWorker) {
        // Only MY tasks, and only for the CURRENT shift (derived from dueDate).
        if (!myStaffId || assignedTo !== myStaffId) return false;
        if (!t.dueDate) return false;
        const due = new Date(t.dueDate);
        if (Number.isNaN(due.getTime())) return false;
        if (!sameLocalDay(due, now)) return false;
        if (shiftOf(t.dueDate) !== currentShift) return false;
        // Workers may narrow their own board to a single resident.
        if (filterResident !== "all" && (t.raw as { residentId?: string } | undefined)?.residentId !== filterResident) return false;
        return true;
      }

      // Managers: apply the visible filter controls.
      if (filterAssignee !== "all" && assignedTo !== filterAssignee) return false;
      if (filterResident !== "all") {
        const rid = (t.raw as { residentId?: string } | undefined)?.residentId;
        if (rid !== filterResident) return false;
      }
      if (filterDate && t.dueDate) {
        const due = new Date(t.dueDate);
        const [y, m, dd] = filterDate.split("-").map(Number);
        if (!(due.getFullYear() === y && due.getMonth() + 1 === m && due.getDate() === dd)) return false;
      }
      return true;
    });
  }, [tasks, isWorker, myStaffId, currentShift, filterAssignee, filterResident, filterDate]);

  // Tab scoping: "My Tasks" = tasks assigned to the current user (within the
  // already-visible set). For a worker the whole board is already their tasks.
  const tabTasks = useMemo(() => {
    if (activeTab !== "mine") return visibleTasks;
    return visibleTasks.filter(
      (t) => (t.raw as { assignedToId?: string } | undefined)?.assignedToId === myStaffId
    );
  }, [activeTab, visibleTasks, myStaffId]);

  const rawStatus = (t: Task) =>
    String((t.raw as { status?: string } | undefined)?.status ?? "").toUpperCase();

  const columns = useMemo(() => {
    const pending: Task[] = [], inProgress: Task[] = [], completed: Task[] = [];
    for (const t of tabTasks) {
      if (t.completed) completed.push(t);
      else if (rawStatus(t) === "IN_PROGRESS") inProgress.push(t);
      else pending.push(t);
    }
    return { pending, inProgress, completed };
  }, [tabTasks]);

  // Shift Summary — per-status + per-assignee counts for the current shift.
  const summary = useMemo(() => {
    const shiftTasks = visibleTasks.filter((t) => shiftOf(t.dueDate) === currentShift);
    const byStatus = { PENDING: 0, IN_PROGRESS: 0, COMPLETED: 0 };
    const byAssignee = new Map<string, { name: string; pending: number; inProgress: number; completed: number }>();
    for (const t of shiftTasks) {
      const st = t.completed ? "COMPLETED" : rawStatus(t) === "IN_PROGRESS" ? "IN_PROGRESS" : "PENDING";
      byStatus[st] += 1;
      const aid = (t.raw as { assignedToId?: string } | undefined)?.assignedToId ?? "unassigned";
      const name = aid === "unassigned" ? "Unassigned" : staffNameById.get(aid) ?? "Staff";
      const row = byAssignee.get(aid) ?? { name, pending: 0, inProgress: 0, completed: 0 };
      if (st === "COMPLETED") row.completed += 1;
      else if (st === "IN_PROGRESS") row.inProgress += 1;
      else row.pending += 1;
      byAssignee.set(aid, row);
    }
    return { total: shiftTasks.length, byStatus, byAssignee: [...byAssignee.values()] };
  }, [visibleTasks, currentShift, staffNameById]);

  // ---- Status transitions (reuse CaregiverTasks pattern) --------------------
  const setStatus = async (id: string, status: "PENDING" | "IN_PROGRESS" | "COMPLETED") => {
    try {
      await updateRecord("tasks", id, {
        status,
        completedAt: status === "COMPLETED" ? new Date().toISOString() : null,
      });
      await refetch();
    } catch (err) {
      Swal.fire({ title: "Update Failed", text: err instanceof Error ? err.message : "Could not update task.", icon: "error" });
    }
  };

  // Append a timestamped note to the task's notes field (running log).
  const addNote = async (task: Task) => {
    const raw = (task.raw ?? {}) as Record<string, unknown>;
    const existing = String(raw[TASK_NOTES_FIELD] ?? "");
    const { value } = await Swal.fire({
      title: "Add note", input: "textarea",
      inputLabel: `Note for ${task.resident}${task.room ? ` · Rm ${task.room}` : ""}`,
      inputPlaceholder: "e.g. Resident refused fluids at 3pm; will retry after rest.",
      inputValue: "", showCancelButton: true, confirmButtonText: "Add note", confirmButtonColor: "#2563eb",
      inputValidator: (v) => (!v || !v.trim() ? "Enter a note" : null),
    });
    if (!value || !String(value).trim()) return;
    const stamp = new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const entry = `[${stamp}] ${String(value).trim()}`;
    try {
      await updateRecord("tasks", task.id, { [TASK_NOTES_FIELD]: existing ? `${existing}\n${entry}` : entry });
      await refetch();
      Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Note added", showConfirmButton: false, timer: 1400 });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not add note.", icon: "error" });
    }
  };

  return (
    <div className="-m-4 sm:-m-6 p-4 sm:p-6 min-h-full bg-slate-50 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <ClipboardList className="w-6 h-6 text-blue-600" /> Task Assignment
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Assign and track care tasks for caregivers</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} title="Refresh" className="p-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 transition">
            <RefreshCw className="w-4 h-4" />
          </button>
          {isManager && (
            <button onClick={() => setShowAssign(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm transition active:scale-95">
              <Plus className="w-4 h-4" /> Assign Task
            </button>
          )}
        </div>
      </div>

      {/* Filter row — managers only (workers are locked to their own current shift) */}
      {isManager && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
          <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 outline-none focus:border-blue-400" />
          <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 outline-none focus:border-blue-400">
            <option value="all">All assignees</option>
            {assignableStaff.map((s) => <option key={s.id} value={s.id}>{s.user?.name ?? "Staff"}</option>)}
          </select>
          <select value={filterResident} onChange={(e) => setFilterResident(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 outline-none focus:border-blue-400">
            <option value="all">All residents</option>
            {residents.map((r) => <option key={r.id} value={r.id}>{r.name} · Rm {r.room}</option>)}
          </select>
        </div>
      )}

      {/* Worker filter — pick a resident to review their pending / in-progress / completed tasks */}
      {isWorker && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3">
          <span className="text-sm font-medium text-slate-500">Resident</span>
          <select value={filterResident} onChange={(e) => setFilterResident(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 outline-none focus:border-blue-400 min-w-[200px]">
            <option value="all">All residents</option>
            {residents.map((r) => <option key={r.id} value={r.id}>{r.name} · Rm {r.room}</option>)}
          </select>
        </div>
      )}

      {/* Tabs */}
      <div className="inline-flex rounded-xl bg-slate-100 p-1 text-sm font-medium">
        {([["board", "Board View"], ["mine", "My Tasks"], ["summary", "Shift Summary"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`px-4 py-1.5 rounded-lg transition ${activeTab === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Body */}
      {loading && tasks.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">Loading tasks…</div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-red-600">Failed to load tasks: {error}</div>
      ) : activeTab === "summary" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {([["Pending", summary.byStatus.PENDING, "bg-amber-400"], ["In Progress", summary.byStatus.IN_PROGRESS, "bg-blue-500"], ["Completed", summary.byStatus.COMPLETED, "bg-green-500"]] as const).map(([label, n, dot]) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${dot}`} /><span className="text-sm text-slate-500">{label}</span></div>
                <p className="text-3xl font-bold text-slate-900 mt-1">{n}</p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-700">
              By assignee · {currentShift} shift ({summary.total} task{summary.total === 1 ? "" : "s"})
            </div>
            {summary.byAssignee.length === 0 ? (
              <p className="text-center text-sm text-slate-400 py-8">No tasks</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {summary.byAssignee.map((r) => (
                  <div key={r.name} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-slate-700">{r.name}</span>
                    <span className="flex items-center gap-3 text-xs">
                      <span className="text-amber-600">{r.pending} pending</span>
                      <span className="text-blue-600">{r.inProgress} in progress</span>
                      <span className="text-green-600">{r.completed} completed</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Column label="Pending" dot="bg-amber-400" items={columns.pending} staffNameById={staffNameById} onSetStatus={setStatus} onAddNote={addNote} />
          <Column label="In Progress" dot="bg-blue-500" items={columns.inProgress} staffNameById={staffNameById} onSetStatus={setStatus} onAddNote={addNote} />
          <Column label="Completed" dot="bg-green-500" items={columns.completed} staffNameById={staffNameById} onSetStatus={setStatus} onAddNote={addNote} />
        </div>
      )}

      {showAssign && isManager && (
        <AssignTaskModal
          residents={residents}
          staffRows={assignableStaff}
          creatorStaffId={myStaffId}
          onClose={() => setShowAssign(false)}
          onSaved={() => { setShowAssign(false); refetch(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assign New Task modal (image 83)
// ---------------------------------------------------------------------------
function AssignTaskModal({
  residents, staffRows, creatorStaffId, onClose, onSaved,
}: {
  residents: ReturnType<typeof adaptResident>[];
  staffRows: StaffRow[];
  creatorStaffId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selectedResidents, setSelectedResidents] = useState<Set<string>>(new Set());
  const [assigneeId, setAssigneeId] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [priority, setPriority] = useState<string>(PRIORITY_OPTIONS[0].value);
  const [dueDate, setDueDate] = useState(todayInput());
  const [dueTime, setDueTime] = useState("08:00");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const toggleResident = (id: string) =>
    setSelectedResidents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const selectAll = () => setSelectedResidents(new Set(residents.map((r) => r.id)));
  const clearAll = () => setSelectedResidents(new Set());

  const valid = selectedResidents.size > 0 && assigneeId && title.trim() && dueDate && dueTime;
  const inputCls = "w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-transparent outline-none text-sm";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      // Combine Due Date + Due Time into a local ISO datetime.
      const dueISO = new Date(`${dueDate}T${dueTime}`).toISOString();
      // One Task per selected resident, all to the same assignee.
      for (const residentId of selectedResidents) {
        await createRecord("tasks", {
          residentId,
          title: title.trim(),
          category,
          priority,
          status: "PENDING",
          dueDate: dueISO,
          assignedToId: assigneeId,
          createdById: creatorStaffId,
          // Notes stored in the repurposed documentationRequired column (same field
          // CaregiverTasks reads); description kept in sync for the detail view.
          description: notes.trim() || null,
          [TASK_NOTES_FIELD]: notes.trim() || null,
        });
      }
      Swal.fire({ title: "Task Assigned", icon: "success", timer: 1300, showConfirmButton: false });
      onSaved();
    } catch (err) {
      setSaving(false);
      Swal.fire({ title: "Save Failed", text: err instanceof Error ? err.message : "Could not assign task.", icon: "error" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-bold text-slate-900">Assign New Task</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition text-slate-500"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="p-5 space-y-4">
            {/* Residents multi-select */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-semibold text-slate-700">Residents <span className="text-red-500">*</span> <span className="text-slate-400 font-normal">({selectedResidents.size} selected)</span></label>
                <div className="text-xs">
                  <button type="button" onClick={selectAll} className="text-blue-600 hover:underline">Select All</button>
                  <span className="text-slate-300 mx-1.5">|</span>
                  <button type="button" onClick={clearAll} className="text-blue-600 hover:underline">Clear</button>
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-300 divide-y divide-slate-100">
                {residents.length === 0 ? (
                  <p className="text-xs text-slate-400 p-3">No residents found.</p>
                ) : residents.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={selectedResidents.has(r.id)} onChange={() => toggleResident(r.id)} className="rounded border-slate-300" />
                    {r.name} — Rm {r.room}
                  </label>
                ))}
              </div>
            </div>

            {/* Assign To */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Assign To <span className="text-red-500">*</span></label>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputCls}>
                <option value="">Select staff member…</option>
                {staffRows.map((s) => <option key={s.id} value={s.id}>{s.user?.name ?? "Staff"}</option>)}
              </select>
            </div>

            {/* Title */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Task Title <span className="text-red-500">*</span></label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Bed bath and linen change" className={inputCls} />
            </div>

            {/* Category + Priority */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Category</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Priority</label>
                <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputCls}>
                  {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </div>

            {/* Due Date + Due Time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Due Date</label>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Due Time</label>
                <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className={inputCls} />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Notes (optional)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Additional instructions…" className={`${inputCls} resize-y`} />
            </div>
          </div>

          <div className="sticky bottom-0 bg-slate-50 border-t border-slate-200 px-5 py-4 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition text-sm">Cancel</button>
            <button type="submit" disabled={!valid || saving}
              className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed text-sm">
              <Plus className="w-4 h-4" /> {saving ? "Assigning…" : "Assign Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
