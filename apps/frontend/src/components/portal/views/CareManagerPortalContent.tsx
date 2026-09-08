"use client";

import CareManagerGovernance from "@/components/portal/dashboards/care-manager/CareManagerGovernance";
import AlertCenter from "@/components/portal/views/clinical/AlertCenter";
import ApprovalWorkflows from "@/components/portal/views/clinical/ApprovalWorkflows";
import FacilityIncidents from "@/components/portal/views/FacilityIncidents";
import FacilityRooms from "@/components/portal/views/FacilityRooms";
import ResidentAssessmentV42 from "@/components/portal/views/clinical/ResidentAssessmentV42";
import MoveInBoard from "@/components/portal/views/clinical/MoveInBoard";
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
import DomainMonitoringBoard from "@/components/portal/views/clinical/DomainMonitoringBoard";
import ClinicalRecordsBoard from "@/components/portal/views/clinical/ClinicalRecordsBoard";
import ResidentJourneyBoard from "@/components/portal/views/clinical/ResidentJourneyBoard";
import StaffProfilesBoard from "@/components/portal/views/clinical/StaffProfilesBoard";
import AppointmentCalendar from "@/components/portal/AppointmentCalendar";
import MedicationInventoryBoard from "@/components/portal/views/clinical/MedicationInventoryBoard";
import MiniPharmacyBoard from "@/components/portal/views/clinical/MiniPharmacyBoard";
import CarePlanReviewsBoard from "@/components/portal/views/clinical/CarePlanReviewsBoard";
import RoutineGeneratorBoard from "@/components/portal/views/clinical/RoutineGeneratorBoard";
import RoutineTemplateBoard from "@/components/portal/views/clinical/RoutineTemplateBoard";
import CareDeliveryBoard from "@/components/portal/views/clinical/CareDeliveryBoard";
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
import HubTabs from "@/components/portal/HubTabs";

/**
 * Care Manager portal — clinical oversight split out of Facility Operations:
 * approvals, incidents, alerts, rounds, assessments, care planning, MAR,
 * referrals, and physician coordination. The Care Manager acts with facility-
 * admin clinical authority (permission checks key off the CARE_MANAGER session
 * role); shared clinical boards receive the real CARE_MANAGER identity so
 * authorship, ownership, and permissions remain attributable to that role.
 */
