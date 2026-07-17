"use client";

import { Search, X, Eye, Trash2, Plus } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptTask } from "@/lib/adapters";
import { updateRecord, deleteRecord } from "@/lib/api";
import AddTaskModal from "@/components/portal/views/caregiver/AddTaskModal";

type CaregiverTask = ReturnType<typeof adaptTask>;

const getPriorityColor = (priority: string) => {
  switch (priority) {
    case "critical":
      return "bg-red-100 text-red-800 border-red-300";
    case "high":
      return "bg-orange-100 text-orange-800 border-orange-300";
    case "medium":
      return "bg-yellow-100 text-yellow-800 border-yellow-300";
    default:
      return "bg-green-100 text-green-800 border-green-300";
  }
};

const getCategoryIcon = (category: string) => {
  const icons: Record<string, string> = {
    Meals: "🍽️",
    Medication: "💊",
    Therapy: "🏃",
    Vitals: "❤️",
    "Personal Care": "🚿",
    Maintenance: "🧹",
    "Check-in": "👁️",
  };
  return icons[category] || "📋";
};

/** Task Checklist — live daily assist tasks with filters, pagination and bulk actions. */
export default function CaregiverTasks() {
  const {
    data: taskRows,
    loading: tasksLoading,
    error: tasksError,
    refetch: refetchTasks,
  } = useLiveQuery("tasks", { query: "include=resident&take=300", tables: ["Task", "Resident"] });
  const tasks = useMemo<CaregiverTask[]>(() => taskRows.map(adaptTask), [taskRows]);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [viewingTask, setViewingTask] = useState<CaregiverTask | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const allFilteredTasks = useMemo(() => {
    return tasks.filter((task) => {
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
    });
  }, [tasks, searchQuery, filterPriority, filterStatus]);

  const totalPages = Math.ceil(allFilteredTasks.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedTasks = allFilteredTasks.slice(startIndex, endIndex);

  // Reset to page 1 and clear selection when filters change.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- intentional: sync pagination + selection to filter changes */
    setCurrentPage(1);
    setSelectedTasks(new Set());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [searchQuery, filterPriority, filterStatus]);

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

  const handleSelectTask = (id: string) => {
    const newSelected = new Set(selectedTasks);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedTasks(newSelected);
  };

  const handleDeleteSelected = async () => {
    if (selectedTasks.size === 0) return;

    const result = await Swal.fire({
      title: "Delete Selected Tasks?",
      text: `Remove ${selectedTasks.size} task(s) from checklist?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel",
    });

    if (result.isConfirmed) {
      const ids = Array.from(selectedTasks);
      try {
        await Promise.all(ids.map((id) => deleteRecord("tasks", id)));
        setSelectedTasks(new Set());
        await refetchTasks();
        Swal.fire({
          title: "Deleted",
          text: `${ids.length} task(s) removed.`,
          icon: "success",
          timer: 1500,
          showConfirmButton: false,
        });
      } catch (err) {
        Swal.fire({
          title: "Delete Failed",
          text: err instanceof Error ? err.message : "Could not delete tasks.",
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Task Checklist
          </h1>
          <p className="text-gray-600">Manage daily tasks and track completion</p>
        </div>
        <button
          onClick={() => setCreatingTask(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" /> New Task
        </button>
      </div>

      {creatingTask && (
        <AddTaskModal
          onClose={() => setCreatingTask(false)}
          onSaved={() => { void refetchTasks(); setCreatingTask(false); }}
        />
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <p className="text-sm text-gray-600 font-semibold">Total Tasks</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{taskStats.total}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <p className="text-sm text-gray-600 font-semibold">Completed</p>
          <p className="text-3xl font-bold text-green-600 mt-1">{taskStats.completed}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <p className="text-sm text-gray-600 font-semibold">Pending</p>
          <p className="text-3xl font-bold text-blue-600 mt-1">{taskStats.pending}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border border-red-200 bg-red-50">
          <p className="text-sm text-red-700 font-semibold">Critical</p>
          <p className="text-3xl font-bold text-red-600 mt-1">{taskStats.critical}</p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search tasks, residents, categories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Priority Filter */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Priority</label>
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
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
            <label className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
            >
              <option value="all">All Tasks</option>
              <option value="pending">Pending Only</option>
              <option value="completed">Completed Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Items Per Page & Delete Selected */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <label className="text-sm font-semibold text-gray-700">Show:</label>
          <select
            value={itemsPerPage}
            onChange={(e) => {
              setItemsPerPage(parseInt(e.target.value));
              setCurrentPage(1);
            }}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
          >
            <option value={10}>10 per page</option>
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
          </select>
        </div>

        {selectedTasks.size > 0 && (
          <button
            onClick={handleDeleteSelected}
            className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition border border-red-200 font-medium"
          >
            <Trash2 className="w-4 h-4" />
            Delete Selected ({selectedTasks.size})
          </button>
        )}
      </div>

      {/* Tasks List */}
      <div className="space-y-3">
        {tasksLoading && tasks.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
            Loading tasks…
          </div>
        ) : tasksError ? (
          <div className="bg-white rounded-lg border border-red-200 p-8 text-center text-red-600">
            Failed to load tasks: {tasksError}
          </div>
        ) : paginatedTasks.length > 0 ? (
          paginatedTasks.map((task) => (
            <div
              key={task.id}
              className={`p-4 rounded-lg border transition ${
                task.completed
                  ? "bg-green-50 border-green-200"
                  : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm"
              }`}
            >
              <div className="flex items-start gap-4">
                <div className="flex gap-3 mt-1">
                  <input
                    type="checkbox"
                    checked={selectedTasks.has(task.id)}
                    onChange={() => handleSelectTask(task.id)}
                    className="w-5 h-5 rounded cursor-pointer"
                    title="Select for bulk actions"
                  />
                  <input
                    type="checkbox"
                    checked={task.completed}
                    onChange={() => handleToggleTask(task.id)}
                    className="w-5 h-5 rounded cursor-pointer"
                    title="Mark task complete"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <h4 className={`font-semibold text-lg ${task.completed ? "line-through text-gray-500" : "text-gray-900"}`}>
                        {getCategoryIcon(task.category)} {task.title}
                      </h4>
                      <p className="text-sm text-gray-600 mt-1">
                        {task.resident} • Room {task.room}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-1 rounded text-xs font-semibold border ${getPriorityColor(
                          task.priority
                        )}`}
                      >
                        {task.priority.toUpperCase()}
                      </span>
                      <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-medium">
                        {task.dueTime}
                      </span>
                    </div>
                  </div>

                  {task.notes && (
                    <p className="text-sm text-gray-600 mt-2 p-2 bg-gray-50 rounded border-l-2 border-yellow-400">
                      📝 {task.notes}
                    </p>
                  )}

                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => setViewingTask(task)}
                      className="flex items-center gap-1 px-3 py-1 text-blue-600 hover:bg-blue-50 rounded text-sm font-medium transition"
                    >
                      <Eye className="w-4 h-4" />
                      View
                    </button>
                    <button
                      onClick={() => handleDeleteTask(task.id)}
                      className="flex items-center gap-1 px-3 py-1 text-red-600 hover:bg-red-50 rounded text-sm font-medium transition"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
            No tasks match your filters.
          </div>
        )}
      </div>

      {/* Pagination */}
      {allFilteredTasks.length > 0 && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm text-gray-600">
            Showing {startIndex + 1}-{Math.min(endIndex, allFilteredTasks.length)} of {allFilteredTasks.length} tasks
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
            >
              Previous
            </button>

            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`px-3 py-2 rounded-lg font-medium transition ${
                    currentPage === page
                      ? "bg-yellow-400 text-black"
                      : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {page}
                </button>
              ))}
            </div>

            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Task Details Modal */}
      {viewingTask && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="sticky top-0 bg-gradient-to-r from-blue-400 to-blue-500 text-white p-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold">Task Details</h2>
              <button
                onClick={() => setViewingTask(null)}
                className="p-2 hover:bg-blue-600/20 rounded-lg transition"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-8 space-y-6">
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  {getCategoryIcon(viewingTask.category)} {viewingTask.title}
                </h3>
                <p className="text-gray-600">
                  {viewingTask.resident} • Room {viewingTask.room}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-600 mb-2">Category</label>
                  <p className="text-lg text-gray-900">{viewingTask.category}</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-600 mb-2">Due Time</label>
                  <p className="text-lg text-gray-900">{viewingTask.dueTime}</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-600 mb-2">Priority</label>
                  <span className={`px-3 py-1 rounded-full text-sm font-bold ${getPriorityColor(viewingTask.priority)}`}>
                    {viewingTask.priority.toUpperCase()}
                  </span>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-600 mb-2">Status</label>
                  <span className={`px-3 py-1 rounded-full text-sm font-bold ${viewingTask.completed ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
                    {viewingTask.completed ? "COMPLETED" : "PENDING"}
                  </span>
                </div>
              </div>

              {viewingTask.notes && (
                <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Notes</label>
                  <p className="text-gray-900">{viewingTask.notes}</p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-8 py-4 flex items-center justify-between">
              <button
                onClick={() => setViewingTask(null)}
                className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
              >
                Close
              </button>
              <button
                onClick={() => {
                  handleToggleTask(viewingTask.id);
                  setViewingTask(null);
                }}
                className="px-6 py-2 bg-gradient-to-r from-green-400 to-green-500 text-white font-semibold rounded-lg hover:shadow-lg transition"
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
