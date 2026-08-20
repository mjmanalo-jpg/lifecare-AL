import { useState, useMemo, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import VitalsPanel, { VitalReading } from "@/components/portal/widgets/VitalsPanel";
import CameraVisionFeed from "@/components/CameraVisionFeed";
import NurseDashboard from "@/components/portal/views/NurseDashboard";
import NurseRecords from "@/components/portal/views/NurseRecords";
import NurseRecordsWithCallBells from "@/components/portal/views/NurseRecordsWithCallBells";
import NurseMedications from "@/components/portal/views/NurseMedications";
import CaregiverReports from "@/components/portal/views/caregiver/CaregiverReports";
import CaregiverCallBells from "@/components/portal/views/caregiver/CaregiverCallBells";
import FacilityVitals from "@/components/portal/views/FacilityVitals";
import PhysicianOrders from "@/components/portal/views/physician/PhysicianOrders";
import PhysicianVitals from "@/components/portal/views/physician/PhysicianVitals";
import ClinicalNotes from "@/components/portal/views/clinical/ClinicalNotes";
import ClinicalMessages from "@/components/portal/views/clinical/ClinicalMessages";
import EscalationsBoard from "@/components/portal/views/clinical/EscalationsBoard";
import FacilityIncidents from "@/components/portal/views/FacilityIncidents";
import CaregiverTasks from "@/components/portal/views/caregiver/CaregiverTasks";
import ApprovalWorkflows from "@/components/portal/views/clinical/ApprovalWorkflows";
import AlertCenter from "@/components/portal/views/clinical/AlertCenter";
import PhysicianCommsLog from "@/components/portal/views/clinical/PhysicianCommsLog";
import ReferralsBoard from "@/components/portal/views/clinical/ReferralsBoard";
import DailyDocumentation from "@/components/portal/views/clinical/DailyDocumentation";
import DailyRoundsBoard from "@/components/portal/views/clinical/DailyRoundsBoard";
import CameraActivityLog from "@/components/portal/views/clinical/CameraActivityLog";
import ResidentAssessmentV42 from "@/components/portal/views/clinical/ResidentAssessmentV42";
import TodaysCareBoard from "@/components/portal/views/clinical/TodaysCareBoard";
import AdditionalServicesBoard from "@/components/portal/views/clinical/AdditionalServicesBoard";
import SafeguardingBoard from "@/components/portal/views/clinical/SafeguardingBoard";
import InfectionControlBoard from "@/components/portal/views/clinical/InfectionControlBoard";
import EmergencyProtocolBoard from "@/components/portal/views/clinical/EmergencyProtocolBoard";
import ClinicalProtocolsBoard from "@/components/portal/views/clinical/ClinicalProtocolsBoard";
import CareLogsBoard, { CareLogsTimeline } from "@/components/portal/views/clinical/CareLogsBoard";
import ADLMonitoringBoard from "@/components/portal/views/clinical/ADLMonitoringBoard";
import WeightMonitoringBoard from "@/components/portal/views/clinical/WeightMonitoringBoard";
import ShiftSummaryBoard from "@/components/portal/views/clinical/ShiftSummaryBoard";
import CareAcuityBoard from "@/components/portal/views/clinical/CareAcuityBoard";
import WoundCareBoard from "@/components/portal/views/clinical/WoundCareBoard";
import ShiftEndorsementBoard from "@/components/portal/views/clinical/ShiftEndorsementBoard";
import ShiftEndorsementDashboard from "@/components/portal/views/clinical/ShiftEndorsementDashboard";
import MedicationComplianceBoard from "@/components/portal/views/clinical/MedicationComplianceBoard";
import ResidentProgressReport from "@/components/portal/views/clinical/ResidentProgressReport";
import TaskAssignmentBoard from "@/components/portal/views/clinical/TaskAssignmentBoard";
import CaregiverScheduleBoard from "@/components/portal/views/clinical/CaregiverScheduleBoard";
import StaffRosterBoard from "@/components/portal/views/clinical/StaffRosterBoard";
import ResidentCareHistory from "@/components/portal/views/clinical/ResidentCareHistory";
import VitalsTrendBoard from "@/components/portal/views/clinical/VitalsTrendBoard";
import ClinicalRecordsBoard from "@/components/portal/views/clinical/ClinicalRecordsBoard";
import ResidentJourneyBoard from "@/components/portal/views/clinical/ResidentJourneyBoard";
import ClockInBoard from "@/components/portal/views/clinical/ClockInBoard";
import AppointmentCalendar from "@/components/portal/AppointmentCalendar";
import MedicationInventoryBoard from "@/components/portal/views/clinical/MedicationInventoryBoard";
import MiniPharmacyBoard from "@/components/portal/views/clinical/MiniPharmacyBoard";
import CarePlanReviewsBoard from "@/components/portal/views/clinical/CarePlanReviewsBoard";
import CareDeliveryBoard from "@/components/portal/views/clinical/CareDeliveryBoard";
import PrivateCaregiverBoard from "@/components/portal/views/clinical/PrivateCaregiverBoard";
import LabsAllergiesBoard from "@/components/portal/views/clinical/LabsAllergiesBoard";
import VaccinationTracker from "@/components/portal/views/clinical/VaccinationTracker";
import ResidentDocuments from "@/components/portal/views/clinical/ResidentDocuments";
import MARDailyBoard from "@/components/portal/views/clinical/MARDailyBoard";
import FollowUpTracker from "@/components/portal/views/clinical/FollowUpTracker";
import ClinicalReports from "@/components/portal/views/clinical/ClinicalReports";
import AuditLogViewer from "@/components/portal/views/clinical/AuditLogViewer";
import InventoryAlertsPanel from "@/components/portal/views/clinical/InventoryAlertsPanel";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptIncident } from "@/lib/adapters";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
import { X, Search, Eye, CheckCircle, Trash2, ArrowLeft, Camera, Activity } from "lucide-react";

