"use client";

import LandingCustomizerContent from "@/components/portal/views/LandingCustomizerContent";
import SuperAdminDashboard from "@/components/portal/views/SuperAdminDashboard";
import AIAssistantContent from "@/components/portal/ai/AIAssistantContent";
import OnboardingHub from "@/components/portal/views/OnboardingHub";
import FacilityResidents from "@/components/portal/views/FacilityResidents";
import PhysicianCarePlans from "@/components/portal/views/physician/PhysicianCarePlans";
import CaregiverTasks from "@/components/portal/views/caregiver/CaregiverTasks";
import FacilityUnifiedView from "@/components/portal/views/FacilityUnifiedView";
import AlertCenter from "@/components/portal/views/clinical/AlertCenter";
import FacilityInventory from "@/components/portal/views/FacilityInventory";
import EscalationsBoard from "@/components/portal/views/clinical/EscalationsBoard";
import DailyDocumentation from "@/components/portal/views/clinical/DailyDocumentation";
import CarePlanBoard from "@/components/portal/views/clinical/CarePlanBoard";
import VaccinationTracker from "@/components/portal/views/clinical/VaccinationTracker";
import ResidentDocuments from "@/components/portal/views/clinical/ResidentDocuments";
import MARBoard from "@/components/portal/views/clinical/MARBoard";
import AuditLogViewer from "@/components/portal/views/clinical/AuditLogViewer";
import ClinicalReports from "@/components/portal/views/clinical/ClinicalReports";
import InventoryAlertsPanel from "@/components/portal/views/clinical/InventoryAlertsPanel";
import DailyRoundsBoard from "@/components/portal/views/clinical/DailyRoundsBoard";
import CameraActivityLog from "@/components/portal/views/clinical/CameraActivityLog";
import AssessmentAcuityBoard from "@/components/portal/views/clinical/AssessmentAcuityBoard";
import FeatureMatrixDashboard from "@/components/portal/views/superadmin/FeatureMatrixDashboard";
import { Trash2, Search, Eye, Edit, X, UserPlus } from "lucide-react";
import { useState, useMemo } from "react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptStaff } from "@/lib/adapters";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

interface SuperAdminPortalContentProps {
  tab: string;
}

type StaffMember = ReturnType<typeof adaptStaff>;

