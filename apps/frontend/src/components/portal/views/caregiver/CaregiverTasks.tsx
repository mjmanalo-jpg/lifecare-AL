"use client";

import { Search, X, Eye, Trash2, Plus, Clock, CheckCircle2, Undo2, Play, StickyNote } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptTask } from "@/lib/adapters";
import { updateRecord, deleteRecord } from "@/lib/api";
import { TASK_NOTES_FIELD, taskNotesOf, withAppendedNote, withoutNote } from "@/lib/taskNotes";
import AddTaskModal, { SUPERVISOR_ROLES } from "./AddTaskModal";
import { StatusPill, MicroLabel, ClinicalHeader, ClinicalCard } from "../clinical/clinical-ui";

type CaregiverTask = ReturnType<typeof adaptTask>;

/** Priority tier → pill label + colour, matching the board reference exactly:
 *  CRITICAL = deep maroon, URGENT = coral, MODERATE = amber, ROUTINE = grey. */
const PRIORITY_PILL: Record<string, { label: string; cls: string }> = {
  critical: { label: "CRITICAL", cls: "bg-[#9E3B2A] text-white" },
  high: { label: "URGENT", cls: "bg-[#C0573F] text-white" },
  medium: { label: "MODERATE", cls: "bg-[#C39A3E] text-white" },
  low: { label: "ROUTINE", cls: "bg-[#D8DAD0] text-[#5A5D53]" },
};
function PriorityPill({ priority }: { priority: string }) {
  const p = PRIORITY_PILL[priority] ?? PRIORITY_PILL.low;
  return <span className={`inline-flex items-center px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-[0.05em] ${p.cls}`}>{p.label}</span>;
}

/** "First Last" → "Last, F." to match the reference card header. */
const shortName = (full: string) => {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full;
  return `${parts[parts.length - 1]}, ${parts[0].charAt(0)}.`;
};

/** Human-friendly "overdue" elapsed string. */
const overdueLabel = (dueDate: string | Date) => {
  const diffMs = Date.now() - new Date(dueDate).getTime();
  const mins = Math.max(1, Math.floor(diffMs / 60000));
  if (mins < 60) return `${mins} min overdue`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr overdue`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? "s" : ""} overdue`;
};

