"use client";

import { Search, X, Eye, Trash2, Plus, Clock } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptTask } from "@/lib/adapters";
import { updateRecord, deleteRecord } from "@/lib/api";
import AddTaskModal, { SUPERVISOR_ROLES } from "./AddTaskModal";
import { CLINICAL, StatusPill, MicroLabel, ClinicalHeader, ClinicalCard } from "../clinical/clinical-ui";

type CaregiverTask = ReturnType<typeof adaptTask>;

/** Map a UI priority tier to a StatusPill status keyword. */
const priorityStatus = (priority: string) => {
  switch (priority) {
    case "critical":
      return "CRITICAL";
    case "high":
      return "URGENT";
    case "medium":
      return "ROUTINE";
    default:
      return "LOW";
  }
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

  const handleToggleTask = async (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    try {
      await updateRecord("tasks", id, {
        status: task.completed ? "PENDING" : "COMPLETED",
        completedAt: task.completed ? null : new Date().toISOString(),
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
    const raw = task.raw as { completedAt?: string } | undefined;
    // eslint-disable-next-line react-hooks/purity
    const isOverdue = !task.completed && !!task.dueDate && new Date(task.dueDate).getTime() < Date.now();
    const completedTime = raw?.completedAt
      ? new Date(raw.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : task.dueTime;
    const assignee = nameOf(task.raw?.assignedToId);

    return (
      <ClinicalCard top={top} className={`p-3.5 ${task.completed ? "opacity-80" : ""}`}>
        <div className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={task.completed}
            onChange={() => handleToggleTask(task.id)}
            className="w-4 h-4 rounded cursor-pointer mt-0.5 flex-shrink-0 accent-[#7E9B6F]"
            title="Mark task complete"
          />
          <div className="flex-1 min-w-0">
            {/* Resident + priority */}
            <div className="flex items-start justify-between gap-2">
              <p className={`font-bold text-sm leading-tight ${task.completed ? "text-[#8A8D82]" : "text-[#2B2B27]"}`}>
                {task.resident} · Rm {task.room}
              </p>
              <StatusPill status={priorityStatus(task.priority)} className="flex-shrink-0" />
            </div>

            {/* Title */}
            <p className={`text-sm mt-1.5 ${task.completed ? "line-through text-[#8A8D82]" : "text-[#3C3C36]"}`}>
              {task.title}
            </p>

            {/* Category + assignee */}
            <div className="flex items-center flex-wrap gap-2 mt-2.5">
              <StatusPill status="ROUTINE">{task.category.toUpperCase()}</StatusPill>
              {assignee && <span className="text-[11px] text-[#8A8D82]">{assignee}</span>}
            </div>

            {/* Due / overdue / done */}
            <div className="mt-3 flex items-center justify-between gap-2">
              {task.completed ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#5F7A52]">
                  ✓ Done {completedTime}
                </span>
              ) : isOverdue && task.dueDate ? (
                <span className="inline-flex items-center gap-1.5">
                  <StatusPill status="OVERDUE" />
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#C0573F]">
                    <Clock className="w-3 h-3" /> {overdueLabel(task.dueDate)}
                  </span>
                </span>
              ) : task.dueTime ? (
                <span className="text-[11px] text-[#8A8D82]">Due {task.dueTime}</span>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-1 flex-shrink-0">
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
    <div
      className="-m-4 sm:-m-6 p-4 sm:p-6 min-h-full space-y-5"
      style={{ background: CLINICAL.ground }}
    >
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
                  <StatusPill status={priorityStatus(viewingTask.priority)} />
                </div>
                <div>
                  <MicroLabel className="mb-2">Status</MicroLabel>
                  <StatusPill status={viewingTask.completed ? "COMPLETED" : "PENDING"} />
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
                  <MicroLabel className="mb-2">Notes</MicroLabel>
                  <p className="text-[#2B2B27]">{viewingTask.notes}</p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="sticky bottom-0 bg-[#F3F4EE] border-t border-[#D6D8CD] px-4 sm:px-6 md:px-8 py-3 sm:py-4 flex items-center justify-between gap-2">
              <button
                onClick={() => setViewingTask(null)}
                className="px-4 sm:px-6 py-2 text-[#3C3C36] hover:bg-[#E1E3D9] rounded-lg transition text-sm"
              >
                Close
              </button>
              <button
                onClick={() => {
                  handleToggleTask(viewingTask.id);
                  setViewingTask(null);
                }}
                className={`px-4 sm:px-6 py-2 text-white font-semibold rounded-lg transition text-sm ${
                  viewingTask.completed ? "bg-[#2E4A48] hover:bg-[#25403D]" : "bg-[#7E9B6F] hover:bg-[#6E8A5F]"
                }`}
              >
                {viewingTask.completed ? "Mark Pending" : "Mark Complete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
