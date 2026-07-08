"use client";

import StatCard from "@/components/portal/widgets/StatCard";
import ChartContainer from "@/components/portal/widgets/ChartContainer";
import LandingCustomizerContent from "@/components/portal/views/LandingCustomizerContent";
import { Users, AlertTriangle, Zap, Trash2, Search, Eye, Edit, X } from "lucide-react";
import { useState, useMemo } from "react";
import Swal from "sweetalert2";
import { useLiveQuery, useStats } from "@/lib/useLiveQuery";
import { adaptStaff } from "@/lib/adapters";
import { updateRecord, deleteRecord } from "@/lib/api";

interface SuperAdminPortalContentProps {
  tab: string;
}

type StaffMember = ReturnType<typeof adaptStaff>;

export default function SuperAdminPortalContent({ tab }: SuperAdminPortalContentProps) {
  const { stats } = useStats();
  const { data: staffRows, loading, error, refetch } = useLiveQuery<Record<string, unknown>>("staff", {
    query: "include=user",
    tables: ["Staff", "User"],
  });
  const staff = useMemo(() => staffRows.map(adaptStaff), [staffRows]);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStaff, setSelectedStaff] = useState<Set<string>>(new Set());
  const [viewingStaff, setViewingStaff] = useState<StaffMember | null>(null);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    position: "",
    department: "",
    email: "",
    phone: "",
    status: "Active" as "Active" | "Inactive",
  });

  const filteredStaff = useMemo(() => {
    return staff.filter((s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.position.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.department.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.email.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [staff, searchQuery]);

  const handleSelectAll = () => {
    if (selectedStaff.size === filteredStaff.length) {
      setSelectedStaff(new Set());
    } else {
      setSelectedStaff(new Set(filteredStaff.map((s) => s.id)));
    }
  };

  const handleSelectStaff = (id: string) => {
    const newSelected = new Set(selectedStaff);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedStaff(newSelected);
  };

  const handleDeleteSelected = async () => {
    if (selectedStaff.size === 0) return;

    const result = await Swal.fire({
      title: "Delete Staff Members?",
      text: `You are about to delete ${selectedStaff.size} staff member(s). This action cannot be undone.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel",
    });

    if (result.isConfirmed) {
      const count = selectedStaff.size;
      try {
        for (const id of selectedStaff) {
          await deleteRecord("staff", id);
        }
        await refetch();
        setSelectedStaff(new Set());
        Swal.fire({
          title: "Deleted",
          text: `${count} staff member(s) have been removed.`,
          icon: "success",
          timer: 1500,
          showConfirmButton: false,
        });
      } catch (err) {
        Swal.fire({
          title: "Delete Failed",
          text: err instanceof Error ? err.message : "Could not delete staff member(s).",
          icon: "error",
        });
      }
    }
  };

  const startEditing = (member: StaffMember) => {
    setEditingStaff(member);
    setEditForm({
      name: member.name,
      position: member.position,
      department: member.department,
      email: member.email,
      phone: member.phone,
      status: member.status,
    });
  };

  const handleSaveEdit = async () => {
    const result = await Swal.fire({
      title: "Save Changes?",
      text: `Update ${editForm.name}'s staff record?`,
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#fbbf24",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Save",
      cancelButtonText: "Cancel",
    });

    if (result.isConfirmed) {
      if (!editingStaff) return;
      try {
        await updateRecord("staff", editingStaff.id, {
          position: editForm.position,
          department: editForm.department,
          isActive: editForm.status === "Active",
        });
        const userId = editingStaff.raw?.userId;
        if (userId) {
          await updateRecord("users", userId, {
            name: editForm.name,
            email: editForm.email,
            phone: editForm.phone,
          });
        }
        await refetch();
        setEditingStaff(null);
        setViewingStaff(null);
        Swal.fire({
          title: "Saved",
          text: `${editForm.name}'s record has been updated.`,
          icon: "success",
          timer: 1500,
          showConfirmButton: false,
        });
      } catch (err) {
        Swal.fire({
          title: "Save Failed",
          text: err instanceof Error ? err.message : "Could not update staff record.",
          icon: "error",
        });
      }
    }
  };

  const mockOccupancyData = [
    { name: "Week 1", value: 28 },
    { name: "Week 2", value: 29 },
    { name: "Week 3", value: 30 },
    { name: "Week 4", value: 31 },
  ];

  const mockStaffData = [
    { name: "Mon", value: 12 },
    { name: "Tue", value: 12 },
    { name: "Wed", value: 11 },
    { name: "Thu", value: 12 },
    { name: "Fri", value: 13 },
    { name: "Sat", value: 10 },
  ];

  if (tab === "appearance") {
    return <LandingCustomizerContent />;
  }

  if (tab === "staff") {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent mb-2">
              Staff Registry
            </h1>
            <p className="text-gray-600">Manage facility staff members, positions, and status</p>
          </div>
          {selectedStaff.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition border border-red-200 font-medium"
            >
              <Trash2 className="w-4 h-4" />
              Delete Selected ({selectedStaff.size})
            </button>
          )}
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, position, department, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
          />
        </div>

        {/* Error Banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            Failed to load staff: {error}
          </div>
        )}

        {/* Loading State */}
        {loading && staff.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
            <div className="inline-block w-6 h-6 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin mb-3" />
            <p>Loading staff…</p>
          </div>
        ) : (
        <>
        {/* Desktop Table */}
        <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-gray-600 font-semibold">
                  <th className="px-6 py-4 w-12">
                    <input
                      type="checkbox"
                      checked={selectedStaff.size === filteredStaff.length && filteredStaff.length > 0}
                      onChange={handleSelectAll}
                      className="rounded cursor-pointer"
                    />
                  </th>
                  <th className="px-6 py-4">Name</th>
                  <th className="px-6 py-4">Position</th>
                  <th className="px-6 py-4">Department</th>
                  <th className="px-6 py-4">Email</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredStaff.length > 0 ? (
                  filteredStaff.map((staff) => (
                    <tr key={staff.id} className="hover:bg-gray-50 transition">
                      <td className="px-6 py-4">
                        <input
                          type="checkbox"
                          checked={selectedStaff.has(staff.id)}
                          onChange={() => handleSelectStaff(staff.id)}
                          className="rounded cursor-pointer"
                        />
                      </td>
                      <td className="px-6 py-4 font-medium text-gray-900">{staff.name}</td>
                      <td className="px-6 py-4 text-gray-700">{staff.position}</td>
                      <td className="px-6 py-4 text-gray-700">{staff.department}</td>
                      <td className="px-6 py-4 text-gray-600 text-xs">{staff.email}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${
                            staff.status === "Active"
                              ? "bg-green-100 text-green-800"
                              : "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {staff.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setViewingStaff(staff)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                            title="View details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => startEditing(staff)}
                            className="p-2 text-yellow-600 hover:bg-yellow-50 rounded-lg transition"
                            title="Edit record"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                      No staff members found matching your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden space-y-3">
          {filteredStaff.length > 0 ? (
            filteredStaff.map((staff) => (
              <div key={staff.id} className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedStaff.has(staff.id)}
                    onChange={() => handleSelectStaff(staff.id)}
                    className="rounded cursor-pointer mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900 truncate">{staff.name}</h3>
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${
                          staff.status === "Active"
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {staff.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 truncate">{staff.position}</p>
                    <p className="text-xs text-gray-500 truncate">{staff.department}</p>
                    <p className="text-xs text-gray-500 truncate mt-1">{staff.email}</p>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => setViewingStaff(staff)}
                        className="flex-1 px-3 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded text-sm font-medium transition"
                      >
                        <Eye className="w-4 h-4 inline mr-1" />
                        View
                      </button>
                      <button
                        onClick={() => startEditing(staff)}
                        className="flex-1 px-3 py-2 bg-yellow-50 text-yellow-600 hover:bg-yellow-100 rounded text-sm font-medium transition"
                      >
                        <Edit className="w-4 h-4 inline mr-1" />
                        Edit
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
              No staff members found matching your search.
            </div>
          )}
        </div>

        {/* Results Summary */}
        <div className="text-sm text-gray-600">
          Showing {filteredStaff.length} of {staff.length} staff members
          {selectedStaff.size > 0 && ` • ${selectedStaff.size} selected`}
        </div>
        </>
        )}

        {/* View Modal */}
        {viewingStaff && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              {/* View Modal Header */}
              <div className="sticky top-0 bg-gradient-to-r from-blue-400 to-blue-500 text-white p-6 flex items-center justify-between border-b border-blue-600">
                <h2 className="text-2xl font-bold">Staff Details</h2>
                <button
                  onClick={() => setViewingStaff(null)}
                  className="p-2 hover:bg-blue-600/20 rounded-lg transition"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* View Modal Content */}
              <div className="p-8 space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Full Name</label>
                    <p className="text-lg font-medium text-gray-900">{viewingStaff.name}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Email</label>
                    <p className="text-lg text-gray-900">{viewingStaff.email}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Position</label>
                    <p className="text-lg text-gray-900">{viewingStaff.position}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Phone</label>
                    <p className="text-lg text-gray-900">{viewingStaff.phone}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Department</label>
                    <p className="text-lg text-gray-900">{viewingStaff.department}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Status</label>
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-medium ${
                        viewingStaff.status === "Active"
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {viewingStaff.status}
                    </span>
                  </div>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg">
                  <label className="block text-sm font-semibold text-gray-600 mb-2">Start Date</label>
                  <p className="text-gray-900">{viewingStaff.startDate}</p>
                </div>
              </div>

              {/* View Modal Footer */}
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-8 py-4 flex items-center justify-between">
                <button
                  onClick={() => setViewingStaff(null)}
                  className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    startEditing(viewingStaff);
                    setViewingStaff(null);
                  }}
                  className="px-6 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95"
                >
                  Edit Staff Member
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {editingStaff && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              {/* Edit Modal Header */}
              <div className="sticky top-0 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black p-6 flex items-center justify-between border-b border-yellow-600">
                <h2 className="text-2xl font-bold">Edit Staff Member</h2>
                <button
                  onClick={() => setEditingStaff(null)}
                  className="p-2 hover:bg-yellow-600/20 rounded-lg transition"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Edit Form */}
              <div className="p-8 space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Full Name</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Email</label>
                    <input
                      type="email"
                      value={editForm.email}
                      onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Position</label>
                    <input
                      type="text"
                      value={editForm.position}
                      onChange={(e) => setEditForm({ ...editForm, position: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Phone</label>
                    <input
                      type="tel"
                      value={editForm.phone}
                      onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Department</label>
                    <input
                      type="text"
                      value={editForm.department}
                      onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
                    <select
                      value={editForm.status}
                      onChange={(e) => setEditForm({ ...editForm, status: e.target.value as "Active" | "Inactive" })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                    >
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Edit Modal Footer */}
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-8 py-4 flex items-center justify-between">
                <button
                  onClick={() => setEditingStaff(null)}
                  className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-6 py-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }


  // Default: Admin Dashboard tab
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent mb-2">
          Admin Dashboard
        </h1>
        <p className="text-gray-600">Facility operations, systems health, and real-time metrics</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Total Residents"
          value={String(stats?.residents ?? 0)}
          icon={Users}
          trend={{ direction: "up", percent: 3 }}
          backgroundColor="bg-blue-50"
          textColor="text-blue-900"
          iconColor="text-blue-500"
        />
        <StatCard
          title="Active Incidents"
          value={String(stats?.activeIncidents ?? 0)}
          icon={AlertTriangle}
          backgroundColor="bg-red-50"
          textColor="text-red-900"
          iconColor="text-red-500"
        />
        <StatCard
          title="Staff On Duty"
          value={String(stats?.activeStaff ?? 0)}
          icon={Users}
          backgroundColor="bg-green-50"
          textColor="text-green-900"
          iconColor="text-green-500"
        />
        <StatCard
          title="System Health"
          value="Optimal"
          icon={Zap}
          backgroundColor="bg-emerald-50"
          textColor="text-emerald-900"
          iconColor="text-emerald-500"
        />
      </div>

      {/* Charts */}
      <ChartContainer
        title="Occupancy Trend (Monthly)"
        type="area"
        data={mockOccupancyData}
        dataKey="value"
        xAxisKey="name"
        colors={["#3b82f6"]}
        height={250}
      />

      <ChartContainer
        title="Staff Attendance (Weekly)"
        type="bar"
        data={mockStaffData}
        dataKey="value"
        xAxisKey="name"
        colors={["#10b981"]}
      />

      {/* System Telemetry Section */}
      <div className="space-y-4">
        <h3 className="text-xl font-bold text-gray-900">System Telemetry</h3>
        <div className="bg-white rounded-lg p-6 border border-gray-200 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4">
              <p className="text-sm text-green-700 font-semibold">API Response Time</p>
              <p className="text-3xl font-bold text-green-600 mt-2">45ms</p>
              <p className="text-xs text-green-600 mt-1">Excellent performance</p>
            </div>
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4">
              <p className="text-sm text-blue-700 font-semibold">Database Load</p>
              <p className="text-3xl font-bold text-blue-600 mt-2">32%</p>
              <p className="text-xs text-blue-600 mt-1">Healthy capacity</p>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4">
              <p className="text-sm text-purple-700 font-semibold">Active Sessions</p>
              <p className="text-3xl font-bold text-purple-600 mt-2">8</p>
              <p className="text-xs text-purple-600 mt-1">Currently online</p>
            </div>
          </div>
        </div>
        <ChartContainer
          title="Daily Active Users"
          type="bar"
          data={mockStaffData}
          dataKey="value"
          xAxisKey="name"
          colors={["#3b82f6"]}
        />
      </div>
    </div>
  );
}
