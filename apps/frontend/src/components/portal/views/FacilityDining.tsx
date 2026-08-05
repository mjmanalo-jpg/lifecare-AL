"use client";

import { useState, useMemo } from "react";
import { 
  Utensils, ShieldCheck, ClipboardList, Users, Plus, X, Check, 
  AlertTriangle, Clock, RefreshCw, Calendar, Coffee, FileText, ChevronRight
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";

interface ResidentRow {
  id: string;
  firstName: string;
  lastName: string;
  roomNumber: string;
  allergies?: string;
  notes?: string;
}

interface MenuRow {
  id: string;
  mealType: string;
  name: string;
  description?: string;
  dietaryTags?: string;
  menuDate: string;
}

interface ConsultRow {
  id: string;
  residentId: string;
  resident?: ResidentRow;
  dietitianName: string;
  consultDate: string;
  reason: string;
  recommendations: string;
  status: string;
}

interface ComplianceRow {
  id: string;
  title: string;
  category: string;
  status: string;
  score: number;
  auditedBy: string;
  auditDate: string;
  details?: string;
}

export default function FacilityDining() {
  const [activeSubTab, setActiveSubTab] = useState<"compliance" | "dietitian" | "menus">("compliance");

  // Fetch residents for dropdowns & preferences
  const { data: residentRows } = useLiveQuery<ResidentRow>("residents", {
    query: "take=100",
    tables: ["Resident"]
  });

  // Fetch menus
  const { data: menuRows, refetch: refetchMenus } = useLiveQuery<MenuRow>("daily-menus", {
    query: "take=100",
    tables: ["DailyMenu"]
  });

  // Fetch dietitian consults
  const { data: consultRows, refetch: refetchConsults } = useLiveQuery<ConsultRow>("dietitian-consults", {
    query: "include=resident&take=100",
    tables: ["DietitianConsult", "Resident"]
  });

  // Fetch compliance logs
  const { data: complianceRows, refetch: refetchCompliance } = useLiveQuery<ComplianceRow>("food-compliance-logs", {
    query: "take=100",
    tables: ["FoodComplianceLog"]
  });

  // Fetch staff for dietitian name
  const { data: staffRows } = useLiveQuery<Record<string, unknown>>("staff", {
    query: "include=user", tables: ["Staff"]
  });

  const dietitianStaffName = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dietitian = staffRows.find((s: any) => {
      const pos = String(s.position || "").toUpperCase();
      return pos.includes("DIETITIAN") || pos.includes("NUTRITION");
    });
    if (dietitian?.user) {
      const u = dietitian.user as Record<string, unknown>;
      const name = `${String(u.firstName || "")} ${String(u.lastName || "")}`.trim();
      return name || "Dietitian";
    }
    return "Dietitian";
  }, [staffRows]);

  // Temp check state (local UI helper)
  const [tempFreezer, setTempFreezer] = useState("-18");
  const [tempCooler, setTempCooler] = useState("4");
  const [tempDry, setTempDry] = useState("19");

  // New Menu Form State
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [menuForm, setMenuForm] = useState({
    mealType: "BREAKFAST",
    name: "",
    description: "",
    dietaryTags: "",
    menuDate: new Date().toISOString().slice(0, 10)
  });

  // New Consult Form State
  const [showAddConsult, setShowAddConsult] = useState(false);
  const [consultForm, setConsultForm] = useState({
    residentId: "",
    dietitianName: "",
    reason: "",
    recommendations: "",
    status: "PENDING"
  });

  // New Compliance Form State
  const [showAddCompliance, setShowAddCompliance] = useState(false);
  const [complianceForm, setComplianceForm] = useState({
    title: "Quarterly HACCP Self-Audit",
    category: "TEMPERATURE",
    status: "COMPLIANT",
    score: 0,
    auditedBy: "",
    details: "",
    refrigeratorChecked: true,
    dryStorageChecked: true,
    pestControlChecked: true,
    allergenSinksChecked: true
  });

  // Submit Daily Temp Checklist
  const handleSubmitTemps = async () => {
    try {
      await createRecord("food-compliance-logs", {
        title: "Daily Kitchen Temperature Checklist",
        category: "TEMPERATURE",
        status: "COMPLIANT",
        score: complianceForm.score || 0,
        auditedBy: complianceForm.auditedBy || "Staff",
        details: `Freezer Temp: ${tempFreezer}°C (Target: ≤ -18°C) | Refrigerator Temp: ${tempCooler}°C (Target: 0-4°C) | Dry Storage Temp: ${tempDry}°C (Target: 15-21°C).`,
        auditDate: new Date().toISOString()
      });
      await refetchCompliance();
      Swal.fire({
        title: "Log Recorded",
        text: "Daily kitchen temperatures recorded and logged in compliance records.",
        icon: "success",
        timer: 2000,
        showConfirmButton: false
      });
    } catch (err) {
      Swal.fire("Error", "Could not save temperature logs.", "error");
    }
  };

  // Submit Custom Compliance Audit
  const handleSaveCompliance = async () => {
    if (!complianceForm.title || !complianceForm.auditedBy) {
      Swal.fire("Warning", "Title and Auditor name are required.", "warning");
      return;
    }
    try {
      const checklist = {
        refrigeratorChecked: complianceForm.refrigeratorChecked,
        dryStorageChecked: complianceForm.dryStorageChecked,
        pestControlChecked: complianceForm.pestControlChecked,
        allergenSinksChecked: complianceForm.allergenSinksChecked
      };
      await createRecord("food-compliance-logs", {
        title: complianceForm.title,
        category: complianceForm.category,
        status: complianceForm.status,
        score: Number(complianceForm.score),
        auditedBy: complianceForm.auditedBy,
        details: complianceForm.details,
        checklistJson: JSON.stringify(checklist),
        auditDate: new Date().toISOString()
      });
      await refetchCompliance();
      setShowAddCompliance(false);
      Swal.fire({
        title: "Audit Logged",
        text: "HACCP compliance audit saved successfully.",
        icon: "success",
        timer: 1500,
        showConfirmButton: false
      });
    } catch (err) {
      Swal.fire("Error", "Could not save compliance log.", "error");
    }
  };

  // Submit Menu Item
  const handleSaveMenu = async () => {
    if (!menuForm.name) {
      Swal.fire("Warning", "Menu item name is required.", "warning");
      return;
    }
    try {
      await createRecord("daily-menus", {
        mealType: menuForm.mealType,
        name: menuForm.name,
        description: menuForm.description || null,
        dietaryTags: menuForm.dietaryTags || null,
        menuDate: new Date(menuForm.menuDate).toISOString()
      });
      await refetchMenus();
      setShowAddMenu(false);
      setMenuForm({
        mealType: "BREAKFAST",
        name: "",
        description: "",
        dietaryTags: "",
        menuDate: new Date().toISOString().slice(0, 10)
      });
      Swal.fire({
        title: "Menu Created",
        text: "New menu schedule item has been logged.",
        icon: "success",
        timer: 1500,
        showConfirmButton: false
      });
    } catch (err) {
      Swal.fire("Error", "Could not save menu item.", "error");
    }
  };

  // Delete Menu Item
  const handleDeleteMenu = async (id: string) => {
    const res = await Swal.fire({
      title: "Remove Menu Item?",
      text: "Are you sure you want to delete this scheduled meal option?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Remove"
    });
    if (!res.isConfirmed) return;
    try {
      await deleteRecord("daily-menus", id);
      await refetchMenus();
      Swal.fire("Deleted", "Menu item removed.", "success");
    } catch (err) {
      Swal.fire("Error", "Could not remove menu item.", "error");
    }
  };

  // Submit Consult Request
  const handleSaveConsult = async () => {
    if (!consultForm.residentId || !consultForm.reason) {
      Swal.fire("Warning", "Resident and consultation reason are required.", "warning");
      return;
    }
    try {
      await createRecord("dietitian-consults", {
        residentId: consultForm.residentId,
        dietitianName: consultForm.dietitianName,
        reason: consultForm.reason,
        recommendations: consultForm.recommendations || "Pending consultation write-up.",
        status: consultForm.status,
        consultDate: new Date().toISOString()
      });
      await refetchConsults();
      setShowAddConsult(false);
      setConsultForm({
        residentId: "",
        dietitianName: dietitianStaffName,
        reason: "",
        recommendations: "",
        status: "PENDING"
      });
      Swal.fire({
        title: "Request Created",
        text: "Consultation request sent to the registered dietitian.",
        icon: "success",
        timer: 1500,
        showConfirmButton: false
      });
    } catch (err) {
      Swal.fire("Error", "Could not create consultation request.", "error");
    }
  };

  // Toggle Consult Status
  const handleToggleConsult = async (consult: ConsultRow) => {
    const newStatus = consult.status === "PENDING" ? "COMPLETED" : "PENDING";
    let recs = consult.recommendations;
    if (newStatus === "COMPLETED" && consult.recommendations.startsWith("Pending")) {
      const input = await Swal.fire({
        title: "Dietitian Recommendations",
        input: "textarea",
        inputLabel: "Add clinical dietary recommendations",
        inputPlaceholder: "e.g. Restrict sodium to 1500mg/day, provide high-protein snacks between meals...",
        showCancelButton: true
      });
      if (input.isDismissed) return;
      recs = input.value || "Completed consultation review.";
    }

    try {
      await updateRecord("dietitian-consults", consult.id, {
        status: newStatus,
        recommendations: recs
      });
      await refetchConsults();
      Swal.fire("Updated", "Consultation record updated.", "success");
    } catch (err) {
      Swal.fire("Error", "Could not update consultation.", "error");
    }
  };

  return (
    <div className="space-y-6">
      {/* Title & Navigation Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-yellow-50 to-amber-100 p-4 sm:p-6 rounded-2xl border border-amber-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold bg-gradient-to-r from-amber-700 to-amber-950 bg-clip-text text-transparent flex items-center gap-2">
            <Utensils className="w-7 h-7 sm:w-8 sm:h-8 text-amber-600 flex-shrink-0" /> Dining &amp; Food Compliance
          </h1>
          <p className="text-amber-800 text-sm font-semibold mt-1">
            Oversee facility dietary operations, safety audits, menus, and dietitian reviews.
          </p>
        </div>

        {/* Tab Controls */}
        <div className="bg-white/80 p-1.5 rounded-xl border border-amber-300 flex items-center gap-1.5 overflow-x-auto flex-nowrap">
          <button 
            onClick={() => setActiveSubTab("compliance")}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg transition active:scale-95 whitespace-nowrap flex-shrink-0 ${activeSubTab ==="compliance" ? "bg-amber-500 text-white shadow-sm" : "text-amber-900 hover:bg-amber-100"}`}
          >
            <ShieldCheck className="w-4 h-4" /> Food Compliance
          </button>
          <button 
            onClick={() => setActiveSubTab("dietitian")}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg transition active:scale-95 whitespace-nowrap flex-shrink-0 ${activeSubTab ==="dietitian" ? "bg-amber-500 text-white shadow-sm" : "text-amber-900 hover:bg-amber-100"}`}
          >
            <Users className="w-4 h-4" /> Dietitians
          </button>
          <button 
            onClick={() => setActiveSubTab("menus")}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg transition active:scale-95 whitespace-nowrap flex-shrink-0 ${activeSubTab ==="menus" ? "bg-amber-500 text-white shadow-sm" : "text-amber-900 hover:bg-amber-100"}`}
          >
            <ClipboardList className="w-4 h-4" /> Menus &amp; Cuisine
          </button>
        </div>
      </div>

      {/* ────────────────── 1. FOOD COMPLIANCE SUBTAB ────────────────── */}
      {activeSubTab === "compliance" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-6">
          
          {/* Daily Kitchen Temp Logging */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
            <div>
              <h3 className="font-extrabold text-gray-900 text-lg flex items-center gap-2 border-b border-gray-100 pb-2">
                <Clock className="w-5 h-5 text-amber-500" /> Daily Temp Logs
              </h3>
              <p className="text-xs text-gray-500 mt-1">Record critical facility food storage metrics below.</p>
            </div>
            
            <div className="space-y-3">
              <div>
                <label className="flex justify-between text-xs font-bold text-gray-600 mb-1">
                  <span>Freezer Temperature</span>
                  <span className={Number(tempFreezer) <= -18 ? "text-green-600" : "text-red-500"}>{tempFreezer}°C (Target: ≤ -18°C)</span>
                </label>
                <input type="range" min="-30" max="-10" value={tempFreezer} onChange={(e) => setTempFreezer(e.target.value)} className="w-full accent-amber-500" />
              </div>
              
              <div>
                <label className="flex justify-between text-xs font-bold text-gray-600 mb-1">
                  <span>Walk-In Cooler Temperature</span>
                  <span className={Number(tempCooler) <= 4 && Number(tempCooler) >= 0 ? "text-green-600" : "text-red-500"}>{tempCooler}°C (Target: 0 to 4°C)</span>
                </label>
                <input type="range" min="-5" max="10" value={tempCooler} onChange={(e) => setTempCooler(e.target.value)} className="w-full accent-amber-500" />
              </div>

              <div>
                <label className="flex justify-between text-xs font-bold text-gray-600 mb-1">
                  <span>Dry Storage Room Temp</span>
                  <span className={Number(tempDry) <= 21 && Number(tempDry) >= 15 ? "text-green-600" : "text-red-500"}>{tempDry}°C (Target: 15 to 21°C)</span>
                </label>
                <input type="range" min="10" max="30" value={tempDry} onChange={(e) => setTempDry(e.target.value)} className="w-full accent-amber-500" />
              </div>
            </div>

            <button 
              onClick={handleSubmitTemps}
              className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 text-white font-extrabold text-sm rounded-lg hover:shadow-lg transition active:scale-95"
            >
              Submit Temperature Log
            </button>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">HACCP Guidance:</span> Temperatures outside target bounds trigger automatic alerts to kitchen staff for quick remediation.
              </div>
            </div>
          </div>

          {/* Historical Compliance Logs */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-gray-900 text-lg">HACCP Audit Logs</h3>
                <p className="text-xs text-gray-500">History of kitchen safety and food handling inspections.</p>
              </div>
              <button 
                onClick={() => setShowAddCompliance(true)}
                className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white text-xs font-bold rounded-lg hover:shadow transition"
              >
                <Plus className="w-4 h-4" /> Log Audit
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 font-bold uppercase tracking-wider">
                    <th className="px-4 py-3">Audit Title</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Score</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Auditor / Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {complianceRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-400 italic">No compliance audit logs found.</td>
                    </tr>
                  ) : (
                    complianceRows.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-bold text-gray-900">{log.title}</p>
                          {log.details && <p className="text-[10px] text-gray-500 line-clamp-1">{log.details}</p>}
                        </td>
                        <td className="px-4 py-3 font-semibold">{log.category}</td>
                        <td className="px-4 py-3 font-black text-sm">{log.score}%</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-bold ${log.status === "COMPLIANT" ? "bg-green-100 text-green-800" : log.status === "WARNING" ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800"}`}>
                            {log.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-800">{log.auditedBy}</p>
                          <p className="text-[9px] text-gray-500">{new Date(log.auditDate).toLocaleDateString()}</p>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ────────────────── 2. DIETITIANS & CONSULTS SUBTAB ────────────────── */}
      {activeSubTab === "dietitian" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-6">
          
          {/* Dietitian Registry & Policy */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
            <div>
              <h3 className="font-extrabold text-gray-900 text-lg border-b border-gray-100 pb-2">Registered Dietitians</h3>
              <p className="text-xs text-gray-500 mt-1">Consulting clinical nutritionists assigned to our facility.</p>
            </div>
            
            <div className="space-y-3">
              <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center font-bold text-black text-sm">{dietitianStaffName.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}</div>
                <div>
                  <h4 className="font-bold text-gray-900 text-xs">{dietitianStaffName}</h4>
                  <p className="text-[10px] text-gray-500">Geriatric Nutrition</p>
                  <p className="text-[9px] text-green-700 font-semibold mt-0.5">● Active Consulting</p>
                </div>
              </div>
              
              <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center font-bold text-black text-sm">LM</div>
                <div>
                  <h4 className="font-bold text-gray-950 text-xs">Leah McPhee, MS, RDN</h4>
                  <p className="text-[10px] text-gray-500">License: RD-081498 • Renal &amp; Diabetic Diets</p>
                  <p className="text-[9px] text-gray-500 font-semibold mt-0.5">○ On-Call Consultant</p>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
              <span className="font-bold block mb-1">Nutrition Referral Policy:</span>
              Any resident showing significant involuntary weight change (&gt;5% in 30 days) or dysphagia requires an immediate dietitian review request.
            </div>
          </div>

          {/* Consultation Requests Table */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-gray-900 text-lg">Dietitian Consults</h3>
                <p className="text-xs text-gray-500">Clinical assessments and nutritional recommendations.</p>
              </div>
              <button 
                onClick={() => setShowAddConsult(true)}
                className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white text-xs font-bold rounded-lg hover:shadow transition"
              >
                <Plus className="w-4 h-4" /> Request Consult
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 font-bold uppercase tracking-wider">
                    <th className="px-4 py-3">Resident / Room</th>
                    <th className="px-4 py-3">Consult Date</th>
                    <th className="px-4 py-3">Reason for Request</th>
                    <th className="px-4 py-3">Recommendations</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {consultRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-400 italic">No dietitian consult logs found.</td>
                    </tr>
                  ) : (
                    consultRows.map((consult) => (
                      <tr key={consult.id} className="hover:bg-gray-50 align-top">
                        <td className="px-4 py-3">
                          <p className="font-bold text-gray-900">
                            {consult.resident ? `${consult.resident.firstName} ${consult.resident.lastName}` : "Unknown"}
                          </p>
                          <p className="text-[10px] text-gray-500">Room {consult.resident?.roomNumber}</p>
                        </td>
                        <td className="px-4 py-3 text-[10px] text-gray-500">{new Date(consult.consultDate).toLocaleDateString()}</td>
                        <td className="px-4 py-3 max-w-[160px] truncate-2-lines">{consult.reason}</td>
                        <td className="px-4 py-3 text-[11px] max-w-[200px]">
                          <p className="italic text-gray-600 truncate-3-lines">{consult.recommendations}</p>
                          <p className="text-[9px] font-bold text-amber-700 mt-1">Reviewer: {consult.dietitianName}</p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleToggleConsult(consult)}
                            className={`px-2.5 py-1 text-[10px] font-black rounded-lg transition active:scale-95 ${consult.status === "COMPLIANT" || consult.status === "COMPLETED" ? "bg-green-50 text-green-700 hover:bg-green-100 border border-green-200" : "bg-yellow-50 text-yellow-700 hover:bg-yellow-100 border border-yellow-200"}`}
                          >
                            {consult.status === "COMPLETED" ? "Completed" : "Mark Done"}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ────────────────── 3. MENUS & CUISINE SUBTAB ────────────────── */}
      {activeSubTab === "menus" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-6">
          
          {/* Daily Menu Planner */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-gray-900 text-lg">Cuisine Schedules</h3>
                <p className="text-xs text-gray-500">Schedule breakfast, lunch, and dinner options for residents.</p>
              </div>
              <button 
                onClick={() => setShowAddMenu(true)}
                className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white text-xs font-bold rounded-lg hover:shadow transition"
              >
                <Plus className="w-4 h-4" /> Add Menu Item
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {["BREAKFAST", "LUNCH", "DINNER"].map((type) => {
                const items = menuRows.filter(m => m.mealType === type);
                return (
                  <div key={type} className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
                    <h4 className="text-xs font-black tracking-widest text-amber-700 border-b border-amber-200 pb-1.5 flex items-center justify-between">
                      <span>{type}</span>
                      <span className="bg-amber-100 text-amber-800 text-[9px] px-1.5 py-0.5 rounded-full">{items.length} options</span>
                    </h4>

                    <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar">
                      {items.length === 0 ? (
                        <p className="text-[10px] text-gray-400 italic text-center py-4">No {type.toLowerCase()} scheduled.</p>
                      ) : (
                        items.map((item) => (
                          <div key={item.id} className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm relative group">
                            <button 
                              onClick={() => handleDeleteMenu(item.id)}
                              className="absolute top-2 right-2 text-gray-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                            <h5 className="font-bold text-gray-900 text-xs pr-4">{item.name}</h5>
                            {item.description && <p className="text-[10px] text-gray-500 mt-1 line-clamp-2 leading-tight">{item.description}</p>}
                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                              <span className="text-[9px] text-gray-400 font-semibold">{new Date(item.menuDate).toLocaleDateString()}</span>
                              {item.dietaryTags && (
                                <span className="text-[8px] font-bold px-1 bg-amber-50 text-amber-700 rounded truncate max-w-[70px]">
                                  {item.dietaryTags.split(",")[0]}
                                </span>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Resident Dietary Profiles Summary */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
            <div>
              <h3 className="font-extrabold text-gray-900 text-lg">Dietary &amp; Allergies</h3>
              <p className="text-xs text-gray-500 mt-1">Quick summary of active resident dietary restrictions.</p>
            </div>

            <div className="space-y-2 max-h-[360px] overflow-y-auto custom-scrollbar">
              {residentRows.filter(r => r.allergies || r.notes).map(res => (
                <div key={res.id} className="p-3 border border-gray-150 rounded-xl space-y-1.5 hover:border-amber-400 transition">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-gray-800 text-xs">{res.firstName} {res.lastName}</span>
                    <span className="text-[9px] font-bold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">Room {res.roomNumber}</span>
                  </div>
                  {res.allergies && (
                    <p className="text-[10px] text-red-700 flex items-start gap-1 font-medium bg-red-50 px-2 py-1 rounded">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                      <span>Allergies: {res.allergies}</span>
                    </p>
                  )}
                  {res.notes && (
                    <p className="text-[10px] text-gray-600 flex items-start gap-1 bg-gray-50 px-2 py-1 rounded">
                      <FileText className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-0.5" />
                      <span>Special: {res.notes}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ────────────────── MODALS ────────────────── */}

      {/* 1. Add Compliance Audit Modal */}
      {showAddCompliance && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90dvh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between border-b border-yellow-600 z-10">
              <h2 className="text-xl font-extrabold flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-amber-800" /> Log HACCP Compliance Audit
              </h2>
              <button onClick={() => setShowAddCompliance(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">Audit Title</label>
                <input 
                  type="text" 
                  value={complianceForm.title} 
                  onChange={(e) => setComplianceForm({ ...complianceForm, title: e.target.value })} 
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-sm" 
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">Category</label>
                  <select 
                    value={complianceForm.category} 
                    onChange={(e) => setComplianceForm({ ...complianceForm, category: e.target.value })} 
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-sm bg-white"
                  >
                    <option value="TEMPERATURE">Temperature Check</option>
                    <option value="SANITATION">Sanitation &amp; Cleanliness</option>
                    <option value="ALLERGEN">Allergen Safety</option>
                    <option value="SOURCING">Ingredient Sourcing</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">Score (0-100)</label>
                  <input 
                    type="number" 
                    value={complianceForm.score} 
                    onChange={(e) => setComplianceForm({ ...complianceForm, score: Number(e.target.value) })} 
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-sm" 
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">Status</label>
                  <select 
                    value={complianceForm.status} 
                    onChange={(e) => setComplianceForm({ ...complianceForm, status: e.target.value })} 
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-sm bg-white"
                  >
                    <option value="COMPLIANT">COMPLIANT</option>
                    <option value="WARNING">WARNING</option>
                    <option value="NON_COMPLIANT">NON-COMPLIANT</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">Auditor Name</label>
                  <input 
                    type="text" 
                    value={complianceForm.auditedBy} 
                    onChange={(e) => setComplianceForm({ ...complianceForm, auditedBy: e.target.value })} 
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-sm" 
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">Checklist Requirements</label>
                <div className="space-y-2 bg-gray-50 p-3 rounded-lg border border-gray-200 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={complianceForm.refrigeratorChecked} onChange={(e) => setComplianceForm({ ...complianceForm, refrigeratorChecked: e.target.checked })} className="rounded accent-amber-500" />
                    <span>Freezer &amp; Walk-In Cooler within limits</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={complianceForm.dryStorageChecked} onChange={(e) => setComplianceForm({ ...complianceForm, dryStorageChecked: e.target.checked })} className="rounded accent-amber-500" />
                    <span>Dry storage room well-ventilated and dry</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={complianceForm.pestControlChecked} onChange={(e) => setComplianceForm({ ...complianceForm, pestControlChecked: e.target.checked })} className="rounded accent-amber-500" />
                    <span>Pest barriers checked &amp; logged</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={complianceForm.allergenSinksChecked} onChange={(e) => setComplianceForm({ ...complianceForm, allergenSinksChecked: e.target.checked })} className="rounded accent-amber-500" />
                    <span>Cross-contact sanitation sinks operational</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">Audit Findings / Details (Optional)</label>
                <textarea 
                  value={complianceForm.details} 
                  onChange={(e) => setComplianceForm({ ...complianceForm, details: e.target.value })} 
                  rows={3} 
                  placeholder="e.g. All surfaces sanitized, hand sani stations refilled..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-sm resize-none" 
                />
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex flex-wrap items-center justify-between gap-2 z-10">
              <button onClick={() => setShowAddCompliance(false)} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg font-bold">Cancel</button>
              <button onClick={handleSaveCompliance} className="px-5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 text-white font-extrabold text-sm rounded-lg hover:shadow transition active:scale-95">Save Audit</button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Request Consult Modal */}
      {showAddConsult && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90dvh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between border-b border-yellow-600 z-10">
              <h2 className="text-xl font-extrabold flex items-center gap-2">
                <Users className="w-5 h-5 text-amber-800" /> Request Dietitian Consultation
              </h2>
              <button onClick={() => setShowAddConsult(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">Select Resident</label>
                <select 
                  value={consultForm.residentId} 
                  onChange={(e) => setConsultForm({ ...consultForm, residentId: e.target.value })} 
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-sm bg-white"
                >
                  <option value="">-- Choose Resident --</option>
                  {residentRows.map(r => (
                    <option key={r.id} value={r.id}>{r.firstName} {r.lastName} (Room {r.roomNumber})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">Dietitian Assigned</label>
                <select 
                  value={consultForm.dietitianName} 
                  onChange={(e) => setConsultForm({ ...consultForm, dietitianName: e.target.value })} 
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-sm bg-white"
                >
                  <option value={dietitianStaffName}>{dietitianStaffName}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">Reason for Consultation Referral</label>
                <textarea 
                  value={consultForm.reason} 
                  onChange={(e) => setConsultForm({ ...consultForm, reason: e.target.value })} 
                  rows={4} 
                  placeholder="e.g. Resident exhibits severe difficulty swallowing solid foods; requesting mechanical soft diet recommendations..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-sm resize-none" 
                />
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex flex-wrap items-center justify-between gap-2 z-10">
              <button onClick={() => setShowAddConsult(false)} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg font-bold">Cancel</button>
              <button onClick={handleSaveConsult} className="px-5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 text-white font-extrabold text-sm rounded-lg hover:shadow transition active:scale-95">Send Request</button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Add Menu Item Modal */}
      {showAddMenu && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90dvh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between border-b border-yellow-600 z-10">
              <h2 className="text-xl font-extrabold flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-amber-800" /> Schedule Cuisine Menu Item
              </h2>
              <button onClick={() => setShowAddMenu(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">Meal Type</label>
                  <select 
                    value={menuForm.mealType} 
                    onChange={(e) => setMenuForm({ ...menuForm, mealType: e.target.value })} 
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-sm bg-white"
                  >
                    <option value="BREAKFAST">BREAKFAST</option>
                    <option value="LUNCH">LUNCH</option>
                    <option value="DINNER">DINNER</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">Serving Date</label>
                  <input 
                    type="date" 
                    value={menuForm.menuDate} 
                    onChange={(e) => setMenuForm({ ...menuForm, menuDate: e.target.value })} 
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-sm" 
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">Food / Cuisine Name</label>
                <input 
                  type="text" 
                  value={menuForm.name} 
                  onChange={(e) => setMenuForm({ ...menuForm, name: e.target.value })} 
                  placeholder="e.g. Grilled Salmon with Asparagus"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-sm" 
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">Dietary Tags (comma-separated)</label>
                <input 
                  type="text" 
                  value={menuForm.dietaryTags} 
                  onChange={(e) => setMenuForm({ ...menuForm, dietaryTags: e.target.value })} 
                  placeholder="e.g. Low Sodium, Diabetic Friendly, High Protein"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-sm" 
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">Description (Ingredients &amp; Sourcing)</label>
                <textarea 
                  value={menuForm.description} 
                  onChange={(e) => setMenuForm({ ...menuForm, description: e.target.value })} 
                  rows={3} 
                  placeholder="Fresh organic wild-caught salmon filet grilled with low-sodium herb seasoning..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-sm resize-none" 
                />
              </div>
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex flex-wrap items-center justify-between gap-2 z-10">
              <button onClick={() => setShowAddMenu(false)} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg font-bold">Cancel</button>
              <button onClick={handleSaveMenu} className="px-5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 text-white font-extrabold text-sm rounded-lg hover:shadow transition active:scale-95">Schedule Meal</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