/** Task Checklist — live daily assist tasks as a clinical-editorial kanban board. */
export default function CaregiverTasks() {
  const {
    data: taskRows,
    loading: tasksLoading,
    error: tasksError,
    refetch: refetchTasks,
  } = useLiveQuery("tasks", { query: "include=resident&take=300", tables: ["Task", "Resident"] });
  const tasks = useMemo<CaregiverTask[]>(() => taskRows.map(adaptTask), [taskRows]);

  // Staff directory → resolve assignee / delegator names (relations aren't nested-included by the API).
  const { data: staffRows } = useLiveQuery<{ id: string; user?: { name?: string } }>(
    "staff", { query: "include=user&take=300", tables: ["Staff"] }
  );
  const staffNameById = useMemo(() => {
    const map = new Map<string, string>();
    staffRows.forEach((s) => map.set(s.id, s.user?.name ?? "Staff"));
    return map;
  }, [staffRows]);
  const nameOf = (id: unknown) => (typeof id === "string" ? staffNameById.get(id) ?? null : null);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [viewingTask, setViewingTask] = useState<CaregiverTask | null>(null);
  const [showAddTask, setShowAddTask] = useState(false);

  // Only the head nurse / supervisors may assign tasks — caregivers cannot.
  const [sessionRole, setSessionRole] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => {
        if (data?.authenticated) setSessionRole(data.session?.role ?? null);
      })
      .catch(() => { /* Non-fatal: hides the assign button. */ });
  }, []);
  const canAssign = sessionRole ? SUPERVISOR_ROLES.has(sessionRole) : false;
  // Supervisors (nurse/admin) delegate tasks; caregivers execute them. So the
  // start/complete/reopen controls are shown only to executors — a nurse sees
  // the board and the notes read-only, but cannot start or complete a task.
  const canExecute = !canAssign;

  const allFilteredTasks = useMemo(() => {
    const createdTs = (task: CaregiverTask) => {
      const raw = task.raw as { createdAt?: string } | undefined;
      const t = raw?.createdAt ? new Date(raw.createdAt).getTime() : 0;
      return Number.isNaN(t) ? 0 : t;
    };
    return tasks
      .filter((task) => {
        const matchesSearch =
          task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          task.resident.toLowerCase().includes(searchQuery.toLowerCase()) ||
          task.category.toLowerCase().includes(searchQuery.toLowerCase());

        const matchesPriority = filterPriority === "all" || task.priority === filterPriority;
        const matchesStatus =
          filterStatus === "all" ||
          (filterStatus === "completed" && task.completed) ||
          (filterStatus === "pending" && !task.completed);

        return matchesSearch && matchesPriority && matchesStatus;
      })
      // Latest task first, regardless of completion status.
      .sort((a, b) => createdTs(b) - createdTs(a));
  }, [tasks, searchQuery, filterPriority, filterStatus]);

  // Group into the three kanban columns. Completed = task.completed; not-completed
  // splits into In Progress (raw status IN_PROGRESS) vs Pending.
  const columns = useMemo(() => {
    const rawStatus = (task: CaregiverTask) =>
      String((task.raw as { status?: string } | undefined)?.status ?? "").toUpperCase();
    const pending: CaregiverTask[] = [];
    const inProgress: CaregiverTask[] = [];
    const completed: CaregiverTask[] = [];
    for (const task of allFilteredTasks) {
      if (task.completed) completed.push(task);
      else if (rawStatus(task) === "IN_PROGRESS") inProgress.push(task);
      else pending.push(task);
    }
    return { pending, inProgress, completed };
  }, [allFilteredTasks]);

  // Current user's name — stamped as the author on task notes so the nurse and
  // other caregivers know who flagged the blocker.
  const [authorName, setAuthorName] = useState("");
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => setAuthorName(d?.session?.name || d?.workspaces?.user?.name || ""))
      .catch(() => { /* leave blank — the note still saves */ });
  }, []);

  // Add a caregiver note to a task ("can't bathe — slight fever"). The note is
  // stored ON the task, so it reflects live to the nurse, other caregivers, and
  // the resident's QR profile without any extra plumbing.
  const handleAddNote = async (task: CaregiverTask) => {
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
      await updateRecord("tasks", task.id, {
        [TASK_NOTES_FIELD]: withAppendedNote((task.raw as Record<string, unknown>)?.[TASK_NOTES_FIELD], String(value), authorName),
      });
      await refetchTasks();
      Swal.fire({ title: "Note added", text: "Visible to the nurse, other caregivers, and on the resident's profile.", icon: "success", timer: 1800, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Couldn't add note", text: err instanceof Error ? err.message : "Try again.", icon: "error" });
    }
  };

  const handleRemoveNote = async (task: CaregiverTask, noteId: string) => {
    try {
      await updateRecord("tasks", task.id, { [TASK_NOTES_FIELD]: withoutNote((task.raw as Record<string, unknown>)?.[TASK_NOTES_FIELD], noteId) });
      await refetchTasks();
    } catch { /* non-fatal */ }
  };

  // Advance a task through its lifecycle: Start → IN_PROGRESS, Complete →
  // COMPLETED, or revert/reopen → PENDING. completedAt is stamped only on
  // completion and cleared otherwise, so a reopened task looks fresh.
  const handleSetStatus = async (id: string, status: "PENDING" | "IN_PROGRESS" | "COMPLETED") => {
    try {
      await updateRecord("tasks", id, {
        status,
        completedAt: status === "COMPLETED" ? new Date().toISOString() : null,
      });
      await refetchTasks();
    } catch (err) {
      Swal.fire({
        title: "Update Failed",
        text: err instanceof Error ? err.message : "Could not update task.",
        icon: "error",
      });
    }
  };

  const handleDeleteTask = async (id: string) => {
    const result = await Swal.fire({
      title: "Delete Task?",
      text: "Remove this task from checklist?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel",
    });

    if (result.isConfirmed) {
      try {
        await deleteRecord("tasks", id);
        await refetchTasks();
        Swal.fire({
          title: "Deleted",
          text: "Task removed.",
          icon: "success",
          timer: 1500,
          showConfirmButton: false,
        });
      } catch (err) {
        Swal.fire({
          title: "Delete Failed",
          text: err instanceof Error ? err.message : "Could not delete task.",
          icon: "error",
        });
      }
    }
  };

  const taskStats = {
    total: tasks.length,
    completed: tasks.filter((t) => t.completed).length,
    pending: tasks.filter((t) => !t.completed).length,
    critical: tasks.filter((t) => t.priority === "critical" && !t.completed).length,
  };

  /** A single kanban task card. `top` colours the top rule to match its column. */
  const TaskCard = ({ task, top }: { task: CaregiverTask; top: "teal" | "amber" | "green" }) => {
    const raw = task.raw as { completedAt?: string; status?: string } | undefined;
    const inProgress = !task.completed && String(raw?.status ?? "").toUpperCase() === "IN_PROGRESS";
    // eslint-disable-next-line react-hooks/purity
    const isOverdue = !task.completed && !!task.dueDate && new Date(task.dueDate).getTime() < Date.now();
    const completedTime = raw?.completedAt
      ? new Date(raw.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : task.dueTime;
    const assignee = nameOf(task.raw?.assignedToId);

    return (
      <ClinicalCard top={top} className={`p-3.5 ${task.completed ? "opacity-90" : ""}`}>
        {/* Resident + priority */}
        <div className="flex items-start justify-between gap-2">
          <p className={`font-bold text-sm leading-tight ${task.completed ? "text-[#8A8D82]" : "text-[#2B2B27]"}`}>
            {shortName(task.resident)} · Rm {task.room}
          </p>
          <PriorityPill priority={task.priority} />
        </div>

        {/* Title */}
        <p className={`text-sm mt-1.5 ${task.completed ? "line-through text-[#8A8D82]" : "text-[#3C3C36]"}`}>
          {task.title}
        </p>

        {/* Caregiver notes / blockers — reflected to nurse + other caregivers + QR profile */}
        {(() => {
          const notes = taskNotesOf(task.raw as Record<string, unknown>);
          if (!notes.length) return null;
          return (
            <div className="mt-2 space-y-1.5">
              {notes.map((n) => (
                <div key={n.id} className="flex items-start gap-1.5 rounded-md border border-[#E7DFC8] bg-[#FBF7EC] px-2 py-1.5">
                  <StickyNote className="w-3.5 h-3.5 text-[#C39A3E] mt-0.5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] leading-snug text-[#3C3C36]">{n.text}</p>
                    <p className="text-[10px] text-[#8A8D82]">{n.author}{n.at ? ` · ${new Date(n.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}</p>
                  </div>
                  <button onClick={() => void handleRemoveNote(task, n.id)} title="Remove note" className="text-[#B0B3A8] hover:text-[#C0573F] flex-shrink-0"><X className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Category + assignee + overdue elapsed */}
        <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-2.5">
          <span className="inline-flex items-center px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-[0.05em] bg-[#D8DAD0] text-[#5A5D53]">{task.category.toUpperCase()}</span>
          {assignee && <span className="text-[11px] text-[#8A8D82]">{assignee}</span>}
          {!task.completed && isOverdue && task.dueDate && (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-[#C0573F]">
              <Clock className="w-3 h-3" /> {overdueLabel(task.dueDate)}
            </span>
          )}
        </div>

        {/* Status line + actions */}
        <div className="mt-3 flex items-center justify-between gap-2">
          {task.completed ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#5F7A52]">
              <CheckCircle2 className="w-3.5 h-3.5" /> Done {completedTime}
            </span>
          ) : isOverdue ? (
            <StatusPill status="OVERDUE" />
          ) : task.dueTime ? (
            <span className="text-[11px] text-[#8A8D82]">Due {task.dueTime}</span>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Execution controls (start / complete / reopen) — executors only.
                Supervisors delegate and observe; they don't perform the task. */}
            {canExecute && (task.completed ? (
              <button
                onClick={() => handleSetStatus(task.id, "PENDING")}
                title="Reopen task"
                className="p-1.5 rounded transition text-[#8A8D82] hover:bg-black/5"
              >
                <Undo2 className="w-4 h-4" />
              </button>
            ) : (
              <>
                {inProgress ? (
                  <button
                    onClick={() => handleSetStatus(task.id, "PENDING")}
                    title="Move back to pending"
                    className="p-1.5 rounded transition text-[#8A8D82] hover:bg-black/5"
                  >
                    <Undo2 className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => handleSetStatus(task.id, "IN_PROGRESS")}
                    title="Start task"
                    className="p-1.5 rounded transition text-[#C39A3E] hover:bg-[#C39A3E]/12"
                  >
                    <Play className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => handleSetStatus(task.id, "COMPLETED")}
                  title="Mark complete"
                  className="p-1.5 rounded transition text-[#7E9B6F] hover:bg-[#7E9B6F]/12"
                >
                  <CheckCircle2 className="w-4 h-4" />
                </button>
              </>
            ))}
            <button
              onClick={() => void handleAddNote(task)}
              title="Add note"
              className="p-1.5 rounded text-[#C39A3E] hover:bg-[#C39A3E]/12 transition"
            >
              <StickyNote className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewingTask(task)}
              title="View task"
              className="p-1.5 rounded text-[#2E4A48] hover:bg-[#2E4A48]/10 transition"
            >
              <Eye className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleDeleteTask(task.id)}
              title="Delete task"
              className="p-1.5 rounded text-[#C0573F] hover:bg-[#C0573F]/10 transition"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </ClinicalCard>
    );
  };

  /** A kanban column: coloured header bar + count badge + internally-scrolling stack. */
  const KanbanColumn = ({
    label,
    barColor,
    items,
    top,
  }: {
    label: string;
    barColor: string;
    items: CaregiverTask[];
    top: "teal" | "amber" | "green";
  }) => (
    <div className="flex flex-col min-w-0">
      <div
        className="flex items-center justify-between rounded-t-lg px-3.5 py-2.5"
        style={{ background: barColor }}
      >
        <span className="text-xs font-bold uppercase tracking-[0.08em] text-white">{label}</span>
        <span className="inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full bg-white/25 text-white text-xs font-bold">
          {items.length}
        </span>
      </div>
      <div className="max-h-[70vh] overflow-y-auto space-y-3 p-3 rounded-b-lg bg-white/40 border border-t-0 border-[#D6D8CD]">
        {items.length > 0 ? (
          items.map((task) => <TaskCard key={task.id} task={task} top={top} />)
        ) : (
          <p className="text-center text-xs text-[#8A8D82] py-8">No tasks</p>
        )}
      </div>
    </div>
  );

  return (
    <div className="-m-4 min-h-full space-y-5 bg-[var(--clinical-ground)] p-4 sm:-m-6 sm:p-6">
      {/* Header — only the head nurse / supervisor can assign tasks; caregivers cannot. */}
      <ClinicalHeader
        eyebrow="Board View — Current Shift"
        title="Task Checklist"
        subtitle="Manage daily tasks and track completion"
        right={
          canAssign ? (
            <button
              onClick={() => setShowAddTask(true)}
              className="inline-flex items-center gap-2 self-start px-4 py-2.5 rounded-lg bg-[#2E4A48] hover:bg-[#25403D] text-white text-sm font-semibold shadow transition active:scale-95"
            >
              <Plus className="w-4 h-4" /> Assign Task
            </button>
          ) : undefined
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 lg:gap-4">
        <ClinicalCard top="teal" className="p-3 sm:p-4">
          <MicroLabel>Total Tasks</MicroLabel>
          <p className="text-2xl sm:text-3xl font-bold text-[#2B2B27] mt-1">{taskStats.total}</p>
        </ClinicalCard>
        <ClinicalCard top="green" className="p-3 sm:p-4">
          <MicroLabel>Completed</MicroLabel>
          <p className="text-2xl sm:text-3xl font-bold text-[#7E9B6F] mt-1">{taskStats.completed}</p>
        </ClinicalCard>
        <ClinicalCard top="amber" className="p-3 sm:p-4">
          <MicroLabel>Pending</MicroLabel>
          <p className="text-2xl sm:text-3xl font-bold text-[#C39A3E] mt-1">{taskStats.pending}</p>
        </ClinicalCard>
        <ClinicalCard top="coral" className="p-3 sm:p-4">
          <MicroLabel>Critical</MicroLabel>
          <p className="text-2xl sm:text-3xl font-bold text-[#C0573F] mt-1">{taskStats.critical}</p>
        </ClinicalCard>
      </div>

      {/* Search & Filters */}
      <div className="space-y-3 sm:space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8A8D82]" />
          <input
            type="text"
            placeholder="Search tasks, residents, categories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 sm:py-3 bg-white border border-[#D6D8CD] rounded-lg focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none text-sm"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {/* Priority Filter */}
          <div>
            <MicroLabel className="mb-2">Priority</MicroLabel>
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="w-full px-4 py-2 bg-white border border-[#D6D8CD] rounded-lg focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none text-sm"
            >
              <option value="all">All Priorities</option>
              <option value="critical">Critical Only</option>
              <option value="high">High & Above</option>
              <option value="medium">Medium & Above</option>
              <option value="low">Low Priority</option>
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <MicroLabel className="mb-2">Status</MicroLabel>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-4 py-2 bg-white border border-[#D6D8CD] rounded-lg focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none text-sm"
            >
              <option value="all">All Tasks</option>
              <option value="pending">Pending Only</option>
              <option value="completed">Completed Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Kanban Board */}
      {tasksLoading && tasks.length === 0 ? (
        <ClinicalCard className="p-8 text-center text-[#8A8D82]">Loading tasks…</ClinicalCard>
      ) : tasksError ? (
        <ClinicalCard top="coral" className="p-8 text-center text-[#C0573F]">
          Failed to load tasks: {tasksError}
        </ClinicalCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KanbanColumn label="Pending" barColor="#2E4A48" items={columns.pending} top="teal" />
          <KanbanColumn label="In Progress" barColor="#C39A3E" items={columns.inProgress} top="amber" />
          <KanbanColumn label="Completed" barColor="#7E9B6F" items={columns.completed} top="green" />
        </div>
      )}

      {/* Assign Task Modal — supervisors delegate to a caregiver (gated by canAssign). */}
      {showAddTask && canAssign && (
        <AddTaskModal
          onClose={() => setShowAddTask(false)}
          onSaved={() => {
            setShowAddTask(false);
            refetchTasks();
          }}
        />
      )}

      {/* Task Details Modal */}
      {viewingTask && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92dvh] overflow-y-auto">
            {/* Modal Header */}
            <div className="sticky top-0 bg-[#2E4A48] text-white p-4 sm:p-6 flex items-center justify-between">
              <h2 className="text-lg sm:text-xl md:text-2xl font-bold" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
                Task Details
              </h2>
              <button
                onClick={() => setViewingTask(null)}
                className="p-2 hover:bg-white/15 rounded-lg transition"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-4 sm:p-6 md:p-8 space-y-4 sm:space-y-6">
              <div>
                <h3 className="text-lg sm:text-xl md:text-2xl font-bold text-[#2B2B27] mb-2">
                  {viewingTask.title}
                </h3>
                <p className="text-[#6B6E63] text-sm">
                  {viewingTask.resident} · Room {viewingTask.room}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 md:gap-6">
                <div>
                  <MicroLabel className="mb-2">Category</MicroLabel>
                  <p className="text-lg text-[#2B2B27]">{viewingTask.category}</p>
                </div>
                <div>
                  <MicroLabel className="mb-2">Due Time</MicroLabel>
                  <p className="text-lg text-[#2B2B27]">{viewingTask.dueTime}</p>
                </div>
                <div>
                  <MicroLabel className="mb-2">Priority</MicroLabel>
                  <PriorityPill priority={viewingTask.priority} />
                </div>
                <div>
                  <MicroLabel className="mb-2">Status</MicroLabel>
                  <StatusPill status={viewingTask.completed ? "COMPLETED" : String((viewingTask.raw as { status?: string } | undefined)?.status ?? "").toUpperCase() === "IN_PROGRESS" ? "IN_PROGRESS" : "PENDING"} />
                </div>
                <div>
                  <MicroLabel className="mb-2">Assigned To</MicroLabel>
                  <p className="text-lg text-[#2B2B27]">{nameOf(viewingTask.raw?.assignedToId) ?? "Unassigned"}</p>
                </div>
                <div>
                  <MicroLabel className="mb-2">Assigned By</MicroLabel>
                  <p className="text-lg text-[#2B2B27]">{nameOf(viewingTask.raw?.createdById) ?? "—"}</p>
                </div>
              </div>

              {viewingTask.notes && (
                <div className="bg-[#F3F4EE] border-l-4 border-[#2E4A48] p-4 rounded">
                  <MicroLabel className="mb-2">Description</MicroLabel>
                  <p className="text-[#2B2B27]">{viewingTask.notes}</p>
                </div>
              )}

              {/* Caregiver task notes / blockers (documentationRequired) — the
                  same notes shown on the board card, surfaced here so the nurse
                  sees them when opening the task. */}
              {(() => {
                const tnotes = taskNotesOf(viewingTask.raw as Record<string, unknown>);
                if (!tnotes.length) return null;
                return (
                  <div>
                    <MicroLabel className="mb-2">Task Notes</MicroLabel>
                    <div className="space-y-2">
                      {tnotes.map((n) => (
                        <div key={n.id} className="flex items-start gap-2 rounded-md border border-[#E7DFC8] bg-[#FBF7EC] px-3 py-2">
                          <StickyNote className="w-4 h-4 text-[#C39A3E] mt-0.5 flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm text-[#3C3C36]">{n.text}</p>
                            <p className="text-[11px] text-[#8A8D82]">{n.author}{n.at ? ` · ${new Date(n.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div className="sticky bottom-0 bg-[#F3F4EE] border-t border-[#D6D8CD] px-4 sm:px-6 md:px-8 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-2">
              <button
                onClick={() => setViewingTask(null)}
                className="px-4 sm:px-6 py-2 text-[#3C3C36] hover:bg-[#E1E3D9] rounded-lg transition text-sm"
              >
                Close
              </button>
              {canExecute && (
                <div className="flex flex-wrap items-center gap-2">
                  {viewingTask.completed ? (
                    <button
                      onClick={() => { handleSetStatus(viewingTask.id, "PENDING"); setViewingTask(null); }}
                      className="px-4 sm:px-6 py-2 text-white font-semibold rounded-lg transition text-sm bg-[#2E4A48] hover:bg-[#25403D]"
                    >
                      Reopen Task
                    </button>
                  ) : (
                    <>
                      {String((viewingTask.raw as { status?: string } | undefined)?.status ?? "").toUpperCase() !== "IN_PROGRESS" && (
                        <button
                          onClick={() => { handleSetStatus(viewingTask.id, "IN_PROGRESS"); setViewingTask(null); }}
                          className="px-4 sm:px-6 py-2 font-semibold rounded-lg transition text-sm border border-[#C39A3E] text-[#9A7A2E] hover:bg-[#C39A3E]/10"
                        >
                          Start Task
                        </button>
                      )}
                      <button
                        onClick={() => { handleSetStatus(viewingTask.id, "COMPLETED"); setViewingTask(null); }}
                        className="px-4 sm:px-6 py-2 text-white font-semibold rounded-lg transition text-sm bg-[#7E9B6F] hover:bg-[#6E8A5F]"
                      >
                        Mark Complete
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
