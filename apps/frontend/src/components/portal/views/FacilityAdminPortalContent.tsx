"use client";

import { useState, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Trash2, Search, Eye, Edit, X, Plus, Check, XCircle, Camera, Activity, ArrowLeft } from "lucide-react";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptStaff } from "@/lib/adapters";
import { updateRecord, deleteRecord } from "@/lib/api";
import FacilityDashboard from "@/components/portal/views/FacilityDashboard";
import FacilityResidents from "@/components/portal/views/FacilityResidents";
import FacilityIncidents from "@/components/portal/views/FacilityIncidents";
import FacilityVitals from "@/components/portal/views/FacilityVitals";
import AdmissionsContent from "@/components/portal/views/AdmissionsContent";
import AIAssistantContent from "@/components/portal/ai/AIAssistantContent";
import FacilityRooms from "@/components/portal/views/FacilityRooms";
import FacilityOccupancy from "@/components/portal/views/FacilityOccupancy";
import FacilityInventory from "@/components/portal/views/FacilityInventory";
import FacilityUnifiedView from "@/components/portal/views/FacilityUnifiedView";
import EscalationsBoard from "@/components/portal/views/clinical/EscalationsBoard";
import CameraVisionFeed from "@/components/CameraVisionFeed";
import PhysicianCarePlans from "@/components/portal/views/physician/PhysicianCarePlans";
import CaregiverTasks from "@/components/portal/views/caregiver/CaregiverTasks";
import DailyDocumentation from "@/components/portal/views/clinical/DailyDocumentation";
import CarePlanBoard from "@/components/portal/views/clinical/CarePlanBoard";
import VaccinationTracker from "@/components/portal/views/clinical/VaccinationTracker";
import ResidentDocuments from "@/components/portal/views/clinical/ResidentDocuments";
import MARBoard from "@/components/portal/views/clinical/MARBoard";
import FollowUpTracker from "@/components/portal/views/clinical/FollowUpTracker";
import AuditLogViewer from "@/components/portal/views/clinical/AuditLogViewer";
import ClinicalReports from "@/components/portal/views/clinical/ClinicalReports";
import InventoryAlertsPanel from "@/components/portal/views/clinical/InventoryAlertsPanel";
import DailyRoundsBoard from "@/components/portal/views/clinical/DailyRoundsBoard";
import AssessmentAcuityBoard from "@/components/portal/views/clinical/AssessmentAcuityBoard";

interface FacilityAdminPortalContentProps {
  tab: string;
}

type StaffMember = ReturnType<typeof adaptStaff>;