export default function CareManagerPortalContent({ tab }: { tab: string }) {
  switch (tab) {
    // Intake & Admissions — Care Manager can cover these when the Super Admin is
    // away (mirrors the Super Admin portal's CRM + Admissions).
    case "crm":
    case "leads":
      return <LeadPipelineBoard />;

    // ── Consolidated hubs (Phase 1 nav simplification) ──────────────────────
    // Each hub renders the SAME boards that used to be separate sidebar entries,
    // now as in-page tabs. Legacy per-board routes below are preserved.
    case "actionqueue":
      return (
        <HubTabs
          storageKey="care_manager-actionqueue"
          tabs={[
            { key: "alertcenter", label: "Alerts", node: <AlertCenter /> },
            { key: "escalations", label: "Escalations", node: <EscalationsBoard role="CARE_MANAGER" /> },
            { key: "incidents", label: "Incidents", node: <FacilityIncidents /> },
          ]}
        />
      );
    case "medhub":
      return (
        <HubTabs
          storageKey="care_manager-medhub"
          tabs={[
            { key: "mar", label: "Administer (MAR)", node: <MARDailyBoard clinicianRole="CARE_MANAGER" /> },
            { key: "medcompliance", label: "Compliance", node: <MedicationComplianceBoard /> },
            { key: "medinventory", label: "Inventory", node: <MedicationInventoryBoard clinicianRole="CARE_MANAGER" /> },
            { key: "minipharmacy", label: "Mini Pharmacy", node: <MiniPharmacyBoard clinicianRole="CARE_MANAGER" /> },
            { key: "approvalworkflows", label: "Approvals", node: <ApprovalWorkflows /> },
            { key: "medsafety", label: "Med Safety", node: <MedSafetyDashboard /> },
          ]}
        />
      );
    case "assessmenthub":
      return (
        <HubTabs
          storageKey="care_manager-assessmenthub"
          tabs={[
            { key: "prescreen", label: "Pre-Admission", node: <ResidentAssessmentV42 clinicianRole="CARE_MANAGER" /> },
            { key: "careacuity", label: "Reassessment", node: <CareAcuityBoard clinicianRole="CARE_MANAGER" /> },
          ]}
        />
      );
    case "clinicalcoordination":
      return (
        <HubTabs
          storageKey="care_manager-clinicalcoordination"
          tabs={[
            { key: "additionalservices", label: "Additional Clinical Services", node: <AdditionalServicesBoard clinicianRole="CARE_MANAGER" /> },
            { key: "referrals", label: "Specialist Referrals", node: <ReferralsBoard canApprove /> },
            { key: "physiciancomms", label: "Physician Communication", node: <PhysicianCommsLog /> },
            { key: "appointmentcalendar", label: "Appointments", node: <AppointmentCalendar title="Appointments Calendar" canSchedule={false} /> },
            { key: "infectioncontrol", label: "Infection Control", node: <InfectionControlBoard role="CARE_MANAGER" /> },
            { key: "safeguarding", label: "Safeguarding", node: <SafeguardingBoard role="CARE_MANAGER" /> },
          ]}
        />
      );
    case "careplanhub":
      return (
        <HubTabs
          storageKey="care_manager-careplanhub"
          tabs={[
            { key: "careplans", label: "Plan & Review", node: <CarePlanReviewsBoard clinicianRole="CARE_MANAGER" /> },
            { key: "careplangovernance", label: "Plan Governance", node: <CarePlanReviewsBoard clinicianRole="CARE_MANAGER" tabs={["pending", "history"]} /> },
            { key: "routinegenerator", label: "24-Hour Routine", node: <RoutineGeneratorBoard /> },
            { key: "routinetemplate", label: "Routine Template", node: <RoutineTemplateBoard /> },
            { key: "caretask", label: "Care Task", node: <RoutineGeneratorBoard view="caretask" /> },
            { key: "dailyperformance", label: "Resident Daily Performance", node: <RoutineGeneratorBoard view="performance" /> },
          ]}
        />
      );
    case "staffinghub":
      return (
        <HubTabs
          storageKey="care_manager-staffinghub"
          tabs={[
            { key: "taskassignment", label: "Assignments", node: <TaskAssignmentBoard clinicianRole="CARE_MANAGER" /> },
            { key: "caregiverschedule", label: "Schedule", node: <CaregiverScheduleBoard clinicianRole="CARE_MANAGER" /> },
            { key: "staffroster", label: "Roster", node: <StaffRosterBoard clinicianRole="CARE_MANAGER" /> },
            { key: "staffprofiles", label: "Profiles", node: <StaffProfilesBoard clinicianRole="CARE_MANAGER" /> },
            { key: "quality", label: "Quality", node: <QualityMonitoringBoard /> },
          ]}
        />
      );
    case "monitoringhub":
      return (
        <HubTabs
          storageKey="care_manager-monitoringhub"
          tabs={[
            { key: "woundcare", label: "Wound Care", node: <WoundCareBoard clinicianRole="CARE_MANAGER" /> },
            { key: "vitalstrend", label: "Vitals", node: <VitalsTrendBoard clinicianRole="CARE_MANAGER" /> },
            { key: "domainmonitoring", label: "Domain", node: <DomainMonitoringBoard clinicianRole="CARE_MANAGER" /> },
            { key: "adlmonitoring", label: "ADL", node: <ADLMonitoringBoard clinicianRole="CARE_MANAGER" /> },
            { key: "weightmonitoring", label: "Weight", node: <WeightMonitoringBoard clinicianRole="CARE_MANAGER" /> },
          ]}
        />
      );
    case "shiftclosehub":
      return (
        <HubTabs
          storageKey="care_manager-shiftclosehub"
          tabs={[
            { key: "shiftendorsements", label: "Handover", node: <ShiftEndorsementBoard clinicianRole="CARE_MANAGER" /> },
            { key: "shiftsummary", label: "What's Charted", node: <ShiftSummaryBoard clinicianRole="CARE_MANAGER" /> },
            { key: "endorsementdashboard", label: "Status", node: <ShiftEndorsementDashboard clinicianRole="CARE_MANAGER" /> },
          ]}
        />
      );
    case "admissions":
      return <OnboardingHub initialTab="admissions" />;
    case "rooms":
      return <FacilityRooms />;
    case "movein":
      return <MoveInBoard />;
    case "residents":
      return <CareLogsBoard clinicianRole="CARE_MANAGER" />;
    case "records":
      return <FacilityResidents canManageProfile />;
    case "alertcenter":
      return <AlertCenter />;
    case "incidents":
      return <FacilityIncidents />;
    case "carelogs":
      return <CareLogsTimeline clinicianRole="CARE_MANAGER" />;
    case "adlmonitoring":
      return <ADLMonitoringBoard clinicianRole="CARE_MANAGER" />;
    case "weightmonitoring":
      return <WeightMonitoringBoard clinicianRole="CARE_MANAGER" />;
    case "shiftsummary":
      return <ShiftSummaryBoard clinicianRole="CARE_MANAGER" />;
    case "careacuity":
      return <CareAcuityBoard clinicianRole="CARE_MANAGER" />;
    case "woundcare":
      return <WoundCareBoard clinicianRole="CARE_MANAGER" />;
    case "shiftendorsements":
      return <ShiftEndorsementBoard clinicianRole="CARE_MANAGER" />;
    case "endorsementdashboard":
      return <ShiftEndorsementDashboard clinicianRole="CARE_MANAGER" />;
    case "escalations":
      return <EscalationsBoard role="CARE_MANAGER" />;
    case "approvalworkflows":
      return <ApprovalWorkflows />;
    case "mar":
      return <MARDailyBoard clinicianRole="CARE_MANAGER" />;
    case "medsafety":
      return <MedSafetyDashboard />;
    case "medcompliance":
      return <MedicationComplianceBoard />;
    case "progressreport":
      return <ResidentProgressReport clinicianRole="CARE_MANAGER" />;
    case "appointmentcalendar":
      return <AppointmentCalendar title="Appointments Calendar" canSchedule={false} />;
    case "taskassignment":
      return <TaskAssignmentBoard clinicianRole="CARE_MANAGER" />;
    case "caregiverschedule":
      return <CaregiverScheduleBoard clinicianRole="CARE_MANAGER" />;
    case "staffroster":
      return <StaffRosterBoard clinicianRole="CARE_MANAGER" />;
    case "carehistory":
      return <ResidentCareHistory clinicianRole="CARE_MANAGER" />;
    case "clinicalrecords":
      return <ClinicalRecordsBoard clinicianRole="CARE_MANAGER" />;
    case "residentjourney":
      return <ResidentJourneyBoard clinicianRole="CARE_MANAGER" />;
    case "staffprofiles":
      return <StaffProfilesBoard clinicianRole="CARE_MANAGER" />;
    case "vitalstrend":
      return <VitalsTrendBoard clinicianRole="CARE_MANAGER" />;
    case "domainmonitoring":
      return <DomainMonitoringBoard clinicianRole="CARE_MANAGER" />;
    case "medinventory":
      return <MedicationInventoryBoard clinicianRole="CARE_MANAGER" />;
    case "minipharmacy":
      return <MiniPharmacyBoard clinicianRole="CARE_MANAGER" />;
    case "monitoring":
      return <MonitoringView />;
    case "prescreen":
      // Pre-Admission is now the v4.2 three-layer assessment (replaces the legacy 50-point form).
      return <ResidentAssessmentV42 clinicianRole="CARE_MANAGER" />;
    case "assessmentv42":
      return <ResidentAssessmentV42 clinicianRole="CARE_MANAGER" />;
    case "todayscare":
      return <TodaysCareBoard role="CARE_MANAGER" />;
    case "additionalservices":
      return <AdditionalServicesBoard clinicianRole="CARE_MANAGER" />;
    case "safeguarding":
      return <SafeguardingBoard role="CARE_MANAGER" />;
    case "infectioncontrol":
      return <InfectionControlBoard role="CARE_MANAGER" />;
    case "emergencyprotocol":
      return <EmergencyProtocolBoard role="CARE_MANAGER" />;
    case "clinicalprotocols":
      return <ClinicalProtocolsBoard role="CARE_MANAGER" />;
    case "rounds":
      // Retired legacy acuity board → governed v4.2 Care Acuity board.
      return <CareAcuityBoard clinicianRole="CARE_MANAGER" />;
    case "careplans":
      return <CarePlanReviewsBoard clinicianRole="CARE_MANAGER" />;
    case "routinegenerator":
      return <RoutineGeneratorBoard />;
    case "caredelivery":
      return <CareDeliveryBoard clinicianRole="CARE_MANAGER" />;
    case "privatecare":
      return <PrivateCaregiverBoard clinicianRole="CARE_MANAGER" />;
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
      return <CareManagerGovernance />;
  }
}