interface NursePortalContentProps {
  tab: string;
}

type IncidentSeverity = "critical" | "high" | "medium" | "low";
type IncidentStatus = "open" | "in-progress" | "closed";

type NurseIncident = {
  id: string;
  type: string;
  severity: IncidentSeverity;
  resident: string;
  room: string;
  timestamp: Date | string;
  status: IncidentStatus;
  description: string;
  notes: string;
  resolved: boolean;
  source?: "monitoring" | "manual";
};

type MonitoringAnalysis = {
  summary?: string;
  globalEmotion?: string;
  globalBehavior?: string;
  globalPosture?: string;
};

import Swal from "@/lib/swal";

export default function NursePortalContent({ tab }: NursePortalContentProps) {
  // ---- Live data (hooks must run unconditionally, before any tab return) ----
  const {
    data: incidentRows,
    loading: incLoading,
    refetch: refetchIncidents,
  } = useLiveQuery("incidents", {
    query: "include=resident&take=300",
    tables: ["Incident"],
  });
  const dbIncidents = useMemo<NurseIncident[]>(
    () => incidentRows.map(adaptIncident) as NurseIncident[],
    [incidentRows]
  );

  // On-duty clinical staff — recipients for fall / pre-fall push alerts.
  const { data: staffRows } = useLiveQuery<{ id: string; userId?: string; isActive?: boolean; user?: { role?: string } }>(
    "staff", { query: "include=user&take=300", tables: ["Staff"] }
  );
  const clinicalUserIds = useMemo(
    () => staffRows
      .filter((s) => s.isActive !== false && (s.user?.role === "NURSE" || s.user?.role === "CAREGIVER") && !!s.userId)
      .map((s) => s.userId as string),
    [staffRows]
  );
  const notifyClinicalStaff = async (type: "INCIDENT_REPORT" | "VITAL_ALERT", title: string, message: string) => {
    // Best-effort fan-out to on-duty nurses/caregivers' notification bell.
    await Promise.allSettled(
      clinicalUserIds.map((userId) => createRecord("notifications", { userId, type, title, message }))
    );
  };

  const [monitoringFallAlert, setMonitoringFallAlert] = useState(false);

  // Incidents Management
  // Local state holds ONLY monitoring/camera-sourced incidents; DB incidents
  // come from useLiveQuery and are merged in below.
  const [monitoringIncidents, setMonitoringIncidents] = useState<NurseIncident[]>([]);

  // Combined feed used by stats / filters / pagination (monitoring first).
  const incidents = useMemo<NurseIncident[]>(
    () => [...monitoringIncidents, ...dbIncidents],
    [monitoringIncidents, dbIncidents]
  );

  const [incidentSearch, setIncidentSearch] = useState("");
  const [incidentFilterSeverity, setIncidentFilterSeverity] = useState<string>("all");
  const [incidentFilterStatus, setIncidentFilterStatus] = useState<string>("all");
  const [viewingIncident, setViewingIncident] = useState<NurseIncident | null>(null);
  const [incidentPage, setIncidentPage] = useState(1);
  const [incidentItemsPerPage, setIncidentItemsPerPage] = useState(10);

  const filteredIncidents = useMemo(() => {
    return incidents.filter((incident) => {
      const matchesSearch =
        incident.type.toLowerCase().includes(incidentSearch.toLowerCase()) ||
        incident.resident.toLowerCase().includes(incidentSearch.toLowerCase()) ||
        incident.room.toLowerCase().includes(incidentSearch.toLowerCase());

      const matchesSeverity = incidentFilterSeverity === "all" || incident.severity === incidentFilterSeverity;
      const matchesStatus = incidentFilterStatus === "all" || incident.status === incidentFilterStatus;

      return matchesSearch && matchesSeverity && matchesStatus;
    });
  }, [incidents, incidentSearch, incidentFilterSeverity, incidentFilterStatus]);

  const incidentTotalPages = Math.ceil(filteredIncidents.length / incidentItemsPerPage);
  const incidentStartIndex = (incidentPage - 1) * incidentItemsPerPage;
  const incidentEndIndex = incidentStartIndex + incidentItemsPerPage;
  const paginatedIncidents = filteredIncidents.slice(incidentStartIndex, incidentEndIndex);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset pagination on filter change
    setIncidentPage(1);
  }, [incidentSearch, incidentFilterSeverity, incidentFilterStatus]);

  const handleMonitoringFallTriggered = async (analysis: MonitoringAnalysis & { resident?: string; room?: string; residentId?: string }) => {
    setMonitoringFallAlert(true);

    const hasOpenMonitoringFall = monitoringIncidents.some(
      (incident) =>
        incident.source === "monitoring" &&
        incident.type === "Fall Detection" &&
        incident.status !== "closed"
    );

    if (hasOpenMonitoringFall) return;

    const analysisSummary = analysis.summary || "Fall detection triggered from monitoring camera.";

    // Persist to DB as a real incident
    try {
      await createRecord("incidents", {
        incidentType: "FALL",
        severity: "CRITICAL",
        description: `AUTOMATED CAMERA FALL DETECTION\n\n${analysisSummary}`,
        followUpNotes: `AI Vision Analysis — Emotion: ${analysis.globalEmotion || "Unknown"}; Behavior: ${analysis.globalBehavior || "Unknown"}; Posture: ${analysis.globalPosture || "Unknown"}.`,
        incidentDate: new Date().toISOString(),
        // Link to the monitored resident so the incident shows their name/room and ties to their record.
        ...(analysis.residentId ? { residentId: analysis.residentId } : {}),
      });
      await refetchIncidents();
      await notifyClinicalStaff(
        "INCIDENT_REPORT",
        "🚨 Fall detected",
        `Camera detected a fall for ${analysis.resident || "a resident"}${analysis.room ? ` (Room ${analysis.room})` : ""}. Respond immediately.`,
      );
      // Confirmed fall → raise a call bell so it enters the active response queue
      // caregivers/nurses actively watch (needs a resident to attach to).
      if (analysis.residentId) {
        await createRecord("call-bells", {
          residentId: analysis.residentId,
          status: "PENDING",
          reason: `🚨 AI FALL DETECTION${analysis.room ? ` — Room ${analysis.room}` : ""}`,
          notes: "Auto-raised by AI camera monitoring — respond immediately.",
        });
      }
    } catch { /* non-critical — local fallback below */ }

    // Also keep local state for immediate UI update
    setMonitoringIncidents((prev) => {
      const incident: NurseIncident = {
        id: `monitoring-fall-${Date.now()}`,
        type: "Fall Detection",
        severity: "critical",
        resident: analysis.resident || "",
        room: analysis.room || "",
        timestamp: new Date(),
        status: "open",
        description: analysisSummary,
        notes: `Camera monitoring. Emotion: ${analysis.globalEmotion || "Unknown"}; behavior: ${analysis.globalBehavior || "Unknown"}; posture: ${analysis.globalPosture || "Unknown"}.`,
        resolved: false,
        source: "monitoring",
      };
      return [incident, ...prev];
    });
  };

  // Preventive pre-fall risk — logged as a lower-severity WARNING so staff can act
  // before a fall, without polluting the log with false CRITICAL fall incidents.
  const preFallCooldownRef = useRef(0);
  const handleMonitoringPreFallRisk = async (
    analysis: MonitoringAnalysis & { resident?: string; room?: string; residentId?: string },
    reason: string,
  ) => {
    // The feed already debounces (60s); guard again here against duplicate incidents.
    const now = Date.now();
    if (now - preFallCooldownRef.current < 60_000) return;
    preFallCooldownRef.current = now;

    try {
      await createRecord("incidents", {
        incidentType: "BEHAVIORAL",
        severity: "MODERATE",
        description: `PRE-FALL RISK (PREVENTIVE ALERT)\n\n${reason}`,
        followUpNotes: `AI Vision early warning — Emotion: ${analysis.globalEmotion || "Unknown"}; Behavior: ${analysis.globalBehavior || "Unknown"}; Posture: ${analysis.globalPosture || "Unknown"}. Check the resident before a fall occurs.`,
        incidentDate: new Date().toISOString(),
        // Link to the monitored resident so the incident shows their name/room and ties to their record.
        ...(analysis.residentId ? { residentId: analysis.residentId } : {}),
      });
      await refetchIncidents();
      await notifyClinicalStaff(
        "VITAL_ALERT",
        "⚠️ Pre-fall risk",
        `${analysis.resident || "A resident"}${analysis.room ? ` (Room ${analysis.room})` : ""} may be at risk of a fall — ${reason}`,
      );
    } catch { /* non-critical — the on-camera banner + monitoring log still fired */ }
  };

  const handleDeleteIncident = async (id: string) => {
    const result = await Swal.fire({
      title: "Delete Incident?",
      text: "Remove this incident from log?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel",
    });

    if (result.isConfirmed) {
      if (String(id).startsWith("monitoring-")) {
        setMonitoringIncidents((prev) => prev.filter((i) => i.id !== id));
      } else {
        try {
          await deleteRecord("incidents", id);
          await refetchIncidents();
        } catch (err) {
          Swal.fire({
            title: "Delete Failed",
            text: err instanceof Error ? err.message : "Could not delete incident.",
            icon: "error",
            confirmButtonColor: "#fbbf24",
          });
          return;
        }
      }
      Swal.fire({
        title: "Deleted",
        text: "Incident removed.",
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
    }
  };

  const handleResolveIncident = async (id: string) => {
    const result = await Swal.fire({
      title: "Resolve Incident?",
      text: "Mark this incident as resolved?",
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#10b981",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Resolve",
      cancelButtonText: "Cancel",
    });

    if (result.isConfirmed) {
      if (String(id).startsWith("monitoring-")) {
        setMonitoringIncidents((prev) =>
          prev.map((i) =>
            i.id === id ? { ...i, status: "closed", resolved: true } : i
          )
        );
      } else {
        try {
          await updateRecord("incidents", id, { resolvedAt: new Date().toISOString() });
          await refetchIncidents();
        } catch (err) {
          Swal.fire({
            title: "Resolve Failed",
            text: err instanceof Error ? err.message : "Could not resolve incident.",
            icon: "error",
            confirmButtonColor: "#fbbf24",
          });
          return;
        }
      }
      Swal.fire({
        title: "Resolved",
        text: "Incident marked as closed.",
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
    }
  };

  if (tab === "alertcenter") {
    return <AlertCenter />;
  }

  if (tab === "monitoring") {
    return (
      <NurseMonitoringView
        monitoringFallAlert={monitoringFallAlert}
        handleMonitoringFallTriggered={handleMonitoringFallTriggered}
        handleMonitoringPreFallRisk={handleMonitoringPreFallRisk}
        setMonitoringFallAlert={setMonitoringFallAlert}
      />
    );
  }

  // Incident Reports — read-only for nurses (Care Manager reviews & closes).
  if (tab === "incidents") return <FacilityIncidents readOnly canResolve />;

  // Legacy inline nurse incident view — superseded by the read-only view above.
  if (tab === "incidents-legacy") {
    const incidentStats = {
      total: incidents.length,
      open: incidents.filter((i) => i.status === "open").length,
      critical: incidents.filter((i) => i.severity === "critical" && i.status !== "closed").length,
      resolved: incidents.filter((i) => i.resolved).length,
    };

    const getSeverityColor = (severity: string) => {
      switch (severity) {
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

    const getStatusColor = (status: string) => {
      switch (status) {
        case "open":
          return "bg-red-50 border-red-200";
        case "in-progress":
          return "bg-yellow-50 border-yellow-200";
        case "closed":
          return "bg-green-50 border-green-200";
        default:
          return "bg-gray-50 border-gray-200";
      }
    };

    const getSeverityIcon = (severity: string) => {
      switch (severity) {
        case "critical":
          return "🚨";
        case "high":
          return "⚠️";
        case "medium":
          return "⚡";
        default:
          return "ℹ️";
      }
    };

    return (
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl sm:text-4xl font-bold text-slate-900 mb-2">
            Incident Log
          </h1>
          <p className="text-gray-600">Track and manage resident incidents and safety events</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <p className="text-sm text-gray-600 font-semibold">Total Incidents</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{incidentStats.total}</p>
          </div>
          <div className="bg-white p-4 rounded-lg border border-red-200 bg-red-50">
            <p className="text-sm text-red-700 font-semibold">Open</p>
            <p className="text-3xl font-bold text-red-600 mt-1">{incidentStats.open}</p>
          </div>
          <div className="bg-white p-4 rounded-lg border border-orange-200 bg-orange-50">
            <p className="text-sm text-orange-700 font-semibold">Critical</p>
            <p className="text-3xl font-bold text-orange-600 mt-1">{incidentStats.critical}</p>
          </div>
          <div className="bg-white p-4 rounded-lg border border-green-200 bg-green-50">
            <p className="text-sm text-green-700 font-semibold">Resolved</p>
            <p className="text-3xl font-bold text-green-600 mt-1">{incidentStats.resolved}</p>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by type, resident, or room..."
              value={incidentSearch}
              onChange={(e) => setIncidentSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Severity</label>
              <select
                value={incidentFilterSeverity}
                onChange={(e) => setIncidentFilterSeverity(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
              >
                <option value="all">All Levels</option>
                <option value="critical">Critical Only</option>
                <option value="high">High & Above</option>
                <option value="medium">Medium & Above</option>
                <option value="low">Low Priority</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
              <select
                value={incidentFilterStatus}
                onChange={(e) => setIncidentFilterStatus(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none"
              >
                <option value="all">All Status</option>
                <option value="open">Open Only</option>
                <option value="in-progress">In Progress</option>
                <option value="closed">Resolved Only</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Show per page</label>
              <select
                value={incidentItemsPerPage}
                onChange={(e) => {
                  setIncidentItemsPerPage(parseInt(e.target.value));
                  setIncidentPage(1);
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

        {/* Incidents List */}
        <div className="space-y-3">
          {paginatedIncidents.length > 0 ? (
            paginatedIncidents.map((incident) => (
              <div
                key={incident.id}
                className={`p-4 rounded-lg border transition ${getStatusColor(incident.status)}`}
              >
                <div className="flex items-start gap-4">
                  <div className="text-2xl mt-1">{getSeverityIcon(incident.severity)}</div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <h4 className={`text-lg font-bold ${incident.resolved ? "line-through text-gray-500" : "text-gray-900"}`}>
                          {incident.type}
                        </h4>
                        <p className="text-sm text-gray-600 mt-1">
                          {incident.resident} • Room {incident.room}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <span className={`px-2 py-1 rounded text-xs font-semibold border ${getSeverityColor(incident.severity)}`}>
                          {incident.severity.toUpperCase()}
                        </span>
                        <span className={`px-2 py-1 rounded text-xs font-semibold bg-gray-200 text-gray-800`}>
                          {incident.status.toUpperCase()}
                        </span>
                        <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-medium">
                          {new Date(incident.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>

                    <p className="text-sm text-gray-900 mb-2">{incident.description}</p>

                    {incident.notes && (
                      <p className="text-sm text-gray-600 p-2 bg-gray-100 rounded border border-gray-200 mb-3">
                        📝 {incident.notes}
                      </p>
                    )}

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => setViewingIncident(incident)}
                        className="flex items-center gap-1 px-3 py-1 text-blue-600 hover:bg-blue-50 rounded text-sm font-medium transition"
                      >
                        <Eye className="w-4 h-4" />
                        View
                      </button>
                      {incident.status !== "closed" && (
                        <button
                          onClick={() => handleResolveIncident(incident.id)}
                          className="flex items-center gap-1 px-3 py-1 text-green-600 hover:bg-green-50 rounded text-sm font-medium transition"
                        >
                          <CheckCircle className="w-4 h-4" />
                          Resolve
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteIncident(incident.id)}
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
          ) : incLoading && incidents.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
              Loading incidents…
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
              No incidents match your filters.
            </div>
          )}
        </div>

        {/* Pagination */}
        {filteredIncidents.length > 0 && (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="text-sm text-gray-600">
              Showing {incidentStartIndex + 1}-{Math.min(incidentEndIndex, filteredIncidents.length)} of {filteredIncidents.length} incidents
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIncidentPage(Math.max(1, incidentPage - 1))}
                disabled={incidentPage === 1}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
              >
                Previous
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: incidentTotalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => setIncidentPage(page)}
                    className={`px-3 py-2 rounded-lg font-medium transition ${
                      incidentPage === page
                        ? "bg-yellow-400 text-black"
                        : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setIncidentPage(Math.min(incidentTotalPages, incidentPage + 1))}
                disabled={incidentPage === incidentTotalPages}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Incident Details Modal */}
        {viewingIncident && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              {/* Modal Header */}
              <div className={`sticky top-0 bg-gradient-to-r ${
                viewingIncident.severity === "critical"
                  ? "from-red-400 to-red-500"
                  : viewingIncident.severity === "high"
                  ? "from-orange-400 to-orange-500"
                  : "from-blue-400 to-blue-500"
              } text-white p-6 flex items-center justify-between`}>
                <div>
                  <h2 className="text-2xl font-bold">{getSeverityIcon(viewingIncident.severity)} {viewingIncident.type}</h2>
                  <p className="text-white/90">{viewingIncident.resident} • Room {viewingIncident.room}</p>
                </div>
                <button
                  onClick={() => setViewingIncident(null)}
                  className="p-2 hover:bg-white/20 rounded-lg transition"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-8 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Severity</label>
                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold ${getSeverityColor(viewingIncident.severity)}`}>
                      {viewingIncident.severity.toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Status</label>
                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold ${
                      viewingIncident.status === "open"
                        ? "bg-red-100 text-red-800"
                        : viewingIncident.status === "in-progress"
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-green-100 text-green-800"
                    }`}>
                      {viewingIncident.status.toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 mb-2">Timestamp</label>
                    <p className="text-gray-900 font-medium">{new Date(viewingIncident.timestamp).toLocaleString()}</p>
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-gray-900 mb-2">Description</h3>
                  <p className="text-gray-700 p-3 bg-gray-50 rounded border border-gray-200">{viewingIncident.description}</p>
                </div>

                {viewingIncident.notes && (
                  <div className="bg-yellow-50 border border-yellow-200 p-4 rounded">
                    <h3 className="font-bold text-gray-900 mb-2">Notes</h3>
                    <p className="text-gray-900">{viewingIncident.notes}</p>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-8 py-4 flex flex-wrap items-center justify-between gap-3">
                <button
                  onClick={() => setViewingIncident(null)}
                  className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
                >
                  Close
                </button>
                {viewingIncident.status !== "closed" && (
                  <button
                    onClick={() => {
                      handleResolveIncident(viewingIncident.id);
                      setViewingIncident(null);
                    }}
                    className="px-6 py-2 bg-gradient-to-r from-green-400 to-green-500 text-white font-semibold rounded-lg hover:shadow-lg transition"
                  >
                    Mark Resolved
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }


  if (tab === "medications") {
    return <NurseMedications />;
  }

  // Shared clinical modules — the Head Nurse portal mirrors the physician's
  // clinical toolset (rounds, orders, notes, vitals, secure messages), all live
  // and scoped to the NURSE role for authorship/attribution.
  if (tab === "prescreen") {
    // Pre-Admission is now the v4.2 three-layer assessment (replaces the legacy 50-point form).
    return <ResidentAssessmentV42 clinicianRole="NURSE" />;
  }
  if (tab === "assessmentv42") {
    return <ResidentAssessmentV42 clinicianRole="NURSE" />;
  }
  if (tab === "todayscare") {
    return <TodaysCareBoard role="NURSE" />;
  }
  if (tab === "additionalservices") {
    return <AdditionalServicesBoard clinicianRole="NURSE" />;
  }
  if (tab === "safeguarding") {
    return <SafeguardingBoard role="NURSE" />;
  }
  if (tab === "infectioncontrol") {
    return <InfectionControlBoard role="NURSE" />;
  }
  if (tab === "emergencyprotocol") {
    return <EmergencyProtocolBoard role="NURSE" />;
  }
  if (tab === "clinicalprotocols") {
    return <ClinicalProtocolsBoard role="NURSE" />;
  }
  if (tab === "carelogs") {
    return <CareLogsTimeline clinicianRole="NURSE" />;
  }
  if (tab === "adlmonitoring") {
    return <ADLMonitoringBoard clinicianRole="NURSE" />;
  }
  if (tab === "weightmonitoring") {
    return <WeightMonitoringBoard clinicianRole="NURSE" />;
  }
  if (tab === "shiftsummary") {
    return <ShiftSummaryBoard clinicianRole="NURSE" />;
  }
  if (tab === "careacuity") {
    return <CareAcuityBoard clinicianRole="NURSE" />;
  }
  if (tab === "woundcare") {
    return <WoundCareBoard clinicianRole="NURSE" />;
  }
  if (tab === "shiftendorsements") {
    return <ShiftEndorsementBoard clinicianRole="NURSE" />;
  }
  if (tab === "endorsementdashboard") {
    return <ShiftEndorsementDashboard clinicianRole="NURSE" />;
  }
  if (tab === "rounds") {
    // Retired the legacy 9-dimension acuity board — route to the governed v4.2
    // Care Acuity & Level of Care board (rule-data driven).
    return <CareAcuityBoard clinicianRole="NURSE" />;
  }
  if (tab === "orders") {
    return <PhysicianOrders />;
  }
  if (tab === "notes") {
    return <ClinicalNotes clinicianRole="NURSE" />;
  }
  if (tab === "vitals") {
    return <PhysicianVitals />;
  }
  if (tab === "messages") {
    return <ClinicalMessages clinicianRole="NURSE" />;
  }
  if (tab === "escalations") {
    return <EscalationsBoard role="NURSE" />;
  }

  // Call bells share the caregiver module — same CallBell model & queue workflow.
  if (tab === "callbells") {
    return <CaregiverCallBells />;
  }

  // Shift reports share the caregiver module — same ShiftReport model & workflow.
  if (tab === "reports") {
    return <CaregiverReports />;
  }

  if (tab === "records") {
    return <NurseRecords />;
  }
  if (tab === "residents") {
    return <CareLogsBoard clinicianRole="NURSE" />;
  }
  if (tab === "clinicalrecords") {
    return <ClinicalRecordsBoard clinicianRole="NURSE" />;
  }
  if (tab === "residentjourney") {
    return <ResidentJourneyBoard clinicianRole="NURSE" />;
  }
  if (tab === "clockin") {
    return <ClockInBoard clinicianRole="NURSE" />;
  }

  if (tab === "tasks") {
    return <DailyDocumentation clinicianRole="NURSE" />;
  }
  if (tab === "dailyrounds") {
    return <DailyRoundsBoard clinicianRole="NURSE" />;
  }
  if (tab === "taskboard") {
    return <CaregiverTasks />;
  }
  if (tab === "approvalworkflows") return <ApprovalWorkflows />;
  if (tab === "physiciancomms") return <PhysicianCommsLog />;
  // Nurses AND Care Managers manage the appointment schedule — both approve/reject.
  if (tab === "referrals") return <ReferralsBoard canApprove />;
  if (tab === "cameralogs") {
    return <CameraActivityLog />;
  }
  if (tab === "labs") {
    return <LabsAllergiesBoard />;
  }
  if (tab === "careplans") {
    return <CarePlanReviewsBoard clinicianRole="NURSE" />;
  }
  if (tab === "caredelivery") {
    return <CareDeliveryBoard clinicianRole="NURSE" />;
  }
  if (tab === "privatecare") {
    return <PrivateCaregiverBoard clinicianRole="NURSE" />;
  }
  if (tab === "vaccinations") {
    return <VaccinationTracker />;
  }
  if (tab === "documents") {
    return <ResidentDocuments />;
  }
  if (tab === "mar") {
    return <MARDailyBoard clinicianRole="NURSE" />;
  }
  if (tab === "medcompliance") {
    return <MedicationComplianceBoard />;
  }
  if (tab === "progressreport") {
    return <ResidentProgressReport clinicianRole="NURSE" />;
  }
  if (tab === "appointmentcalendar") {
    return <AppointmentCalendar title="Appointments Calendar" canSchedule={false} />;
  }
  if (tab === "taskassignment") {
    return <TaskAssignmentBoard clinicianRole="NURSE" />;
  }
  if (tab === "caregiverschedule") {
    return <CaregiverScheduleBoard clinicianRole="NURSE" />;
  }
  if (tab === "staffroster") {
    return <StaffRosterBoard clinicianRole="NURSE" />;
  }
  if (tab === "carehistory") {
    return <ResidentCareHistory clinicianRole="NURSE" />;
  }
  if (tab === "vitalstrend") {
    return <VitalsTrendBoard clinicianRole="NURSE" />;
  }
  if (tab === "medinventory") {
    return <MedicationInventoryBoard clinicianRole="NURSE" />;
  }
  if (tab === "minipharmacy") {
    return <MiniPharmacyBoard clinicianRole="NURSE" />;
  }
  if (tab === "followups") {
    return <FollowUpTracker />;
  }
  if (tab === "auditlog") {
    return <AuditLogViewer />;
  }
  if (tab === "inventory-alerts") {
    return <InventoryAlertsPanel />;
  }
  if (tab === "clinicalreports") {
    return <ClinicalReports />;
  }

  // Default: Dashboard tab
  return <NurseDashboard />;
}

/* ── Monitoring View (Dedicated Per-Resident Camera + Vitals) ──────── */

function NurseMonitoringViewFallback() {
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

function NurseMonitoringViewInner({
  monitoringFallAlert,
  handleMonitoringFallTriggered,
  handleMonitoringPreFallRisk,
  setMonitoringFallAlert,
}: {
  monitoringFallAlert: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleMonitoringFallTriggered: (analysis: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleMonitoringPreFallRisk?: (analysis: any, reason: string) => void;
  setMonitoringFallAlert: (val: boolean) => void;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const resident = searchParams.get("resident");
  const room = searchParams.get("room");
  const residentId = searchParams.get("residentId");
  const [showVitals, setShowVitals] = useState(false);

  return (
    <div className="space-y-6">
      {/* Resident Header Card */}
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/nurse/records")}
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
            residentId={residentId || undefined}
            isFallen={monitoringFallAlert}
            onFallTriggered={(analysis: any) => handleMonitoringFallTriggered({ ...analysis, resident: resident || "", room: room || "", residentId: residentId || "" })} // eslint-disable-line @typescript-eslint/no-explicit-any
            onPreFallRisk={(analysis: any, reason: string) => handleMonitoringPreFallRisk?.({ ...analysis, resident: resident || "", room: room || "", residentId: residentId || "" }, reason)} // eslint-disable-line @typescript-eslint/no-explicit-any
            onFallCleared={() => setMonitoringFallAlert(false)}
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

export function NurseMonitoringView({
  monitoringFallAlert,
  handleMonitoringFallTriggered,
  handleMonitoringPreFallRisk,
  setMonitoringFallAlert,
}: {
  monitoringFallAlert: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleMonitoringFallTriggered: (analysis: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleMonitoringPreFallRisk?: (analysis: any, reason: string) => void;
  setMonitoringFallAlert: (val: boolean) => void;
}) {
  return (
    <Suspense fallback={<NurseMonitoringViewFallback />}>
      <NurseMonitoringViewInner
        monitoringFallAlert={monitoringFallAlert}
        handleMonitoringFallTriggered={handleMonitoringFallTriggered}
        handleMonitoringPreFallRisk={handleMonitoringPreFallRisk}
        setMonitoringFallAlert={setMonitoringFallAlert}
      />
    </Suspense>
  );
}
