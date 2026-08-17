"use client";

import CareManagerDashboard from "@/components/portal/views/CareManagerDashboard";
import AlertCenter from "@/components/portal/views/clinical/AlertCenter";
import ApprovalWorkflows from "@/components/portal/views/clinical/ApprovalWorkflows";
import FacilityIncidents from "@/components/portal/views/FacilityIncidents";
import DailyRoundsBoard from "@/components/portal/views/clinical/DailyRoundsBoard";
import AssessmentAcuityBoard from "@/components/portal/views/clinical/AssessmentAcuityBoard";
import PreAdmissionAssessmentForm from "@/components/portal/views/clinical/PreAdmissionAssessmentForm";
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
import ResidentCareHistory from "@/components/portal/views/clinical/ResidentCareHistory";
import VitalsTrendBoard from "@/components/portal/views/clinical/VitalsTrendBoard";
import ClinicalRecordsBoard from "@/components/portal/views/clinical/ClinicalRecordsBoard";
import AppointmentCalendar from "@/components/portal/AppointmentCalendar";
import MedicationInventoryBoard from "@/components/portal/views/clinical/MedicationInventoryBoard";
import MiniPharmacyBoard from "@/components/portal/views/clinical/MiniPharmacyBoard";
import CarePlanReviewsBoard from "@/components/portal/views/clinical/CarePlanReviewsBoard";
import PrivateCaregiverBoard from "@/components/portal/views/clinical/PrivateCaregiverBoard";
import LabsAllergiesBoard from "@/components/portal/views/clinical/LabsAllergiesBoard";
import EscalationsBoard from "@/components/portal/views/clinical/EscalationsBoard";
import MARDailyBoard from "@/components/portal/views/clinical/MARDailyBoard";
import ReferralsBoard from "@/components/portal/views/clinical/ReferralsBoard";
import PhysicianCommsLog from "@/components/portal/views/clinical/PhysicianCommsLog";
import FollowUpTracker from "@/components/portal/views/clinical/FollowUpTracker";
import ClinicalReports from "@/components/portal/views/clinical/ClinicalReports";
import AuditLogViewer from "@/components/portal/views/clinical/AuditLogViewer";
import ConsentFormsManager from "@/components/portal/views/ConsentFormsManager";
import MonitoringView from "@/components/portal/views/MonitoringView";
import QualityMonitoringBoard from "@/components/portal/views/clinical/QualityMonitoringBoard";
import MedSafetyDashboard from "@/components/portal/views/clinical/MedSafetyDashboard";
import FacilityResidents from "@/components/portal/views/FacilityResidents";
import LeadPipelineBoard from "@/components/portal/views/LeadPipelineBoard";
import OnboardingHub from "@/components/portal/views/OnboardingHub";

/**
 * Care Manager portal — clinical oversight split out of Facility Operations:
 * approvals, incidents, alerts, rounds, assessments, care planning, MAR,
 * referrals, and physician coordination. The Care Manager acts with facility-
 * admin clinical authority (permission checks key off the CARE_MANAGER session
 * role); the clinical boards take `clinicianRole="FACILITY_ADMIN"` since that
 * enum is what those components model.
 */
export default function CareManagerPortalContent({ tab }: { tab: string }) {
  switch (tab) {
    // Intake & Admissions — Care Manager can cover these when the Super Admin is
    // away (mirrors the Super Admin portal's CRM + Admissions).
    case "crm":
    case "leads":
      return <LeadPipelineBoard />;
    case "admissions":
      return <OnboardingHub initialTab="admissions" />;
    case "residents":
      return <CareLogsBoard clinicianRole="FACILITY_ADMIN" />;
    case "records":
      return <FacilityResidents canManageProfile />;
    case "alertcenter":
      return <AlertCenter />;
    case "incidents":
      return <FacilityIncidents />;
    case "dailyrounds":
      return <DailyRoundsBoard clinicianRole="FACILITY_ADMIN" />;
    case "carelogs":
      return <CareLogsTimeline clinicianRole="FACILITY_ADMIN" />;
    case "adlmonitoring":
      return <ADLMonitoringBoard clinicianRole="FACILITY_ADMIN" />;
    case "weightmonitoring":
      return <WeightMonitoringBoard clinicianRole="FACILITY_ADMIN" />;
    case "shiftsummary":
      return <ShiftSummaryBoard clinicianRole="FACILITY_ADMIN" />;
    case "careacuity":
      return <CareAcuityBoard clinicianRole="FACILITY_ADMIN" />;
    case "woundcare":
      return <WoundCareBoard clinicianRole="FACILITY_ADMIN" />;
    case "shiftendorsements":
      return <ShiftEndorsementBoard clinicianRole="FACILITY_ADMIN" />;
    case "endorsementdashboard":
      return <ShiftEndorsementDashboard clinicianRole="FACILITY_ADMIN" />;
    case "escalations":
      return <EscalationsBoard role="FACILITY_ADMIN" />;
    case "approvalworkflows":
      return <ApprovalWorkflows />;
    case "mar":
      return <MARDailyBoard clinicianRole="FACILITY_ADMIN" />;
    case "medsafety":
      return <MedSafetyDashboard />;
    case "medcompliance":
      return <MedicationComplianceBoard />;
    case "progressreport":
      return <ResidentProgressReport clinicianRole="FACILITY_ADMIN" />;
    case "appointmentcalendar":
      return <AppointmentCalendar title="Appointments Calendar" canSchedule={false} />;
    case "taskassignment":
      return <TaskAssignmentBoard clinicianRole="FACILITY_ADMIN" />;
    case "caregiverschedule":
      return <CaregiverScheduleBoard clinicianRole="FACILITY_ADMIN" />;
    case "carehistory":
      return <ResidentCareHistory clinicianRole="FACILITY_ADMIN" />;
    case "clinicalrecords":
      return <ClinicalRecordsBoard clinicianRole="FACILITY_ADMIN" />;
    case "vitalstrend":
      return <VitalsTrendBoard clinicianRole="FACILITY_ADMIN" />;
    case "medinventory":
      return <MedicationInventoryBoard clinicianRole="FACILITY_ADMIN" />;
    case "minipharmacy":
      return <MiniPharmacyBoard clinicianRole="FACILITY_ADMIN" />;
    case "monitoring":
      return <MonitoringView />;
    case "prescreen":
      return <PreAdmissionAssessmentForm clinicianRole="FACILITY_ADMIN" />;
    case "rounds":
      return <AssessmentAcuityBoard clinicianRole="FACILITY_ADMIN" />;
    case "careplans":
      return <CarePlanReviewsBoard clinicianRole="FACILITY_ADMIN" />;
    case "privatecare":
      return <PrivateCaregiverBoard clinicianRole="FACILITY_ADMIN" />;
    case "labs":
      return <LabsAllergiesBoard />;
    case "referrals":
      return <ReferralsBoard canApprove />;
    case "physiciancomms":
      return <PhysicianCommsLog />;
    case "followups":
      return <FollowUpTracker />;
    case "clinicalreports":
      return <ClinicalReports />;
    case "quality":
      return <QualityMonitoringBoard />;
    case "auditlog":
      return <AuditLogViewer focus="clinical" />;
    case "consentforms":
      return <ConsentFormsManager />;
    default:
      return <CareManagerDashboard />;
  }
}
