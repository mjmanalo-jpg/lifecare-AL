"use client";

import StatCard from "@/components/portal/widgets/StatCard";
import ResidentCard from "@/components/portal/widgets/ResidentCard";
import { CheckCircle, Users, Clock, AlertTriangle, Search, Filter, X, Eye, Trash2, Heart, Droplets, Wind, Thermometer } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import Swal from "sweetalert2";

interface CaregiverPortalContentProps {
  tab: string;
}

const mockTasksData = [
  { id: "1", title: "Assist Arthur with breakfast", resident: "Arthur Pendelton", room: "302", dueTime: "8:00 AM", priority: "high", category: "Meals", completed: true, notes: "Use soft foods, assist with utensils" },
  { id: "2", title: "Medication distribution", resident: "Eleanor Fitzroy", room: "305", dueTime: "10:00 AM", priority: "critical", category: "Medication", completed: false, notes: "Blood pressure med + daily vitamin" },
  { id: "3", title: "Physical therapy session", resident: "Robert Chen", room: "310", dueTime: "2:00 PM", priority: "high", category: "Therapy", completed: false, notes: "30-min session, track mobility" },
  { id: "4", title: "Assist Eleanor with lunch", resident: "Eleanor Fitzroy", room: "305", dueTime: "12:00 PM", priority: "medium", category: "Meals", completed: false, notes: "Low sodium diet" },
  { id: "5", title: "Room cleaning & laundry", resident: "Arthur Pendelton", room: "302", dueTime: "11:00 AM", priority: "medium", category: "Maintenance", completed: false, notes: "Change bedding" },
  { id: "6", title: "Call bell check", resident: "Robert Chen", room: "310", dueTime: "3:00 PM", priority: "low", category: "Check-in", completed: false, notes: "Routine check-in" },
  { id: "7", title: "Monitor vital signs", resident: "Eleanor Fitzroy", room: "305", dueTime: "9:00 AM", priority: "critical", category: "Vitals", completed: true, notes: "Record BP, HR, Temp" },
  { id: "8", title: "Assist with bathing", resident: "Arthur Pendelton", room: "302", dueTime: "4:00 PM", priority: "high", category: "Personal Care", completed: false, notes: "Safety equipment ready" },
];