export default function FacilityAdminPortalContent({ tab }: FacilityAdminPortalContentProps) {
  const { data: staffRows, loading, error, refetch } = useLiveQuery<Record<string, unknown>>("staff", {
    query: "include=user",
    tables: ["Staff", "User"],
  });
  const staff = useMemo(() => staffRows.map(adaptStaff), [staffRows]);

  const [searchQuery, setSearchQuery] = useState("");
  const [approvedFilter, setApprovedFilter] = useState("all");
  const [selectedStaff, setSelectedStaff] = useState<Set<string>>(new Set());
  const [viewingStaff, setViewingStaff] = useState<StaffMember | null>(null);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [editForm, setEditForm] = useState({
    name: "", position: "", department: "", email: "", phone: "",
    approved: "Approved" as "Approved" | "Disapproved",
    avatarUrl: "",
    experience: "",
    documents: [] as { name: string; url: string; type: string }[],
  });
  const [uploading, setUploading] = useState(false);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [showAddPassword, setShowAddPassword] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "", email: "", phone: "", position: "", department: "",
    role: "CAREGIVER" as string, hireDate: new Date().toISOString().slice(0, 10), password: "",
  });

  const approvalLabel = (s: StaffMember) => s.approved;
  const isApproved = (s: StaffMember) => s.approved === "Approved";

  const filteredStaff = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return staff.filter((s) => {
      if (q && !s.name.toLowerCase().includes(q) && !s.position.toLowerCase().includes(q) && !s.department.toLowerCase().includes(q) && !s.email.toLowerCase().includes(q)) return false;
      if (approvedFilter === "approved" && !isApproved(s)) return false;
      if (approvedFilter === "disapproved" && isApproved(s)) return false;
      return true;
    });
  }, [staff, searchQuery, approvedFilter]);

  const handleSelectAll = () => {
    if (selectedStaff.size === filteredStaff.length) {
      setSelectedStaff(new Set());
    } else {
      setSelectedStaff(new Set(filteredStaff.map((s) => s.id)));
    }
  };

  const handleSelectStaff = (id: string) => {
    const newSelected = new Set(selectedStaff);
    if (newSelected.has(id)) { newSelected.delete(id); } else { newSelected.add(id); }
    setSelectedStaff(newSelected);
  };

  const handleToggleApproval = async (member: StaffMember, approve: boolean) => {
    const action = approve ? "Approve" : "Disapprove";
    const result = await Swal.fire({
      title: `${action} Staff Member?`,
      text: `${action} "${member.name}"?`,
      icon: "question", showCancelButton: true, confirmButtonColor: approve ? "#22c55e" : "#ef4444",
      cancelButtonColor: "#6b7280", confirmButtonText: action, cancelButtonText: "Cancel",
    });
    if (!result.isConfirmed) return;
    try {
      await updateRecord("staff", member.id, { isApproved: approve });
      await refetch();
      Swal.fire({ title: `${action}d`, text: `${member.name} has been ${action.toLowerCase()}d.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : `Could not ${action.toLowerCase()} staff member.`, icon: "error" });
    }
  };

  const handleBulkApproval = async (approve: boolean) => {
    if (selectedStaff.size === 0) return;
    const action = approve ? "Approve" : "Disapprove";
    const result = await Swal.fire({
      title: `${action} Selected?`,
      text: `${action} ${selectedStaff.size} staff member(s)?`,
      icon: "question", showCancelButton: true, confirmButtonColor: approve ? "#22c55e" : "#ef4444",
      cancelButtonColor: "#6b7280", confirmButtonText: `${action} All`, cancelButtonText: "Cancel",
    });
    if (!result.isConfirmed) return;
    try {
      for (const id of selectedStaff) { await updateRecord("staff", id, { isApproved: approve }); }
      await refetch();
      setSelectedStaff(new Set());
      Swal.fire({ title: `${action}d`, text: `${selectedStaff.size} staff member(s) ${action.toLowerCase()}d.`, icon: "success", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : `Could not ${action.toLowerCase()} staff member(s).`, icon: "error" });
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedStaff.size === 0) return;
    const result = await Swal.fire({
      title: "Delete Staff Members?",
      text: `You are about to delete ${selectedStaff.size} staff member(s). This action cannot be undone.`,
      icon: "warning", showCancelButton: true, confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280", confirmButtonText: "Delete", cancelButtonText: "Cancel",
    });
    if (result.isConfirmed) {
      const count = selectedStaff.size;
      try {
        for (const id of selectedStaff) { await deleteRecord("staff", id); }
        await refetch();
        setSelectedStaff(new Set());
        Swal.fire({ title: "Deleted", text: `${count} staff member(s) have been removed.`, icon: "success", timer: 1500, showConfirmButton: false });
      } catch (err) {
        Swal.fire({ title: "Delete Failed", text: err instanceof Error ? err.message : "Could not delete staff member(s).", icon: "error" });
      }
    }
  };

  const handleAddStaff = async () => {
    if (!addForm.name || !addForm.email || !addForm.position || !addForm.phone) {
      Swal.fire({ title: "Missing Fields", text: "Name, email, position, and phone are required.", icon: "warning" });
      return;
    }
    if (addForm.password.length < 8) {
      Swal.fire({ title: "Password too short", text: "Set a password of at least 8 characters for the staff member.", icon: "warning" });
      return;
    }
    const result = await Swal.fire({
      title: "Create Staff Account?", text: `${addForm.email} will be able to sign in immediately with the password you set.`, icon: "question",
      showCancelButton: true, confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280",
      confirmButtonText: "Create", cancelButtonText: "Cancel",
    });
    if (result.isConfirmed) {
      try {
        const sessionResponse = await fetch("/api/auth/session", { cache: "no-store" });
        const sessionBody = await sessionResponse.json();
        const organizationId = sessionBody.session?.activeOrganizationId;
        const communityId = sessionBody.session?.activeCommunityId;
        if (!sessionResponse.ok || !organizationId || !communityId) throw new Error("Select an active organization and community before adding staff");
        const response = await fetch(`/api/organizations/${organizationId}/staff`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: addForm.name,
            email: addForm.email,
            phone: addForm.phone,
            position: addForm.position,
            department: addForm.department || undefined,
            hireDate: addForm.hireDate,
            communityId,
            communityRole: addForm.role,
            password: addForm.password,
          }),
        });
        const created = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(created.error || "Could not create staff account");
        await refetch();
        setShowAddStaff(false);
        setShowAddPassword(false);
        const createdEmail = addForm.email;
        setAddForm({ name: "", email: "", phone: "", position: "", department: "", role: "CAREGIVER", hireDate: new Date().toISOString().slice(0, 10), password: "" });
        Swal.fire({ title: "Staff account created", text: `${createdEmail} can now sign in with the password you set and change it later in Settings.`, icon: "success", timer: 2800, showConfirmButton: false });
      } catch (err) {
        Swal.fire({ title: "Add Failed", text: err instanceof Error ? err.message : "Could not add staff member.", icon: "error" });
      }
    }
  };

  const startEditing = (member: StaffMember) => {
    setEditingStaff(member);
    setEditForm({
      name: member.name, position: member.position, department: member.department,
      email: member.email, phone: member.phone,
      approved: member.approved,
      avatarUrl: member.avatarUrl ?? "",
      experience: member.experience ?? "",
      documents: Array.isArray(member.documents) ? member.documents : [],
    });
  };

  const handleSaveEdit = async () => {
    const result = await Swal.fire({
      title: "Save Changes?", text: `Update ${editForm.name}'s staff record?`, icon: "question",
      showCancelButton: true, confirmButtonColor: "#fbbf24", cancelButtonColor: "#6b7280",
      confirmButtonText: "Save", cancelButtonText: "Cancel",
    });
    if (result.isConfirmed) {
      if (!editingStaff) return;
      try {
        await updateRecord("staff", editingStaff.id, {
          position: editForm.position, department: editForm.department, isApproved: editForm.approved === "Approved",
          avatarUrl: editForm.avatarUrl || null,
          experience: editForm.experience || null,
          documents: editForm.documents.length > 0 ? editForm.documents : null,
        });
        const userId = editingStaff.raw?.userId;
        if (userId) { await updateRecord("users", userId, { name: editForm.name, email: editForm.email, phone: editForm.phone }); }
        await refetch();
        setEditingStaff(null);
        setViewingStaff(null);
        Swal.fire({ title: "Saved", text: `${editForm.name}'s record has been updated.`, icon: "success", timer: 1500, showConfirmButton: false });
      } catch (err) {
        Swal.fire({ title: "Save Failed", text: err instanceof Error ? err.message : "Could not update staff record.", icon: "error" });
      }
    }
  };

  // Tab routing
  if (tab === "admissions") return <AdmissionsContent />;
  if (tab === "assistant") return <AIAssistantContent />;
  if (tab === "residents") return <FacilityResidents />;
  if (tab === "incidents") return <FacilityIncidents />;
  if (tab === "rounds") return <AssessmentAcuityBoard clinicianRole="FACILITY_ADMIN" />;
  if (tab === "dailyrounds") return <DailyRoundsBoard clinicianRole="FACILITY_ADMIN" />;
  if (tab === "careplans") return <CarePlanBoard />;
  if (tab === "tasks") return <DailyDocumentation clinicianRole="FACILITY_ADMIN" />;
  if (tab === "vaccinations") return <VaccinationTracker />;
  if (tab === "documents") return <ResidentDocuments />;
  if (tab === "mar") return <MARBoard />;
  if (tab === "followups") return <FollowUpTracker />;
  if (tab === "auditlog") return <AuditLogViewer />;
  if (tab === "inventory-alerts") return <InventoryAlertsPanel />;
  if (tab === "clinicalreports") return <ClinicalReports />;
  if (tab === "monitoring") return <MonitoringView />;
  if (tab === "rooms") return <FacilityRooms />;
  if (tab === "occupancy") return <FacilityOccupancy />;
  if (tab === "inventory") return <FacilityInventory />;
  if (tab === "escalations") return <EscalationsBoard role="FACILITY_ADMIN" />;
  // Unified operations hub — reports, billing, dining, services, maintenance, concierge, front desk, turnover, community
  if (["reports", "billing", "dining", "services", "maintenance", "concierge", "frontdesk", "turnover", "community"].includes(tab))
    return <FacilityUnifiedView initialTab={tab} />;

  // Staff Registry tab
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
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => setShowAddStaff(true)} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
              <Plus className="w-4 h-4" /> Add New Staff
            </button>
            {selectedStaff.size > 0 && (
              <>
                <button onClick={() => handleBulkApproval(true)} className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg transition border border-green-200 text-sm font-medium">
                  <Check className="w-4 h-4" /> Approve ({selectedStaff.size})
                </button>
                <button onClick={() => handleBulkApproval(false)} className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition border border-red-200 text-sm font-medium">
                  <XCircle className="w-4 h-4" /> Disapprove ({selectedStaff.size})
                </button>
                <button onClick={handleDeleteSelected} className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition border border-red-200 font-medium">
                  <Trash2 className="w-4 h-4" /> Delete ({selectedStaff.size})
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
            <input type="text" placeholder="Search by name, position, department, or email..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
          </div>
          <select value={approvedFilter} onChange={(e) => setApprovedFilter(e.target.value)}
            className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none bg-white text-sm">
            <option value="all">All Status</option>
            <option value="approved">Approved</option>
            <option value="disapproved">Disapproved</option>
          </select>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">Failed to load staff: {error}</div>}

        {loading && staff.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
            <div className="inline-block w-6 h-6 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin mb-3" />
            <p>Loading staff…</p>
          </div>
        ) : (
          <>
            <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr className="text-left text-gray-600 font-semibold">
                      <th className="px-6 py-4 w-12">
                        <input type="checkbox" checked={selectedStaff.size === filteredStaff.length && filteredStaff.length > 0} onChange={handleSelectAll} className="rounded cursor-pointer" />
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
                    {filteredStaff.length > 0 ? filteredStaff.map((staff) => (
                      <tr key={staff.id} className="hover:bg-gray-50 transition">
                        <td className="px-6 py-4"><input type="checkbox" checked={selectedStaff.has(staff.id)} onChange={() => handleSelectStaff(staff.id)} className="rounded cursor-pointer" /></td>
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
                          <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${isApproved(staff) ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                            {isApproved(staff) ? <Check className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                            {approvalLabel(staff)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {isApproved(staff) ? (
                              <button onClick={() => handleToggleApproval(staff, false)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition" title="Disapprove"><XCircle className="w-4 h-4" /></button>
                            ) : (
                              <button onClick={() => handleToggleApproval(staff, true)} className="p-2 text-green-500 hover:bg-green-50 rounded-lg transition" title="Approve"><Check className="w-4 h-4" /></button>
                            )}
                            <button onClick={() => setViewingStaff(staff)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition" title="View details"><Eye className="w-4 h-4" /></button>
                            <button onClick={() => startEditing(staff)} className="p-2 text-yellow-600 hover:bg-yellow-50 rounded-lg transition" title="Edit record"><Edit className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </tr>
                    )) : (
                      <tr><td colSpan={8} className="px-6 py-8 text-center text-gray-500">No staff members found matching your search.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="md:hidden space-y-3">
              {filteredStaff.length > 0 ? filteredStaff.map((staff) => (
                <div key={staff.id} className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={selectedStaff.has(staff.id)} onChange={() => handleSelectStaff(staff.id)} className="rounded cursor-pointer mt-1" />
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
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${isApproved(staff) ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                          {isApproved(staff) ? <Check className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                          {approvalLabel(staff)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 truncate">{staff.position}</p>
                      <p className="text-xs text-gray-500 truncate">{staff.department}</p>
                      <p className="text-xs text-gray-500 truncate mt-1">{staff.email}</p>
                      <div className="flex gap-2 mt-3">
                        {isApproved(staff) ? (
                          <button onClick={() => handleToggleApproval(staff, false)} className="flex-1 px-3 py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded text-sm font-medium transition"><XCircle className="w-4 h-4 inline mr-1" /> Disapprove</button>
                        ) : (
                          <button onClick={() => handleToggleApproval(staff, true)} className="flex-1 px-3 py-2 bg-green-50 text-green-600 hover:bg-green-100 rounded text-sm font-medium transition"><Check className="w-4 h-4 inline mr-1" /> Approve</button>
                        )}
                        <button onClick={() => setViewingStaff(staff)} className="flex-1 px-3 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded text-sm font-medium transition"><Eye className="w-4 h-4 inline mr-1" /> View</button>
                        <button onClick={() => startEditing(staff)} className="flex-1 px-3 py-2 bg-yellow-50 text-yellow-600 hover:bg-yellow-100 rounded text-sm font-medium transition"><Edit className="w-4 h-4 inline mr-1" /> Edit</button>
                      </div>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">No staff members found matching your search.</div>
              )}
            </div>

            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>Showing {filteredStaff.length} of {staff.length} staff members{selectedStaff.size > 0 && ` • ${selectedStaff.size} selected`}</span>
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> {staff.filter(isApproved).length} Approved</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> {staff.filter((s) => !isApproved(s)).length} Disapproved</span>
              </span>
            </div>
          </>
        )}

        {viewingStaff && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-gradient-to-r from-blue-400 to-blue-500 text-white p-6 flex items-center justify-between border-b border-blue-600">
                <h2 className="text-2xl font-bold">Staff Details</h2>
                <button onClick={() => setViewingStaff(null)} className="p-2 hover:bg-blue-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
              </div>
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
                  <div><label className="block text-sm font-semibold text-gray-600 mb-2">Email</label><p className="text-lg text-gray-900">{viewingStaff.email}</p></div>
                  <div><label className="block text-sm font-semibold text-gray-600 mb-2">Phone</label><p className="text-lg text-gray-900">{viewingStaff.phone}</p></div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Employment Status</label>
                    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${viewingStaff.active === "Active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>
                      {viewingStaff.active}
                    </span>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Approval Status</label>
                    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${isApproved(viewingStaff) ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                      {isApproved(viewingStaff) ? <Check className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                      {approvalLabel(viewingStaff)}
                    </span>
                  </div>
                </div>
                {viewingStaff.experience && (
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Experience</label>
                    <p className="text-gray-900 whitespace-pre-wrap">{viewingStaff.experience}</p>
                  </div>
                )}
                <div className="bg-gray-50 p-4 rounded-lg"><label className="block text-sm font-semibold text-gray-600 mb-2">Start Date</label><p className="text-gray-900">{viewingStaff.startDate}</p></div>
                {viewingStaff.documents.length > 0 && (
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Documents ({viewingStaff.documents.length})</label>
                    <ul className="space-y-2 mt-2">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {viewingStaff.documents.map((doc: any, i: number) => (
                        <li key={i}>
                          <a href={doc.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                            {doc.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-8 py-4 flex items-center justify-between">
                <button onClick={() => setViewingStaff(null)} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Close</button>
                <button onClick={() => { startEditing(viewingStaff); setViewingStaff(null); }} className="px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">Edit Staff Member</button>
              </div>
            </div>
          </div>
        )}

        {showAddStaff && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-6 flex items-center justify-between border-b border-yellow-600">
                <h2 className="text-2xl font-bold">Add New Staff</h2>
                <button onClick={() => setShowAddStaff(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
              </div>
              <div className="p-8 space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div className="col-span-2"><label className="block text-sm font-semibold text-gray-700 mb-2">Full Name</label><input type="text" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="e.g. Jane Smith" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
                  <div><label className="block text-sm font-semibold text-gray-700 mb-2">Email</label><input type="email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} placeholder="e.g. jane.smith@goldenhearth.com" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
                  <div><label className="block text-sm font-semibold text-gray-700 mb-2">Phone</label><input type="tel" value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} placeholder="e.g. 555-0202" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
                  <div><label className="block text-sm font-semibold text-gray-700 mb-2">Position</label><input type="text" value={addForm.position} onChange={(e) => setAddForm({ ...addForm, position: e.target.value })} placeholder="e.g. Registered Nurse" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
                  <div><label className="block text-sm font-semibold text-gray-700 mb-2">Department</label><input type="text" value={addForm.department} onChange={(e) => setAddForm({ ...addForm, department: e.target.value })} placeholder="e.g. Clinical Care" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
                  <div><label className="block text-sm font-semibold text-gray-700 mb-2">Role</label>
                    <select value={addForm.role} onChange={(e) => setAddForm({ ...addForm, role: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none bg-white">
                      <option value="NURSE">Nurse</option>
                      <option value="CAREGIVER">Caregiver</option>
                      <option value="PHYSICIAN">Physician</option>
                      <option value="FLEET_MANAGEMENT">Fleet Manager</option>
                      <option value="DRIVER">Driver</option>
                    </select>
                  </div>
                  <div><label className="block text-sm font-semibold text-gray-700 mb-2">Hire Date</label><input type="date" value={addForm.hireDate} onChange={(e) => setAddForm({ ...addForm, hireDate: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none" /></div>
                  <div className="col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Temporary Password</label>
                    <div className="relative">
                      <input type={showAddPassword ? "text" : "password"} value={addForm.password} onChange={(e) => setAddForm({ ...addForm, password: e.target.value })} placeholder="Set a password (min 8 characters)" autoComplete="new-password" className="w-full px-4 py-2 pr-16 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 outline-none" />
                      <button type="button" onClick={() => setShowAddPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-500 hover:text-gray-800">{showAddPassword ? "Hide" : "Show"}</button>
                    </div>
                  </div>
                  <div className="col-span-2 rounded-lg border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
                    No invitation email is sent. The staff member is pre-approved for this facility and can sign in immediately with this email and password — they can change their password anytime under Settings.
                  </div>
                </div>
              </div>
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-8 py-4 flex items-center justify-between">
                <button onClick={() => setShowAddStaff(false)} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Cancel</button>
                <button onClick={handleAddStaff} className="px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">Create Staff Account</button>
              </div>
            </div>
          </div>
        )}

        {editingStaff && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-6 flex items-center justify-between border-b border-yellow-600">
                <h2 className="text-2xl font-bold">Edit Staff Member</h2>
                <button onClick={() => setEditingStaff(null)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
              </div>
              <div className="p-8 space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div><label className="block text-sm font-semibold text-gray-700 mb-2">Full Name</label><input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" /></div>
                  <div><label className="block text-sm font-semibold text-gray-700 mb-2">Email</label><input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" /></div>
                  <div><label className="block text-sm font-semibold text-gray-700 mb-2">Position</label><input type="text" value={editForm.position} onChange={(e) => setEditForm({ ...editForm, position: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" /></div>
                  <div><label className="block text-sm font-semibold text-gray-700 mb-2">Phone</label><input type="tel" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" /></div>
                  <div className="col-span-2"><label className="block text-sm font-semibold text-gray-700 mb-2">Department</label><input type="text" value={editForm.department} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" /></div>
                  <div className="col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Approval Status</label>
                    <select value={editForm.approved} onChange={(e) => setEditForm({ ...editForm, approved: e.target.value as "Approved" | "Disapproved" })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none">
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
                      <button type="button" disabled={uploading} onClick={() => document.getElementById("fac-avatar-upload")?.click()} className="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg text-sm transition disabled:opacity-50">
                        {uploading ? "Uploading…" : "Upload Photo"}
                      </button>
                      {editForm.avatarUrl && (
                        <button type="button" onClick={() => setEditForm({ ...editForm, avatarUrl: "" })} className="px-3 py-2 text-red-500 hover:bg-red-50 rounded-lg text-sm transition">Remove</button>
                      )}
                    </div>
                    <input id="fac-avatar-upload" type="file" accept="image/*" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0]; if (!file) return;
                      setUploading(true);
                      try {
                        const fd = new FormData(); fd.append("file", file); fd.append("folder", "staff/avatars");
                        const res = await fetch("/api/upload", { method: "POST", body: fd });
                        const data = await res.json();
                        if (data.url) setEditForm({ ...editForm, avatarUrl: data.url });
                      } finally { setUploading(false); e.target.value = ""; }
                    }} />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Experience (optional)</label>
                    <textarea value={editForm.experience} onChange={(e) => setEditForm({ ...editForm, experience: e.target.value })} rows={3} placeholder="e.g. 10 years as registered nurse, specialized in geriatric care…" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none resize-none" />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Documents (optional)</label>
                    {editForm.documents.length > 0 && (
                      <ul className="mb-3 space-y-1">
                        {editForm.documents.map((doc, i) => (
                          <li key={i} className="flex items-center justify-between text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded">
                            <span className="truncate">{doc.name}</span>
                            <button type="button" onClick={() => setEditForm({ ...editForm, documents: editForm.documents.filter((_, j) => j !== i) })} className="text-red-500 hover:text-red-700 ml-2"><X className="w-4 h-4" /></button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <button type="button" disabled={uploading} onClick={() => document.getElementById("fac-doc-upload")?.click()} className="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg text-sm transition disabled:opacity-50">
                      {uploading ? "Uploading…" : "Upload Document"}
                    </button>
                    <input id="fac-doc-upload" type="file" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0]; if (!file) return;
                      setUploading(true);
                      try {
                        const fd = new FormData(); fd.append("file", file); fd.append("folder", "staff/documents");
                        const res = await fetch("/api/upload", { method: "POST", body: fd });
                        const data = await res.json();
                        if (data.url) setEditForm({ ...editForm, documents: [...editForm.documents, { name: data.name, url: data.url, type: data.type }] });
                      } finally { setUploading(false); e.target.value = ""; }
                    }} />
                  </div>
                </div>
              </div>
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-8 py-4 flex items-center justify-between">
                <button onClick={() => setEditingStaff(null)} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Cancel</button>
                <button onClick={handleSaveEdit} className="px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">Save Changes</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Default: Facility Dashboard tab
  return <FacilityDashboard />;
}

/* ── Monitoring View (Dedicated Per-Resident Camera + Vitals) ──────── */

function MonitoringViewFallback() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-lg font-semibold text-gray-700">
        <Camera className="w-5 h-5" /> Camera Feed
      </div>
      <div className="bg-black rounded-xl aspect-video flex items-center justify-center">
        <p className="text-white/60">Loading camera feed...</p>
      </div>
    </div>
  );
}

function MonitoringViewInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const resident = searchParams.get("resident");
  const room = searchParams.get("room");
  const [showVitals, setShowVitals] = useState(false);

  return (
    <div className="space-y-6">
      {/* Resident Header Card */}
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition active:scale-95"
              title="Go back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-green-400/20 text-green-200 text-[10px] font-bold uppercase tracking-wider border border-green-400/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  LIVE MONITORING
                </span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold text-white mb-1">
                {resident || "Facility Monitoring"}
              </h1>
              {room && (
                <p className="text-blue-100 text-sm">
                  Room {room} &middot; Camera feed with AI-powered analysis
                </p>
              )}
            </div>
          </div>
          <Camera className="w-12 h-12 text-blue-200/50 hidden sm:block" />
        </div>
      </div>

      {/* Camera Feed — dedicated to this resident */}
      <div className="relative aspect-video rounded-xl overflow-hidden border border-gray-200 shadow-lg">
        <div className="absolute inset-0 z-30">
          <CameraVisionFeed
            cameraMode="hybrid"
            residentName={resident || undefined}
            residentRoom={room || undefined}
          />
        </div>

        {/* Vitals Button Overlay */}
        <div className="absolute bottom-4 right-4 z-40">
          <button
            onClick={() => setShowVitals(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-white/90 backdrop-blur-md text-gray-900 font-semibold rounded-lg shadow-lg hover:bg-white hover:shadow-xl transition-all active:scale-95 border border-gray-200/50"
          >
            <Activity className="w-4 h-4 text-yellow-500" />
            View Vitals
          </button>
        </div>
      </div>

      {/* Camera Mode Info */}
      <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-4 py-2 border border-gray-200">
        <Camera className="w-4 h-4 text-blue-500" />
        Switch between <span className="font-semibold text-gray-700">Local</span> (browser webcam) and{" "}
        <span className="font-semibold text-gray-700">Tapo IP</span> (network camera) using the buttons on the camera feed.
      </div>

      {/* Vitals Modal */}
      {showVitals && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className={`bg-white rounded-xl shadow-2xl w-full ${resident ? "max-w-md" : "max-w-3xl"} max-h-[90vh] overflow-y-auto`}>
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                <h2 className="text-xl font-bold">
                  Vital Signs{resident ? ` — ${resident}` : ""}
                </h2>
              </div>
              <button onClick={() => setShowVitals(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6">
              <FacilityVitals residentFilter={resident || undefined} />
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end">
              <button onClick={() => setShowVitals(false)} className="px-6 py-2 bg-yellow-500 hover:bg-yellow-600 text-white font-semibold rounded-lg transition">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MonitoringView() {
  return (
    <Suspense fallback={<MonitoringViewFallback />}>
      <MonitoringViewInner />
    </Suspense>
  );
}