export default function SuperAdminPortalContent({ tab }: SuperAdminPortalContentProps) {
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
    active: "Active" as "Active" | "Inactive",
    approved: "Approved" as "Approved" | "Disapproved",
    avatarUrl: "",
    experience: "",
    documents: [] as { name: string; url: string; type: string }[],
  });
  const [uploading, setUploading] = useState(false);

  // Add Staff modal state
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    email: "",
    phone: "",
    position: "",
    department: "",
    active: "Active" as "Active" | "Inactive",
    approved: "Approved" as "Approved" | "Disapproved",
    experience: "",
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
      active: member.active,
      approved: member.approved,
      avatarUrl: member.avatarUrl ?? "",
      experience: member.experience ?? "",
      documents: Array.isArray(member.documents) ? member.documents : [],
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
          isActive: editForm.active === "Active",
          isApproved: editForm.approved === "Approved",
          avatarUrl: editForm.avatarUrl || null,
          experience: editForm.experience || null,
          documents: editForm.documents.length > 0 ? editForm.documents : null,
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

  const handleCreateStaff = async () => {
    if (!createForm.name.trim() || !createForm.email.trim()) {
      Swal.fire({ title: "Missing Fields", text: "Name and email are required.", icon: "warning" });
      return;
    }
    const result = await Swal.fire({
      title: "Add Staff Member?",
      text: `Create a new staff record for ${createForm.name}?`,
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#fbbf24",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Create",
      cancelButtonText: "Cancel",
    });
    if (!result.isConfirmed) return;
    try {
      // Create the user first
      const newUser = await createRecord("users", {
        name: createForm.name,
        email: createForm.email,
        phone: createForm.phone,
        role: "CAREGIVER",
      });
      // Then create the staff record linked to the user
      await createRecord("staff", {
        userId: newUser.id,
        position: createForm.position,
        department: createForm.department,
        isActive: createForm.active === "Active",
        isApproved: createForm.approved === "Approved",
        experience: createForm.experience || null,
      });
      await refetch();
      setCreatingStaff(false);
      setCreateForm({ name: "", email: "", phone: "", position: "", department: "", active: "Active", approved: "Approved", experience: "" });
      Swal.fire({
        title: "Staff Created",
        text: `${createForm.name} has been added to the registry.`,
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire({
        title: "Create Failed",
        text: err instanceof Error ? err.message : "Could not create staff record.",
        icon: "error",
      });
    }
  };

  // Combined onboarding hub: Admissions + Resident Registration as tabs.
  if (tab === "alertcenter") {
    return <AlertCenter />;
  }

  if (tab === "admissions") {
    return <OnboardingHub initialTab="admissions" />;
  }

  if (tab === "registration") {
    return <OnboardingHub initialTab="registration" />;
  }

  if (tab === "appearance") {
    return <LandingCustomizerContent />;
  }

  if (tab === "assistant") {
    return <AIAssistantContent />;
  }

  // Combined view: the Feature Matrix dashboard now hosts both the System
  // Overview and the Access Control (portal) matrix as tabs. Both legacy routes
  // resolve to it, defaulting to the relevant tab.
  if (tab === "matrix") {
    return <FeatureMatrixDashboard initialTab="matrix" />;
  }

  if (tab === "featurematrix") {
    return <FeatureMatrixDashboard initialTab="overview" />;
  }

  if (tab === "dailyrounds") {
    return <DailyRoundsBoard clinicianRole="FACILITY_ADMIN" />;
  }
  if (tab === "cameralogs") {
    return <CameraActivityLog />;
  }

  // Core SLMS Modules Aligned
  if (tab === "records") {
    return <FacilityResidents />;
  }
  if (tab === "rounds") {
    return <AssessmentAcuityBoard clinicianRole="FACILITY_ADMIN" />;
  }
  if (tab === "careplans") {
    return <CarePlanBoard />;
  }
  if (tab === "tasks") {
    return <DailyDocumentation clinicianRole="FACILITY_ADMIN" />;
  }
  if (tab === "reports") {
    return <ClinicalReports />;
  }
  if (tab === "medications") {
    return <MARBoard />;
  }
  if (tab === "escalations") {
    return <EscalationsBoard role="FACILITY_ADMIN" />;
  }
  if (tab === "vaccinations") {
    return <VaccinationTracker />;
  }
  if (tab === "documents") {
    return <ResidentDocuments />;
  }
  if (tab === "auditlog") {
    return <AuditLogViewer />;
  }
  if (tab === "inventory-alerts") {
    return <InventoryAlertsPanel />;
  }

  if (tab === "staff") {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
              Staff Registry
            </h1>
            <p className="text-gray-600">Manage facility staff members, positions, and status</p>
          </div>
          <div className="flex items-center gap-3">
            {selectedStaff.size > 0 && (
              <button
                onClick={handleDeleteSelected}
                className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition border border-red-200 font-medium"
              >
                <Trash2 className="w-4 h-4" />
                Delete Selected ({selectedStaff.size})
              </button>
            )}
            <button
              onClick={() => setCreatingStaff(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:shadow-lg rounded-lg transition font-medium active:scale-95"
            >
              <UserPlus className="w-4 h-4" />
              Add Staff
            </button>
          </div>
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
            <p>Loading staffâ€¦</p>
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
                  <th className="px-6 py-4">Approval</th>
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
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          {staff.avatarUrl ? (
                            <img src={staff.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-black font-bold text-sm">
                              {staff.name.charAt(0)}
                            </div>
                          )}
                          <span className="font-medium text-gray-900">{staff.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-700">{staff.position}</td>
                      <td className="px-6 py-4 text-gray-700">{staff.department}</td>
                      <td className="px-6 py-4 text-gray-600 text-xs">{staff.email}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${
                            staff.active === "Active"
                              ? "bg-green-100 text-green-800"
                              : "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {staff.active}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${
                            staff.approved === "Approved"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {staff.approved}
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
                    <td colSpan={8} className="px-6 py-8 text-center text-gray-500">
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
                    {staff.avatarUrl ? (
                      <img src={staff.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover mt-0.5" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-black font-bold text-sm mt-0.5">
                        {staff.name.charAt(0)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <h3 className="font-semibold text-gray-900 truncate">{staff.name}</h3>
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${
                          staff.active === "Active"
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {staff.active}
                      </span>
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${
                          staff.approved === "Approved"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {staff.approved}
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
          {selectedStaff.size > 0 && ` â€¢ ${selectedStaff.size} selected`}
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
                <div className="flex items-center gap-6 mb-6">
                  {viewingStaff.avatarUrl ? (
                    <img src={viewingStaff.avatarUrl} alt="" className="w-20 h-20 rounded-full object-cover border-2 border-gray-200" />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-black font-bold text-2xl">
                      {viewingStaff.name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <p className="text-xl font-bold text-gray-900">{viewingStaff.name}</p>
                    <p className="text-sm text-gray-500">{viewingStaff.position} &middot; {viewingStaff.department}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Email</label>
                    <p className="text-lg text-gray-900">{viewingStaff.email}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Phone</label>
                    <p className="text-lg text-gray-900">{viewingStaff.phone}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Employment Status</label>
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-medium ${
                        viewingStaff.active === "Active"
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {viewingStaff.active}
                    </span>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Approval Status</label>
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-medium ${
                        viewingStaff.approved === "Approved"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {viewingStaff.approved}
                    </span>
                  </div>
                </div>

                {viewingStaff.experience && (
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Experience</label>
                    <p className="text-gray-900 whitespace-pre-wrap">{viewingStaff.experience}</p>
                  </div>
                )}

                <div className="bg-gray-50 p-4 rounded-lg">
                  <label className="block text-sm font-semibold text-gray-600 mb-2">Start Date</label>
                  <p className="text-gray-900">{viewingStaff.startDate}</p>
                </div>

                {viewingStaff.documents.length > 0 && (
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Documents ({viewingStaff.documents.length})</label>
                    <ul className="space-y-2 mt-2">
                      {viewingStaff.documents.map((doc: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                        <li key={i}>
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                            {doc.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
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
                  className="px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95"
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
              <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-6 flex items-center justify-between border-b border-yellow-600">
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
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Employment Status</label>
                    <select
                      value={editForm.active}
                      onChange={(e) => setEditForm({ ...editForm, active: e.target.value as "Active" | "Inactive" })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                    >
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Approval Status</label>
                    <select
                      value={editForm.approved}
                      onChange={(e) => setEditForm({ ...editForm, approved: e.target.value as "Approved" | "Disapproved" })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                    >
                      <option value="Approved">Approved</option>
                      <option value="Disapproved">Disapproved</option>
                    </select>
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Profile Photo</label>
                    <div className="flex items-center gap-4">
                      {editForm.avatarUrl ? (
                        <img src={editForm.avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover border" />
                      ) : (
                        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-sm">No photo</div>
                      )}
                      <button
                        type="button"
                        disabled={uploading}
                        onClick={() => document.getElementById("avatar-upload")?.click()}
                        className="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg text-sm transition disabled:opacity-50"
                      >
                        {uploading ? "Uploadingâ€¦" : "Upload Photo"}
                      </button>
                      {editForm.avatarUrl && (
                        <button
                          type="button"
                          onClick={() => setEditForm({ ...editForm, avatarUrl: "" })}
                          className="px-3 py-2 text-red-500 hover:bg-red-50 rounded-lg text-sm transition"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <input
                      id="avatar-upload"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setUploading(true);
                        try {
                          const fd = new FormData();
                          fd.append("file", file);
                          fd.append("folder", "staff/avatars");
                          const res = await fetch("/api/upload", { method: "POST", body: fd });
                          const data = await res.json();
                          if (data.url) setEditForm({ ...editForm, avatarUrl: data.url });
                        } finally {
                          setUploading(false);
                          e.target.value = "";
                        }
                      }}
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Experience (optional)</label>
                    <textarea
                      value={editForm.experience}
                      onChange={(e) => setEditForm({ ...editForm, experience: e.target.value })}
                      rows={3}
                      placeholder="e.g. 10 years as registered nurse, specialized in geriatric careâ€¦"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none resize-none"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Documents (optional)</label>
                    {editForm.documents.length > 0 && (
                      <ul className="mb-3 space-y-1">
                        {editForm.documents.map((doc, i) => (
                          <li key={i} className="flex items-center justify-between text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded">
                            <span className="truncate">{doc.name}</span>
                            <button
                              type="button"
                              onClick={() => setEditForm({ ...editForm, documents: editForm.documents.filter((_, j) => j !== i) })}
                              className="text-red-500 hover:text-red-700 ml-2"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => document.getElementById("doc-upload")?.click()}
                      className="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg text-sm transition disabled:opacity-50"
                    >
                      {uploading ? "Uploadingâ€¦" : "Upload Document"}
                    </button>
                    <input
                      id="doc-upload"
                      type="file"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setUploading(true);
                        try {
                          const fd = new FormData();
                          fd.append("file", file);
                          fd.append("folder", "staff/documents");
                          const res = await fetch("/api/upload", { method: "POST", body: fd });
                          const data = await res.json();
                          if (data.url) {
                            setEditForm({
                              ...editForm,
                              documents: [...editForm.documents, { name: data.name, url: data.url, type: data.type }],
                            });
                          }
                        } finally {
                          setUploading(false);
                          e.target.value = "";
                        }
                      }}
                    />
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
                  className="px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Staff Modal */}
        {creatingStaff && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              {/* Modal Header */}
              <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-6 flex items-center justify-between border-b border-yellow-600">
                <h2 className="text-2xl font-bold">Add Staff Member</h2>
                <button
                  onClick={() => setCreatingStaff(false)}
                  className="p-2 hover:bg-yellow-600/20 rounded-lg transition"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Form */}
              <div className="p-8 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Full Name *</label>
                    <input
                      type="text"
                      value={createForm.name}
                      onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                      placeholder="e.g. Jane Smith"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Email *</label>
                    <input
                      type="email"
                      value={createForm.email}
                      onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                      placeholder="e.g. jane@example.com"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Phone</label>
                    <input
                      type="tel"
                      value={createForm.phone}
                      onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
                      placeholder="e.g. (555) 123-4567"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Position</label>
                    <input
                      type="text"
                      value={createForm.position}
                      onChange={(e) => setCreateForm({ ...createForm, position: e.target.value })}
                      placeholder="e.g. Registered Nurse"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Department</label>
                    <input
                      type="text"
                      value={createForm.department}
                      onChange={(e) => setCreateForm({ ...createForm, department: e.target.value })}
                      placeholder="e.g. Nursing"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Employment Status</label>
                    <select
                      value={createForm.active}
                      onChange={(e) => setCreateForm({ ...createForm, active: e.target.value as "Active" | "Inactive" })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                    >
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Approval Status</label>
                    <select
                      value={createForm.approved}
                      onChange={(e) => setCreateForm({ ...createForm, approved: e.target.value as "Approved" | "Disapproved" })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
                    >
                      <option value="Approved">Approved</option>
                      <option value="Disapproved">Disapproved</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Experience (optional)</label>
                    <textarea
                      value={createForm.experience}
                      onChange={(e) => setCreateForm({ ...createForm, experience: e.target.value })}
                      rows={3}
                      placeholder="e.g. 10 years as registered nurse, specialized in geriatric care..."
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none resize-none"
                    />
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-8 py-4 flex items-center justify-between">
                <button
                  onClick={() => setCreatingStaff(false)}
                  className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateStaff}
                  className="px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold rounded-lg hover:shadow-lg transition active:scale-95"
                >
                  Create Staff
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }


  // Default: Admin Dashboard tab â€” platform governance view unique to this role.
  return <SuperAdminDashboard />;
}