export default function CaregiverPortalContent({ tab }: CaregiverPortalContentProps) {
  const [tasks, setTasks] = useState(mockTasksData);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [viewingTask, setViewingTask] = useState<typeof mockTasksData[0] | null>(null);
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

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
    setSelectedTasks(new Set());
  }, [searchQuery, filterPriority, filterStatus]);

  const handleToggleTask = (id: string) => {
    setTasks(
      tasks.map((t) =>
        t.id === id ? { ...t, completed: !t.completed } : t
      )
    );
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
      setTasks(tasks.filter((t) => t.id !== id));
      Swal.fire({
        title: "Deleted",
        text: "Task removed.",
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
    }
  };

  const handleSelectAll = () => {
    if (selectedTasks.size === paginatedTasks.length) {
      setSelectedTasks(new Set());
    } else {
      setSelectedTasks(new Set(paginatedTasks.map((t) => t.id)));
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
      setTasks(tasks.filter((t) => !selectedTasks.has(t.id)));
      setSelectedTasks(new Set());
      Swal.fire({
        title: "Deleted",
        text: `${selectedTasks.size} task(s) removed.`,
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
    }
  };

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

  const taskStats = {
    total: tasks.length,
    completed: tasks.filter((t) => t.completed).length,
    pending: tasks.filter((t) => !t.completed).length,
    critical: tasks.filter((t) => t.priority === "critical" && !t.completed).length,
  };

  const mockResidentsData = [
    {
      id: "1",
      name: "Arthur Pendelton",
      room: "302",
      age: 78,
      careLevel: "ASSISTED" as const,
      status: "ACTIVE" as const,
      alertsCount: 0,
      vitals: { hr: 72, bp: "138/82", temp: 98.6, o2: 96 },
      medications: ["Lisinopril 10mg", "Metformin 500mg"],
      conditions: ["Hypertension", "Type 2 Diabetes"],
      lastCheckIn: "2 hours ago",
      notes: "Stable condition. Regular monitoring.",
    },
    {
      id: "2",
      name: "Eleanor Fitzroy",
      room: "305",
      age: 85,
      careLevel: "MEMORY" as const,
      status: "ACTIVE" as const,
      alertsCount: 1,
      vitals: { hr: 68, bp: "126/76", temp: 98.4, o2: 97 },
      medications: ["Donepezil 5mg", "Aspirin 81mg"],
      conditions: ["Alzheimer's", "Arthritis"],
      lastCheckIn: "1 hour ago",
      notes: "Alert: Memory decline noted. Increase supervision.",
    },
    {
      id: "3",
      name: "Robert Chen",
      room: "310",
      age: 72,
      careLevel: "INDEPENDENT" as const,
      status: "ACTIVE" as const,
      alertsCount: 0,
      vitals: { hr: 75, bp: "128/80", temp: 98.5, o2: 98 },
      medications: ["Atorvastatin 20mg"],
      conditions: ["High Cholesterol"],
      lastCheckIn: "3 hours ago",
      notes: "Excellent condition. Self-sufficient.",
    },
    {
      id: "4",
      name: "Margaret Wilson",
      room: "312",
      age: 80,
      careLevel: "SKILLED" as const,
      status: "ACTIVE" as const,
      alertsCount: 2,
      vitals: { hr: 82, bp: "142/88", temp: 99.2, o2: 94 },
      medications: ["Warfarin", "Furosemide 40mg", "Lisinopril 10mg"],
      conditions: ["Atrial Fibrillation", "Heart Failure"],
      lastCheckIn: "30 minutes ago",
      notes: "Alert: BP elevated. Monitor closely. Alert: O2 low.",
    },
    {
      id: "5",
      name: "James Murphy",
      room: "308",
      age: 76,
      careLevel: "ASSISTED" as const,
      status: "RECOVERING" as const,
      alertsCount: 0,
      vitals: { hr: 70, bp: "130/78", temp: 98.3, o2: 97 },
      medications: ["Physical Therapy Protocol"],
      conditions: ["Post-Surgery Recovery", "Mobility Limited"],
      lastCheckIn: "4 hours ago",
      notes: "Recovering well. PT sessions progressing.",
    },
  ];

  const [residents, setResidents] = useState(mockResidentsData);
  const [residentSearch, setResidentSearch] = useState("");
  const [residentFilterStatus, setResidentFilterStatus] = useState<string>("all");
  const [residentFilterCare, setResidentFilterCare] = useState<string>("all");
  const [viewingResident, setViewingResident] = useState<typeof mockResidentsData[0] | null>(null);
  const [residentPage, setResidentPage] = useState(1);
  const [residentItemsPerPage, setResidentItemsPerPage] = useState(10);

  const filteredResidents = useMemo(() => {
    return residents.filter((resident) => {
      const matchesSearch =
        resident.name.toLowerCase().includes(residentSearch.toLowerCase()) ||
        resident.room.toLowerCase().includes(residentSearch.toLowerCase());

      const matchesStatus = residentFilterStatus === "all" || resident.status === residentFilterStatus;
      const matchesCare = residentFilterCare === "all" || resident.careLevel === residentFilterCare;

      return matchesSearch && matchesStatus && matchesCare;
    });
  }, [residents, residentSearch, residentFilterStatus, residentFilterCare]);

  const residentTotalPages = Math.ceil(filteredResidents.length / residentItemsPerPage);
  const residentStartIndex = (residentPage - 1) * residentItemsPerPage;
  const residentEndIndex = residentStartIndex + residentItemsPerPage;
  const paginatedResidents = filteredResidents.slice(residentStartIndex, residentEndIndex);

  useEffect(() => {
    setResidentPage(1);
  }, [residentSearch, residentFilterStatus, residentFilterCare]);

  if (tab === "tasks") {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent mb-2">
            Task Checklist
          </h1>
          <p className="text-gray-600">Manage daily tasks and track completion</p>
        </div>

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
          {paginatedTasks.length > 0 ? (
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

  if (tab === "residents") {
    const residentStats = {
      total: residents.length,
      active: residents.filter((r) => r.status === "ACTIVE").length,
      withAlerts: residents.filter((r) => r.alertsCount > 0).length,
      recovering: residents.filter((r) => r.status === "RECOVERING").length,
    };

    const getCareColor = (level: string) => {
      switch (level) {
        case "INDEPENDENT":
          return "bg-green-100 text-green-800";
        case "ASSISTED":
          return "bg-blue-100 text-blue-800";
        case "MEMORY":
          return "bg-purple-100 text-purple-800";
        case "SKILLED":
          return "bg-red-100 text-red-800";
        default:
          return "bg-gray-100 text-gray-800";
      }
    };

    const getStatusColor = (status: string) => {
      switch (status) {
        case "ACTIVE":
          return "bg-green-100 text-green-800";
        case "RECOVERING":
          return "bg-yellow-100 text-yellow-800";
        case "ALERT":
          return "bg-red-100 text-red-800";
        default:
          return "bg-gray-100 text-gray-800";
      }
    };

    return (
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent mb-2">
            Resident Status
          </h1>
          <p className="text-gray-600">Monitor assigned residents and their health status</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <p className="text-sm text-gray-600 font-semibold">Total Residents</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{residentStats.total}</p>
          </div>
          <div className="bg-white p-4 rounded-lg border border-green-200 bg-green-50">
            <p className="text-sm text-green-700 font-semibold">Active</p>
            <p className="text-3xl font-bold text-green-600 mt-1">{residentStats.active}</p>
          </div>
          <div className="bg-white p-4 rounded-lg border border-yellow-200 bg-yellow-50">
            <p className="text-sm text-yellow-700 font-semibold">Recovering</p>
            <p className="text-3xl font-bold text-yellow-600 mt-1">{residentStats.recovering}</p>
          </div>
          <div className="bg-white p-4 rounded-lg border border-red-200 bg-red-50">
            <p className="text-sm text-red-700 font-semibold">With Alerts</p>
            <p className="text-3xl font-bold text-red-600 mt-1">{residentStats.withAlerts}</p>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or room number..."
              value={residentSearch}
              onChange={(e) => setResidentSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
              <select
                value={residentFilterStatus}
                onChange={(e) => setResidentFilterStatus(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
              >
                <option value="all">All Status</option>
                <option value="ACTIVE">Active</option>
                <option value="RECOVERING">Recovering</option>
                <option value="ALERT">Alert</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Care Level</label>
              <select
                value={residentFilterCare}
                onChange={(e) => setResidentFilterCare(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
              >
                <option value="all">All Levels</option>
                <option value="INDEPENDENT">Independent</option>
                <option value="ASSISTED">Assisted</option>
                <option value="MEMORY">Memory Care</option>
                <option value="SKILLED">Skilled Nursing</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Show per page</label>
              <select
                value={residentItemsPerPage}
                onChange={(e) => {
                  setResidentItemsPerPage(parseInt(e.target.value));
                  setResidentPage(1);
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
              >
                <option value={10}>10 per page</option>
                <option value={25}>25 per page</option>
                <option value={50}>50 per page</option>
                <option value={100}>100 per page</option>
              </select>
            </div>
          </div>
        </div>

        {/* Residents Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {paginatedResidents.length > 0 ? (
            paginatedResidents.map((resident) => (
              <div
                key={resident.id}
                className="bg-white rounded-lg border border-gray-200 hover:border-yellow-300 hover:shadow-lg transition overflow-hidden"
              >
                {/* Card Header */}
                <div className={`p-4 ${resident.alertsCount > 0 ? "bg-red-50 border-b-2 border-red-300" : "bg-gray-50 border-b border-gray-200"}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">{resident.name}</h3>
                      <p className="text-sm text-gray-600">Room {resident.room} • Age {resident.age}</p>
                    </div>
                    {resident.alertsCount > 0 && (
                      <span className="px-2 py-1 bg-red-500 text-white rounded-full text-xs font-bold">
                        🚨 {resident.alertsCount}
                      </span>
                    )}
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${getCareColor(resident.careLevel)}`}>
                      {resident.careLevel.replace("_", " ")}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${getStatusColor(resident.status)}`}>
                      {resident.status}
                    </span>
                  </div>
                </div>

                {/* Vitals Section */}
                <div className="p-4 border-b border-gray-200">
                  <p className="text-xs font-semibold text-gray-600 mb-3">VITAL SIGNS</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-2 bg-gray-50 p-2 rounded">
                      <Heart className="w-4 h-4 text-red-500" />
                      <div>
                        <p className="text-xs text-gray-600">HR</p>
                        <p className="font-bold text-gray-900">{resident.vitals.hr} bpm</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 bg-gray-50 p-2 rounded">
                      <Droplets className="w-4 h-4 text-blue-500" />
                      <div>
                        <p className="text-xs text-gray-600">BP</p>
                        <p className="font-bold text-gray-900">{resident.vitals.bp}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 bg-gray-50 p-2 rounded">
                      <Thermometer className="w-4 h-4 text-orange-500" />
                      <div>
                        <p className="text-xs text-gray-600">Temp</p>
                        <p className="font-bold text-gray-900">{resident.vitals.temp}°F</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 bg-gray-50 p-2 rounded">
                      <Wind className="w-4 h-4 text-green-500" />
                      <div>
                        <p className="text-xs text-gray-600">O₂</p>
                        <p className="font-bold text-gray-900">{resident.vitals.o2}%</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Last Check-in */}
                <div className="px-4 py-3 bg-blue-50 border-b border-blue-200">
                  <p className="text-xs text-blue-700 font-semibold">Last Check-in: {resident.lastCheckIn}</p>
                </div>

                {/* Actions */}
                <div className="p-4">
                  <button
                    onClick={() => setViewingResident(resident)}
                    className="w-full px-4 py-2 bg-gradient-to-r from-blue-400 to-blue-500 text-white font-semibold rounded-lg hover:shadow-lg transition active:scale-95"
                  >
                    View Details
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
              No residents match your filters.
            </div>
          )}
        </div>

        {/* Pagination */}
        {filteredResidents.length > 0 && (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="text-sm text-gray-600">
              Showing {residentStartIndex + 1}-{Math.min(residentEndIndex, filteredResidents.length)} of {filteredResidents.length} residents
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setResidentPage(Math.max(1, residentPage - 1))}
                disabled={residentPage === 1}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
              >
                Previous
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: residentTotalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => setResidentPage(page)}
                    className={`px-3 py-2 rounded-lg font-medium transition ${
                      residentPage === page
                        ? "bg-yellow-400 text-black"
                        : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setResidentPage(Math.min(residentTotalPages, residentPage + 1))}
                disabled={residentPage === residentTotalPages}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Resident Details Modal */}
        {viewingResident && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
              {/* Modal Header */}
              <div className="sticky top-0 bg-gradient-to-r from-blue-400 to-blue-500 text-white p-6 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold">{viewingResident.name}</h2>
                  <p className="text-blue-100">Room {viewingResident.room} • Age {viewingResident.age}</p>
                </div>
                <button
                  onClick={() => setViewingResident(null)}
                  className="p-2 hover:bg-blue-600/20 rounded-lg transition"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-8 space-y-6">
                {/* Status & Care Level */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Status</label>
                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold ${getStatusColor(viewingResident.status)}`}>
                      {viewingResident.status}
                    </span>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Care Level</label>
                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold ${getCareColor(viewingResident.careLevel)}`}>
                      {viewingResident.careLevel}
                    </span>
                  </div>
                </div>

                {/* Vitals */}
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                  <h3 className="font-bold text-gray-900 mb-4">Current Vital Signs</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white p-3 rounded border border-gray-300">
                      <p className="text-xs text-gray-600 font-semibold">Heart Rate</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">{viewingResident.vitals.hr}</p>
                      <p className="text-xs text-gray-500">bpm</p>
                    </div>
                    <div className="bg-white p-3 rounded border border-gray-300">
                      <p className="text-xs text-gray-600 font-semibold">Blood Pressure</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">{viewingResident.vitals.bp}</p>
                      <p className="text-xs text-gray-500">mmHg</p>
                    </div>
                    <div className="bg-white p-3 rounded border border-gray-300">
                      <p className="text-xs text-gray-600 font-semibold">Temperature</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">{viewingResident.vitals.temp}</p>
                      <p className="text-xs text-gray-500">°F</p>
                    </div>
                    <div className="bg-white p-3 rounded border border-gray-300">
                      <p className="text-xs text-gray-600 font-semibold">Oxygen</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">{viewingResident.vitals.o2}</p>
                      <p className="text-xs text-gray-500">%</p>
                    </div>
                  </div>
                </div>

                {/* Medications */}
                <div>
                  <h3 className="font-bold text-gray-900 mb-3">Current Medications</h3>
                  <div className="space-y-2">
                    {viewingResident.medications.map((med, idx) => (
                      <div key={idx} className="flex items-center gap-2 p-2 bg-blue-50 rounded border border-blue-200">
                        <span className="text-blue-600">💊</span>
                        <span className="text-gray-900">{med}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Conditions */}
                <div>
                  <h3 className="font-bold text-gray-900 mb-3">Medical Conditions</h3>
                  <div className="space-y-2">
                    {viewingResident.conditions.map((cond, idx) => (
                      <div key={idx} className="flex items-center gap-2 p-2 bg-purple-50 rounded border border-purple-200">
                        <span className="text-purple-600">📋</span>
                        <span className="text-gray-900">{cond}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Notes */}
                {viewingResident.notes && (
                  <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
                    <h3 className="font-bold text-gray-900 mb-2">Care Notes</h3>
                    <p className="text-gray-900">{viewingResident.notes}</p>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-8 py-4 flex items-center justify-between">
                <button
                  onClick={() => setViewingResident(null)}
                  className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
                >
                  Close
                </button>
                <button className="px-6 py-2 bg-gradient-to-r from-blue-400 to-blue-500 text-white font-semibold rounded-lg hover:shadow-lg transition">
                  Quick Action
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (tab === "reports") {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Shift Reports</h2>
        <div className="bg-white rounded-lg p-6 border border-gray-200">
          <p className="text-gray-600">Shift reports feature coming soon</p>
        </div>
      </div>
    );
  }

  // Default: Dashboard tab
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Shift Dashboard</h2>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Assigned Residents"
          value="5"
          icon={Users}
          backgroundColor="bg-blue-50"
          textColor="text-blue-900"
          iconColor="text-blue-500"
        />
        <StatCard
          title="Tasks Today"
          value="8"
          icon={CheckCircle}
          backgroundColor="bg-green-50"
          textColor="text-green-900"
          iconColor="text-green-500"
        />
        <StatCard
          title="Shift Time"
          value="6h 30m"
          icon={Clock}
          backgroundColor="bg-purple-50"
          textColor="text-purple-900"
          iconColor="text-purple-500"
        />
        <StatCard
          title="Urgent Alerts"
          value="1"
          icon={AlertTriangle}
          backgroundColor="bg-red-50"
          textColor="text-red-900"
          iconColor="text-red-500"
        />
      </div>

      {/* Pending Tasks */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Pending Tasks</h3>
        <div className="space-y-3">
          {tasks
            .filter((t) => !t.completed)
            .map((task) => (
              <div key={task.id} className="p-4 bg-white rounded-lg border border-gray-200">
                <div className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1 w-5 h-5 rounded" />
                  <div className="flex-1">
                    <h4 className="font-semibold text-gray-900">{task.title}</h4>
                    <p className="text-sm text-gray-600 mt-1">
                      {task.resident} • {task.dueTime}
                    </p>
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
